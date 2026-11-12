import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { Inject, Injectable, Optional as InjectOptional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CREATIVE_MAX_BYTES } from '@protarget/shared';
import { ApiError } from '../../common/api-error';
import { nextCode } from '../../common/codes';
import { Principal } from '../../common/identity';
import { conflict, invalid, inventoryTransaction, missing } from '../../common/inventory-validation';
import { OBJECT_STORAGE, ObjectStorage, StoredObject } from '../../common/storage/object-storage';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { CreativePageDto, CreativeQueryDto, CreativeResponseDto, RejectCreativeDto, RevokeCreativeDto, UploadCreativeDto } from './creatives.dto';
import { FfprobeRunner, inspectMedia, MediaToolUnavailable, runFfprobe, sha256File } from './media';

export const FFPROBE_RUNNER = Symbol('FFPROBE_RUNNER');

export const creativeSelect = {
  id: true, code: true, advertiserId: true, originalFilename: true, mime: true, durationSeconds: true, durationManual: true,
  width: true, height: true, sizeBytes: true, checksum: true, videoCodec: true, status: true, rejectionReason: true,
  version: true, replacesId: true, approvedAt: true, createdAt: true, storageKey: true,
  revokedAt: true, revocationReason: true,
  uploadedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } },
  revokedBy: { select: { id: true, name: true } },
} satisfies Prisma.CreativeSelect;
export type SelectedCreative = Prisma.CreativeGetPayload<{ select: typeof creativeSelect }>;

export function presentCreative(row: SelectedCreative): CreativeResponseDto {
  const { storageKey: _key, ...safe } = row;
  return { ...safe,
    kind: row.mime.startsWith('image/') ? 'IMAGE' : row.mime === 'video/mp4' ? 'VIDEO' : null,
    durationSeconds: row.durationSeconds?.toFixed(3) ?? null, sizeBytes: row.sizeBytes?.toString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}

/** Control characters and path components never reach storage, headers or the UI. */
export function safeFilename(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 255);
  return clean || 'upload';
}

export interface UploadedFile { path: string; originalname: string; size: number }

/** Internal: the partial unique index rejected a concurrent upload; resolved after the transaction. */
class UploadRace extends Error {}

@Injectable()
export class CreativesService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage | null,
    @InjectOptional() @Inject(FFPROBE_RUNNER) private readonly ffprobe: FfprobeRunner = runFfprobe) {}

  list(actor: Principal, query: CreativeQueryDto): Promise<CreativePageDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const where: Prisma.CreativeWhereInput = {
        ...(query.advertiserId ? { advertiserId: query.advertiserId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search ? { OR: [{ code: { contains: query.search, mode: 'insensitive' } },
          { originalFilename: { contains: query.search, mode: 'insensitive' } }] } : {}),
      };
      const [items, total] = await Promise.all([
        tx.creative.findMany({ where, select: creativeSelect, skip: query.skip, take: query.pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
        tx.creative.count({ where }),
      ]);
      return { items: items.map(presentCreative), total, page: query.page, pageSize: query.pageSize };
    });
  }

  get(actor: Principal, id: string): Promise<CreativeResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await tx.creative.findUnique({ where: { id }, select: creativeSelect });
      if (!row) throw missing('Creative');
      return presentCreative(row);
    });
  }

  async file(actor: Principal, id: string): Promise<StoredObject & { mime: string; filename: string }> {
    const row = await inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      return tx.creative.findUnique({ where: { id }, select: { storageKey: true, mime: true, originalFilename: true } });
    });
    if (!row || !row.storageKey) throw missing('Creative file');
    if (!this.storage) throw unavailable();
    return { ...await this.storage.get(row.storageKey), mime: row.mime, filename: row.originalFilename };
  }

  /** The temporary upload is always removed. Storage writes happen before the DB transaction
   * (a long upload must not hold a serializable transaction); a failed transaction deletes the object.
   */
  async upload(actor: Principal, file: UploadedFile | undefined, dto: UploadCreativeDto): Promise<CreativeResponseDto> {
    try {
      if (!file) throw invalid('A file part is required');
      // Ids used for comparisons and storage keys come from the database row, never from the raw input.
      const advertiserId = await inventoryTransaction(this.db, async tx => {
        await this.sessions.requireAdmin(tx, actor);
        return this.requireAdvertiser(tx, dto.advertiserId);
      });
      if (!this.storage) throw unavailable();
      const storage = this.storage;
      const size = (await stat(file.path)).size;
      if (size <= 0) throw invalid('The file is empty');
      if (size > CREATIVE_MAX_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'File exceeds 200 MB');
      let inspected;
      try { inspected = await inspectMedia(file.path, this.ffprobe); }
      catch (error) {
        if (error instanceof MediaToolUnavailable) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Media inspection is unavailable');
        throw error;
      }
      const checksum = await sha256File(file.path);
      const filename = safeFilename(file.originalname);
      const imageSeconds = dto.displayDurationSeconds;
      if (inspected.ok && inspected.type.kind === 'IMAGE' && !imageSeconds) throw invalid('displayDurationSeconds is required for images');
      if (inspected.ok && inspected.type.kind === 'VIDEO' && imageSeconds) throw invalid('Video duration is measured; omit displayDurationSeconds');
      if (imageSeconds && Number(imageSeconds) > 300) throw invalid('displayDurationSeconds must be at most 300');

      const storageKey = inspected.ok ? `creatives/${advertiserId}/${randomUUID()}` : '';
      try {
        // The put is inside the cleanup scope: a failed or partial write must not leave an object behind.
        if (inspected.ok) await storage.put(storageKey, file.path, inspected.type.mime);
        return await inventoryTransaction(this.db, async tx => {
          await this.sessions.requireAdmin(tx, actor);
          await this.requireAdvertiser(tx, advertiserId);
          let version = 1;
          if (dto.replacesId) {
            const previous = await tx.creative.findUnique({ where: { id: dto.replacesId }, select: { advertiserId: true, version: true } });
            if (!previous) throw missing('Replaced creative');
            if (previous.advertiserId !== advertiserId) throw invalid('A new version must belong to the same advertiser');
            const fork = await tx.creative.findFirst({ where: { replacesId: dto.replacesId, status: { not: 'REJECTED' } }, select: { id: true } });
            if (fork) throw conflict('This creative already has a newer version');
            version = previous.version + 1;
          }
          if (inspected.ok) {
            const duplicate = await tx.creative.findFirst({ where: { advertiserId, checksum, status: { not: 'REJECTED' } },
              select: { id: true, code: true, status: true } });
            if (duplicate) {
              throw new ApiError(409, 'DUPLICATE_CREATIVE', duplicate.status === 'REVOKED'
                ? 'This file matches a revoked creative of the advertiser and cannot be uploaded again'
                : 'This file already exists for the advertiser', { creativeId: duplicate.id, code: duplicate.code, status: duplicate.status });
            }
          }
          const probe = inspected.ok ? inspected.probe : null;
          const row = await tx.creative.create({ data: {
            code: await nextCode(tx, 'creatives', 'CR', 5), advertiserId, storageKey,
            originalFilename: filename, mime: inspected.type?.mime ?? 'application/octet-stream',
            durationSeconds: imageSeconds ? new Prisma.Decimal(imageSeconds) : probe?.durationSeconds != null ? new Prisma.Decimal(probe.durationSeconds) : null,
            durationManual: Boolean(imageSeconds && inspected.ok), width: probe?.width ?? null, height: probe?.height ?? null,
            videoCodec: probe?.videoCodec ?? null, sizeBytes: BigInt(size), checksum,
            status: inspected.ok ? 'VALIDATING' : 'REJECTED', rejectionReason: inspected.ok ? null : inspected.reason,
            version, replacesId: dto.replacesId ?? null, uploadedById: actor.user.id,
          }, select: creativeSelect }).catch((failure: unknown) => {
            // inventoryTransaction folds P2002 into a generic 409, so the race is named here, inside the transaction.
            if (inspected.ok && failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === 'P2002') throw new UploadRace();
            throw failure;
          });
          const after = presentCreative(row);
          await this.audit.append(tx, { userId: actor.user.id, action: inspected.ok ? 'CREATIVE_UPLOADED' : 'CREATIVE_AUTO_REJECTED',
            entityType: 'creative', entityId: row.id, after });
          return after;
        });
      } catch (error) {
        if (storageKey) await storage.delete(storageKey).catch(() => {
          console.error(JSON.stringify({ level: 'error', msg: 'orphan creative object', storageKey }));
        });
        // db.serializable gives up on P2034 after three tries and inventoryTransaction folds that into a generic 409: a
        // same-file race that lost this way is resolved like an UploadRace.
        const foldedConflict = error instanceof ApiError && error.status === 409 && error.code === 'INVALID_STATE_TRANSITION'
          && error.message === 'Inventory conflict; reload and retry';
        if (error instanceof UploadRace || (foldedConflict && inspected.ok)) {
          // A concurrent upload won the partial unique index: report it like the application-level check does.
          const existing = await this.db.creative.findFirst({ where: { advertiserId, checksum, status: { not: 'REJECTED' } },
            select: { id: true, code: true, status: true } });
          if (existing) throw new ApiError(409, 'DUPLICATE_CREATIVE', existing.status === 'REVOKED'
            ? 'This file matches a revoked creative of the advertiser and cannot be uploaded again'
            : 'This file already exists for the advertiser', { creativeId: existing.id, code: existing.code, status: existing.status });
          if (error instanceof UploadRace) {
            if (dto.replacesId) throw conflict('This creative already has a newer version');
            throw conflict('Inventory conflict; reload and retry');
          }
        }
        throw error;
      }
    } finally {
      if (file) await rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  approve(actor: Principal, id: string): Promise<CreativeResponseDto> {
    return this.review(actor, id, 'APPROVED');
  }
  reject(actor: Principal, id: string, dto: RejectCreativeDto): Promise<CreativeResponseDto> {
    return this.review(actor, id, 'REJECTED', dto.reason);
  }

  /** APPROVED → REVOKED (terminal). Every campaign linking the creative gets a fresh planChangedAt (stale CMS
   * proof); READY campaigns drop to DRAFT, LIVE/PAUSED stay (the status is an operator declaration) and show a warning. */
  revoke(actor: Principal, id: string, dto: RevokeCreativeDto): Promise<CreativeResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await tx.creative.findUnique({ where: { id }, select: creativeSelect });
      if (!row) throw missing('Creative');
      if (row.status !== 'APPROVED') throw conflict('Only an approved creative can be revoked');
      const updated = await tx.creative.update({ where: { id }, data: {
        status: 'REVOKED', revokedAt: new Date(), revokedById: actor.user.id, revocationReason: dto.reason }, select: creativeSelect });
      const after = presentCreative(updated);
      await this.audit.append(tx, { userId: actor.user.id, action: 'CREATIVE_REVOKED', entityType: 'creative', entityId: id,
        before: presentCreative(row), after });
      const links = await tx.campaignCreative.findMany({ where: { creativeId: id, campaign: { deletedAt: null, status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
        select: { campaign: { select: { id: true, status: true } } } });
      for (const { campaign } of links) {
        await tx.campaign.update({ where: { id: campaign.id }, data: {
          planChangedAt: new Date(), ...(campaign.status === 'READY' ? { status: 'DRAFT' } : {}) } });
        await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_CREATIVE_REVOKED', entityType: 'campaign', entityId: campaign.id,
          metadata: { creativeId: id, code: row.code, reason: dto.reason } });
        if (campaign.status === 'READY') {
          await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_STATUS_CHANGED', entityType: 'campaign', entityId: campaign.id,
            before: { status: 'READY' }, after: { status: 'DRAFT' }, metadata: { automatic: true, reason: 'CREATIVE_REVOKED', creativeId: id } });
        }
      }
      return after;
    });
  }

  private review(actor: Principal, id: string, to: 'APPROVED' | 'REJECTED', reason?: string) {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await tx.creative.findUnique({ where: { id }, select: creativeSelect });
      if (!row) throw missing('Creative');
      if (row.status !== 'VALIDATING') throw conflict('Only a technically validated creative awaiting review can be approved or rejected');
      const updated = await tx.creative.update({ where: { id }, data: to === 'APPROVED'
        ? { status: 'APPROVED', approvedById: actor.user.id, approvedAt: new Date() }
        : { status: 'REJECTED', rejectionReason: reason }, select: creativeSelect });
      const after = presentCreative(updated);
      await this.audit.append(tx, { userId: actor.user.id, action: to === 'APPROVED' ? 'CREATIVE_APPROVED' : 'CREATIVE_REJECTED',
        entityType: 'creative', entityId: id, before: presentCreative(row), after });
      return after;
    });
  }

  private async requireAdvertiser(tx: Prisma.TransactionClient, id: string): Promise<string> {
    const org = await tx.organization.findUnique({ where: { id }, select: { id: true, type: true, active: true } });
    if (!org || org.type !== 'ADVERTISER' || !org.active) throw invalid('advertiserId must reference an active advertiser organization');
    return org.id;
  }
}

function unavailable() {
  return new ApiError(503, 'STORAGE_UNAVAILABLE', 'Creative storage is not configured');
}

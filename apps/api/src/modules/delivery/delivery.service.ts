import { createHash } from 'node:crypto';
import { DELIVERY_MAX_CSV_BYTES } from '@protarget/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  DeliveryBatchView, DeliveryPreview, DeliveryRecordView, DeliveryRowErrorView, DeliverySource, PageResult,
} from '@protarget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/api-error';
import { Principal } from '../../common/identity';
import { conflict, inventoryTransaction, missing } from '../../common/inventory-validation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AddonsService } from '../addons/addons.service';
import { deliveryKey, parseDeliveryCsv, type ParsedDeliveryRow } from './delivery-csv';
import { DeliveryImportDto, DeliveryRecordQueryDto, VoidDeliveryDto } from './delivery.dto';

/** Campaign context needed to check one CSV line; built from the database. */
export interface DeliveryCampaignRef {
  id: string; startAt: Date; endAt: Date; launchedAt: Date | null;
  screens: Map<string, string>; creatives: Map<string, string>;
}
export interface ResolvedDeliveryRow extends ParsedDeliveryRow {
  campaignId: string; screenId: string; creativeId: string | null; dedupeKey: string;
}
const MAX_REPORTED_ERRORS = 100;

/**
 * Checks parsed lines against bookings and removes duplicates (same file or already imported, not voided).
 * Pure apart from the inputs; the service supplies `campaigns` and `existingKeys`.
 */
/** What makes two rows with the same key the same delivery; a mismatch is a conflict, not a duplicate. */
export interface DeliveryFingerprint { count: number | null; impressions: string | null; durationSeconds: string | null }
const sameDelivery = (a: DeliveryFingerprint, b: DeliveryFingerprint) => a.count === b.count &&
  decimalEq(a.impressions, b.impressions) && decimalEq(a.durationSeconds, b.durationSeconds);
const decimalEq = (a: string | null, b: string | null) => a === b || (a !== null && b !== null && Number(a) === Number(b));

export function resolveDeliveryRows(source: DeliverySource, rows: ParsedDeliveryRow[], campaigns: Map<string, DeliveryCampaignRef>,
  existing: Map<string, DeliveryFingerprint>): { accepted: ResolvedDeliveryRow[]; duplicates: number; errors: DeliveryRowErrorView[] } {
  const accepted: ResolvedDeliveryRow[] = [];
  const errors: DeliveryRowErrorView[] = [];
  const seen = new Map<string, DeliveryFingerprint>();
  let duplicates = 0;
  for (const row of rows) {
    const campaign = campaigns.get(row.campaignCode);
    if (!campaign) { errors.push({ line: row.line, code: 'UNKNOWN_CAMPAIGN', column: 'campaign_code' }); continue; }
    // A campaign that never went live cannot have played; the declaration would be fabricated delivery.
    if (!campaign.launchedAt) { errors.push({ line: row.line, code: 'CAMPAIGN_NOT_LAUNCHED', column: 'campaign_code' }); continue; }
    const screenId = campaign.screens.get(row.screenCode);
    if (!screenId) { errors.push({ line: row.line, code: 'SCREEN_NOT_IN_CAMPAIGN', column: 'screen_code' }); continue; }
    let creativeId: string | null = null;
    if (row.creativeCode) {
      creativeId = campaign.creatives.get(row.creativeCode) ?? null;
      if (!creativeId) { errors.push({ line: row.line, code: 'CREATIVE_NOT_IN_CAMPAIGN', column: 'creative_code' }); continue; }
    }
    if (row.playedAt < campaign.startAt || row.playedAt >= campaign.endAt) {
      errors.push({ line: row.line, code: 'OUTSIDE_FLIGHT', column: 'played_at' }); continue;
    }
    const dedupeKey = deliveryKey(source, { campaignId: campaign.id, screenId, creativeId }, row.playedAt, row.externalId);
    const earlier = seen.get(dedupeKey) ?? existing.get(dedupeKey);
    if (earlier) {
      // Same key but different figures: an aggregated row or a correction; never drop it silently.
      if (sameDelivery(earlier, row)) duplicates++;
      else errors.push({ line: row.line, code: 'CONFLICTING_DUPLICATE' });
      continue;
    }
    seen.set(dedupeKey, row);
    accepted.push({ ...row, campaignId: campaign.id, screenId, creativeId, dedupeKey });
  }
  return { accepted, duplicates, errors };
}

/** Sum of decimal strings with up to 4 fraction digits, exact (no float). */
export function sumDecimals(values: string[]): string {
  let total = 0n;
  for (const value of values) {
    const [whole, fraction = ''] = value.split('.');
    total += BigInt(whole) * 10_000n + BigInt(fraction.padEnd(4, '0'));
  }
  const fraction = (total % 10_000n).toString().padStart(4, '0').replace(/0+$/, '');
  return `${total / 10_000n}${fraction ? `.${fraction}` : ''}`;
}

const recordSelect = {
  id: true, batchId: true, source: true, playedAt: true, count: true, impressions: true, durationSeconds: true, externalId: true,
  voidedAt: true, voidReason: true,
  campaign: { select: { id: true, code: true } }, screen: { select: { id: true, screenId: true } }, creative: { select: { id: true, code: true } },
} satisfies Prisma.DeliveryRecordSelect;
const batchSelect = {
  id: true, source: true, filename: true, note: true, rowCount: true, acceptedCount: true, duplicateCount: true, createdAt: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.DeliveryImportBatchSelect;

export function presentRecord(row: Prisma.DeliveryRecordGetPayload<{ select: typeof recordSelect }>): DeliveryRecordView {
  return {
    id: row.id, batchId: row.batchId, source: row.source,
    campaign: row.campaign, screen: { id: row.screen.id, code: row.screen.screenId }, creative: row.creative,
    playedAt: row.playedAt.toISOString(), count: row.count,
    impressions: row.impressions?.toString() ?? null, durationSeconds: row.durationSeconds?.toString() ?? null,
    externalId: row.externalId, voidedAt: row.voidedAt?.toISOString() ?? null, voidReason: row.voidReason,
  };
}
const presentBatch = (row: Prisma.DeliveryImportBatchGetPayload<{ select: typeof batchSelect }>): DeliveryBatchView =>
  ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class DeliveryService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService, private readonly addons: AddonsService) {}

  preview(actor: Principal, dto: DeliveryImportDto, now = new Date()): Promise<DeliveryPreview> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      return (await this.evaluate(tx, dto, now)).preview;
    });
  }

  import(actor: Principal, dto: DeliveryImportDto, now = new Date()): Promise<DeliveryBatchView> {
    // Same content with another BOM/line-ending style is the same file.
    const normalized = dto.csv.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const fileSha256 = createHash('sha256').update(normalized).digest('hex');
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      if (await tx.deliveryImportBatch.findUnique({ where: { source_fileSha256: { source: dto.source, fileSha256 } }, select: { id: true } })) {
        throw conflict('This file was already imported for this source');
      }
      const { preview, accepted } = await this.evaluate(tx, dto, now);
      // All-or-nothing: a file with any invalid line writes nothing; the preview lists the lines to fix.
      if (preview.errors.length) { // errors are capped for display; any error blocks the import
        throw new ApiError(400, 'VALIDATION_FAILED', 'The file has invalid lines', { errors: preview.errors.slice(0, MAX_REPORTED_ERRORS) });
      }
      const batch = await tx.deliveryImportBatch.create({ select: batchSelect, data: {
        source: dto.source, filename: dto.filename, fileSha256, note: dto.note || null,
        rowCount: preview.rowCount, acceptedCount: preview.accepted, duplicateCount: preview.duplicates, createdById: actor.user.id } });
      if (accepted.length) {
        await tx.deliveryRecord.createMany({ data: accepted.map(row => ({
          batchId: batch.id, source: dto.source, campaignId: row.campaignId, screenId: row.screenId, creativeId: row.creativeId,
          playedAt: row.playedAt, count: row.count, impressions: row.impressions, durationSeconds: row.durationSeconds,
          externalId: row.externalId, dedupeKey: row.dedupeKey })) });
      }
      const after = presentBatch(batch);
      await this.audit.append(tx, { userId: actor.user.id, action: 'DELIVERY_IMPORTED', entityType: 'delivery_import', entityId: batch.id,
        after, metadata: { playouts: preview.playouts, impressions: preview.impressions } });
      return after;
    });
  }

  batches(actor: Principal, query: DeliveryRecordQueryDto): Promise<PageResult<DeliveryBatchView>> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      const where: Prisma.DeliveryImportBatchWhereInput = query.source ? { source: query.source } : {};
      const [rows, total] = await Promise.all([
        tx.deliveryImportBatch.findMany({ where, select: batchSelect, skip: query.skip, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
        tx.deliveryImportBatch.count({ where }),
      ]);
      return { items: rows.map(presentBatch), total, page: query.page, pageSize: query.pageSize };
    });
  }

  records(actor: Principal, query: DeliveryRecordQueryDto): Promise<PageResult<DeliveryRecordView>> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      const where: Prisma.DeliveryRecordWhereInput = {
        ...(query.campaignId ? { campaignId: query.campaignId } : {}), ...(query.screenId ? { screenId: query.screenId } : {}),
        ...(query.batchId ? { batchId: query.batchId } : {}), ...(query.source ? { source: query.source } : {}),
        ...(query.includeVoided ? {} : { voidedAt: null }),
      };
      const [rows, total] = await Promise.all([
        tx.deliveryRecord.findMany({ where, select: recordSelect, skip: query.skip, take: query.pageSize, orderBy: [{ playedAt: 'desc' }, { id: 'asc' }] }),
        tx.deliveryRecord.count({ where }),
      ]);
      return { items: rows.map(presentRecord), total, page: query.page, pageSize: query.pageSize };
    });
  }

  void(actor: Principal, id: string, dto: VoidDeliveryDto, now = new Date()): Promise<DeliveryRecordView> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      const row = await tx.deliveryRecord.findUnique({ where: { id }, select: recordSelect });
      if (!row) throw missing('Delivery record');
      if (row.voidedAt) throw conflict('The record is already voided');
      const after = presentRecord(await tx.deliveryRecord.update({ where: { id }, select: recordSelect,
        data: { voidedAt: now, voidReason: dto.reason, voidedById: actor.user.id } }));
      await this.audit.append(tx, { userId: actor.user.id, action: 'DELIVERY_VOIDED', entityType: 'delivery_record', entityId: id,
        before: presentRecord(row), after, metadata: { reason: dto.reason } });
      return after;
    });
  }

  private async guard(tx: Prisma.TransactionClient, actor: Principal) {
    await this.sessions.requireAdmin(tx, actor);
    await this.addons.requireEnabled(tx, 'proofOfPlay');
  }

  private async evaluate(tx: Prisma.TransactionClient, dto: DeliveryImportDto, now: Date) {
    if (Buffer.byteLength(dto.csv, 'utf8') > DELIVERY_MAX_CSV_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The CSV is too large');
    const parsed = parseDeliveryCsv(dto.csv, dto.source, now);
    const codes = [...new Set(parsed.rows.map(row => row.campaignCode))];
    const found = codes.length ? await tx.campaign.findMany({ where: { code: { in: codes }, deletedAt: null }, select: {
      id: true, code: true, startAt: true, endAt: true, launchedAt: true,
      screens: { select: { screenId: true, screen: { select: { screenId: true } } } },
      creatives: { select: { creative: { select: { id: true, code: true } } } } } }) : [];
    const campaigns = new Map(found.map(c => [c.code, {
      id: c.id, startAt: c.startAt, endAt: c.endAt, launchedAt: c.launchedAt,
      screens: new Map(c.screens.map(s => [s.screen.screenId, s.screenId])),
      creatives: new Map(c.creatives.map(({ creative }) => [creative.code, creative.id])),
    }]));
    const draft = resolveDeliveryRows(dto.source, parsed.rows, campaigns, new Map());
    const existing = draft.accepted.length ? await tx.deliveryRecord.findMany({
      where: { dedupeKey: { in: draft.accepted.map(row => row.dedupeKey) }, voidedAt: null },
      select: { dedupeKey: true, count: true, impressions: true, durationSeconds: true } }) : [];
    const resolved = existing.length
      ? resolveDeliveryRows(dto.source, parsed.rows, campaigns, new Map(existing.map(row => [row.dedupeKey, {
        count: row.count, impressions: row.impressions?.toString() ?? null, durationSeconds: row.durationSeconds?.toString() ?? null }])))
      : draft;
    const errors = [...parsed.errors, ...resolved.errors].sort((a, b) => a.line - b.line);
    const preview: DeliveryPreview = {
      source: dto.source, rowCount: parsed.lineCount,
      accepted: resolved.accepted.length, duplicates: resolved.duplicates,
      errors: errors.slice(0, MAX_REPORTED_ERRORS), errorCount: errors.length,
      playouts: dto.source === 'DECLARED_IMPRESSION' ? null : resolved.accepted.reduce((sum, row) => sum + (row.count ?? 0), 0),
      impressions: dto.source === 'DECLARED_IMPRESSION' ? sumDecimals(resolved.accepted.map(row => row.impressions!)) : null,
    };
    return { preview, accepted: resolved.accepted, errorCount: errors.length };
  }
}

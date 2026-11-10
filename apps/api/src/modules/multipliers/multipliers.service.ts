import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { Principal } from '../../common/identity';
import { conflict, invalid, inventoryTransaction, missing } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { ApproveMultiplierDto, CreateMultiplierDto, MultiplierHistoryDto, MultiplierResponseDto } from './multipliers.dto';

export const multiplierSelect = {
  id: true, screenId: true, value: true, sourceType: true, sourceRef: true, changeReason: true, confidenceNote: true,
  validFrom: true, validTo: true, daypartStart: true, daypartEnd: true, weekdays: true, specificityKey: true,
  approvalStatus: true, version: true, createdBy: true, approvedBy: true, approvedAt: true, supersedesId: true, createdAt: true,
} satisfies Prisma.MultiplierProfileSelect;
type SelectedMultiplier = Prisma.MultiplierProfileGetPayload<{ select: typeof multiplierSelect }>;
export function presentMultiplier(row: SelectedMultiplier): MultiplierResponseDto {
  const { specificityKey: _specificityKey, ...safe } = row;
  return { ...safe, value: row.value.toFixed(4),
    validFrom: row.approvalStatus === 'APPROVED' ? row.validFrom.toISOString() : null,
    validTo: row.approvalStatus === 'APPROVED' ? row.validTo?.toISOString() ?? null : null,
    approvedAt: row.approvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}
export function isWholeScreen(row: Pick<SelectedMultiplier, 'specificityKey' | 'daypartStart' | 'daypartEnd' | 'weekdays'>) {
  return row.specificityKey === '' && row.daypartStart === null && row.daypartEnd === null && row.weekdays.length === 0;
}
export function effectiveMultiplierWhere(screenId: string, asOf: Date): Prisma.MultiplierProfileWhereInput {
  return { screenId, approvalStatus: 'APPROVED', specificityKey: '', daypartStart: null, daypartEnd: null, weekdays: { isEmpty: true },
    validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gt: asOf } }] };
}

@Injectable()
export class MultipliersService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService) {}

  history(actor: Principal, screenId: string, query: PaginationDto): Promise<MultiplierHistoryDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      if (!await tx.screen.findFirst({ where: { id: screenId, deletedAt: null }, select: { id: true } })) throw missing('Screen');
      const asOf = new Date();
      const items = await tx.multiplierProfile.findMany({ where: { screenId }, select: multiplierSelect,
        skip: query.skip, take: query.pageSize, orderBy: { version: 'desc' } });
      const current = await tx.multiplierProfile.findFirst({ where: effectiveMultiplierWhere(screenId, asOf), select: multiplierSelect });
      const latest = await tx.multiplierProfile.findFirst({ where: { screenId }, select: multiplierSelect,
        orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] });
      return { items: items.map(presentMultiplier), total: await tx.multiplierProfile.count({ where: { screenId } }),
        page: query.page, pageSize: query.pageSize, asOf: asOf.toISOString(),
        current: current ? presentMultiplier(current) : null, latest: latest ? presentMultiplier(latest) : null };
    });
  }

  create(actor: Principal, screenId: string, dto: CreateMultiplierDto): Promise<MultiplierResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.lockScreen(tx, screenId);
      const latest = await tx.multiplierProfile.findFirst({ where: { screenId }, orderBy: { version: 'desc' }, select: { version: true } });
      if (latest?.version === 2147483647) throw conflict('Multiplier version limit reached');
      const row = await tx.multiplierProfile.create({ data: {
        screenId, value: new Prisma.Decimal(dto.value), sourceType: 'MANUAL',
        sourceRef: dto.sourceRef, changeReason: dto.changeReason, createdBy: actor.user.id,
        version: (latest?.version ?? 0) + 1, approvalStatus: 'DRAFT',
        // Existing schema requires a date. Draft dates are never effective or exposed as approved dates.
        validFrom: new Date(), validTo: null, weekdays: [], specificityKey: '',
      }, select: multiplierSelect });
      const after = presentMultiplier(row);
      await this.audit.append(tx, { userId: actor.user.id, action: 'MULTIPLIER_DRAFT_CREATED',
        entityType: 'multiplier', entityId: row.id, after });
      return after;
    });
  }

  approve(actor: Principal, screenId: string, id: string, dto: ApproveMultiplierDto): Promise<MultiplierResponseDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.lockScreen(tx, screenId);
      const row = await tx.multiplierProfile.findFirst({ where: { id, screenId }, select: multiplierSelect });
      if (!row) throw missing('Multiplier');
      if (row.approvalStatus !== 'DRAFT') throw conflict('Only a draft can be approved');
      if (row.sourceType !== 'MANUAL' || !isWholeScreen(row) || !row.changeReason?.trim() || !row.sourceRef.trim()) {
        throw conflict('Only whole-screen manual drafts with a reference and reason can be approved');
      }
      const now = new Date();
      const from = dto.validFrom === undefined ? now : new Date(dto.validFrom);
      const to = dto.validTo == null ? null : new Date(dto.validTo);
      if (!Number.isFinite(from.getTime()) || (to && !Number.isFinite(to.getTime()))) throw invalid('Invalid approval timestamp');
      if (from < now) throw conflict('Approval cannot be backdated; omit validFrom to use server-now');
      if (to && to <= from) throw invalid('validTo must be later than validFrom');

      let predecessor: SelectedMultiplier | null = null;
      if (dto.supersedesId) {
        predecessor = await tx.multiplierProfile.findFirst({ where: { id: dto.supersedesId, screenId }, select: multiplierSelect });
        if (!predecessor || predecessor.approvalStatus !== 'APPROVED' || predecessor.validTo !== null ||
            predecessor.validFrom >= from || !isWholeScreen(predecessor)) {
          throw conflict('The selected predecessor is stale or is not an earlier open whole-screen approval');
        }
      }
      // Do not rely solely on the DB exclusion: it permits distinct legacy daypart keys.
      const overlap = await tx.multiplierProfile.findFirst({ where: {
        screenId, approvalStatus: 'APPROVED',
        ...(predecessor ? { id: { not: predecessor.id } } : {}),
        ...(to ? { validFrom: { lt: to } } : {}),
        OR: [{ validTo: null }, { validTo: { gt: from } }],
      }, select: { id: true } });
      if (overlap) throw conflict('Approval overlaps an existing approved profile; explicitly select the open predecessor');

      if (predecessor) {
        const closed = await tx.multiplierProfile.update({ where: { id: predecessor.id }, data: { validTo: from }, select: multiplierSelect });
        await this.audit.append(tx, { userId: actor.user.id, action: 'MULTIPLIER_SUPERSEDED',
          entityType: 'multiplier', entityId: predecessor.id,
          before: presentMultiplier(predecessor), after: presentMultiplier(closed), metadata: { replacementId: id, changeReason: row.changeReason } });
      }
      const after = presentMultiplier(await tx.multiplierProfile.update({ where: { id }, data: {
        approvalStatus: 'APPROVED', approvedBy: actor.user.id, approvedAt: now,
        validFrom: from, validTo: to, supersedesId: predecessor?.id ?? null,
      }, select: multiplierSelect }));
      await this.audit.append(tx, { userId: actor.user.id, action: 'MULTIPLIER_APPROVED',
        entityType: 'multiplier', entityId: id, before: presentMultiplier(row), after });
      return after;
    });
  }

  /** A no-op row write serializes the entire screen timeline and forces stale snapshots to retry.
   * A SELECT FOR UPDATE alone would allow a waiter to allocate from its earlier snapshot.
   * Explicit updatedAt preserves the screen metadata timestamp.
   */
  private async lockScreen(tx: Prisma.TransactionClient, screenId: string) {
    const screen = await tx.screen.findFirst({ where: { id: screenId, deletedAt: null }, select: { updatedAt: true } });
    if (!screen) throw missing('Screen');
    await tx.screen.update({ where: { id: screenId }, data: { updatedAt: screen.updatedAt }, select: { id: true } });
  }
}

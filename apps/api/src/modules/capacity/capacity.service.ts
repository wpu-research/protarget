import { Injectable } from '@nestjs/common';
import { CampaignStatus, Prisma } from '@prisma/client';
import {
  CAPACITY_IGNORED_STATUSES, type CapacityReport, type PageResult, type ScreenHoldView,
} from '@protarget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Principal } from '../../common/identity';
import { conflict, inventoryTransaction, invalid, missing } from '../../common/inventory-validation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AddonsService } from '../addons/addons.service';
import { screenCapacity } from './capacity-calc';
import { CapacityQueryDto, CreateHoldDto, HoldQueryDto, ReleaseHoldDto } from './capacity.dto';

const DAY = 86_400_000;
/** A hold may cover at most a year; keeps a typo from reserving a screen indefinitely. */
const MAX_HOLD_MS = 366 * DAY;
const holdSelect = {
  id: true, screenId: true, label: true, startAt: true, endAt: true, slots: true, expiresAt: true, note: true,
  createdAt: true, releasedAt: true, releaseReason: true,
  screen: { select: { screenId: true } }, createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ScreenHoldSelect;
type HoldRow = Prisma.ScreenHoldGetPayload<{ select: typeof holdSelect }>;

export function presentHold(row: HoldRow, now: Date): ScreenHoldView {
  return {
    id: row.id, screenId: row.screenId, screenCode: row.screen.screenId, label: row.label,
    startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), slots: row.slots,
    expiresAt: row.expiresAt.toISOString(), note: row.note, createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    releasedAt: row.releasedAt?.toISOString() ?? null, releaseReason: row.releaseReason,
    state: row.releasedAt ? 'RELEASED'
      : Math.min(row.expiresAt.getTime(), row.endAt.getTime()) <= now.getTime() ? 'EXPIRED' : 'ACTIVE',
  };
}

/** Screen-specific dayparts win over campaign-wide ones (screenId null). */
export function screenSchedule<T extends { screenId: string | null; dayOfWeek: number; startTime: string; endTime: string }>(rows: T[], screenId: string) {
  const own = rows.filter(row => row.screenId === screenId);
  return (own.length ? own : rows.filter(row => row.screenId === null)).map(({ dayOfWeek, startTime, endTime }) => ({ dayOfWeek, startTime, endTime }));
}

@Injectable()
export class CapacityService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService, private readonly addons: AddonsService) {}

  report(actor: Principal, query: CapacityQueryDto, now = new Date()): Promise<CapacityReport> {
    const from = new Date(`${query.from}T00:00:00.000Z`);
    if (Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== query.from) throw invalid('from must be a real calendar day');
    const to = new Date(from.getTime() + query.days * DAY);
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.addons.requireEnabled(tx, 'capacity');
      const where: Prisma.ScreenWhereInput = { active: true, deletedAt: null, venue: { active: true },
        ...(query.venueId ? { venueId: query.venueId } : {}) };
      const [screens, total] = await Promise.all([
        tx.screen.findMany({ where, skip: query.skip, take: query.pageSize, orderBy: [{ screenId: 'asc' }],
          select: { id: true, screenId: true, name: true, loopLengthSec: true, defaultSlotLengthSec: true, venue: { select: { name: true } } } }),
        tx.screen.count({ where }),
      ]);
      const ids = screens.map(screen => screen.id);
      const [bookings, holds] = await Promise.all([
        tx.campaignScreen.findMany({
          where: { screenId: { in: ids }, active: true, campaign: {
            deletedAt: null, status: { notIn: [...CAPACITY_IGNORED_STATUSES] as CampaignStatus[] },
            startAt: { lt: to }, endAt: { gt: from } } },
          select: { screenId: true, campaign: { select: { id: true, code: true, status: true, startAt: true, endAt: true, timezone: true,
            schedules: { select: { screenId: true, dayOfWeek: true, startTime: true, endTime: true } } } } },
        }),
        tx.screenHold.findMany({
          where: { screenId: { in: ids }, releasedAt: null, expiresAt: { gt: now }, startAt: { lt: to }, endAt: { gt: from } },
          select: { id: true, screenId: true, label: true, startAt: true, endAt: true, slots: true, expiresAt: true },
        }),
      ]);
      const items = screens.map(screen => {
        const result = screenCapacity(screen, from, query.days,
          bookings.filter(row => row.screenId === screen.id).map(({ campaign }) => ({
            campaignId: campaign.id, code: campaign.code, status: campaign.status,
            startAt: campaign.startAt, endAt: campaign.endAt, timezone: campaign.timezone,
            schedule: screenSchedule(campaign.schedules, screen.id) })),
          // A hold stops counting when it expires, even if its window runs longer.
          holds.filter(hold => hold.screenId === screen.id).map(hold => ({ ...hold,
            endAt: hold.expiresAt.getTime() < hold.endAt.getTime() ? hold.expiresAt : hold.endAt })));
        return { screenId: screen.id, screenCode: screen.screenId, screenName: screen.name, venueName: screen.venue.name,
          loopLengthSec: screen.loopLengthSec, defaultSlotLengthSec: screen.defaultSlotLengthSec, ...result };
      });
      return { from: from.toISOString(), days: query.days, generatedAt: now.toISOString(),
        items, total, page: query.page, pageSize: query.pageSize };
    });
  }

  holds(actor: Principal, query: HoldQueryDto, now = new Date()): Promise<PageResult<ScreenHoldView>> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.addons.requireEnabled(tx, 'capacity');
      const where: Prisma.ScreenHoldWhereInput = { ...(query.screenId ? { screenId: query.screenId } : {}),
        ...(query.activeOnly ? { releasedAt: null, expiresAt: { gt: now }, endAt: { gt: now } } : {}) };
      const [rows, total] = await Promise.all([
        tx.screenHold.findMany({ where, select: holdSelect, skip: query.skip, take: query.pageSize,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
        tx.screenHold.count({ where }),
      ]);
      return { items: rows.map(row => presentHold(row, now)), total, page: query.page, pageSize: query.pageSize };
    });
  }

  createHold(actor: Principal, dto: CreateHoldDto, now = new Date()): Promise<ScreenHoldView> {
    const startAt = new Date(dto.startAt), endAt = new Date(dto.endAt), expiresAt = new Date(dto.expiresAt);
    if (endAt.getTime() <= startAt.getTime()) throw invalid('endAt must be after startAt');
    if (endAt.getTime() - startAt.getTime() > MAX_HOLD_MS) throw invalid('A hold may cover at most 366 days');
    if (expiresAt.getTime() <= now.getTime()) throw invalid('expiresAt must be in the future');
    if (expiresAt.getTime() <= startAt.getTime()) throw invalid('expiresAt must be after startAt');
    if (endAt.getTime() <= now.getTime()) throw invalid('The hold must end in the future');
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.addons.requireEnabled(tx, 'capacity');
      const screen = await tx.screen.findFirst({ where: { id: dto.screenId, deletedAt: null }, select: { active: true } });
      if (!screen) throw missing('Screen');
      if (!screen.active) throw conflict('Holds can only be placed on active screens');
      const row = await tx.screenHold.create({ select: holdSelect, data: {
        screenId: dto.screenId, label: dto.label, startAt, endAt, slots: dto.slots, expiresAt,
        note: dto.note || null, createdById: actor.user.id } });
      const after = presentHold(row, now);
      await this.audit.append(tx, { userId: actor.user.id, action: 'SCREEN_HOLD_CREATED', entityType: 'screen_hold', entityId: row.id, after });
      return after;
    });
  }

  releaseHold(actor: Principal, id: string, dto: ReleaseHoldDto, now = new Date()): Promise<ScreenHoldView> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.addons.requireEnabled(tx, 'capacity');
      const row = await tx.screenHold.findUnique({ where: { id }, select: holdSelect });
      if (!row) throw missing('Hold');
      if (row.releasedAt) throw conflict('The hold is already released');
      const updated = await tx.screenHold.update({ where: { id }, select: holdSelect,
        data: { releasedAt: now, releaseReason: dto.reason } });
      const after = presentHold(updated, now);
      await this.audit.append(tx, { userId: actor.user.id, action: 'SCREEN_HOLD_RELEASED', entityType: 'screen_hold', entityId: id,
        before: presentHold(row, now), after, metadata: { reason: dto.reason } });
      return after;
    });
  }
}

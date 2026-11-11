import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BOOKING_LIMITED_EDIT, BOOKING_PLAN_EDITABLE, BOOKING_REASON_REQUIRED, canBookingTransition, isBookingStatus,
  type BookingStatus,
} from '@protarget/shared';
import { ApiError } from '../../common/api-error';
import { nextCode } from '../../common/codes';
import { Principal } from '../../common/identity';
import { conflict, invalid, inventoryTransaction, missing, requirePatch } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { creativeSelect, presentCreative } from '../creatives/creatives.service';
import { findScheduleOverlap, validateBooking, weeklyWindowHours } from './booking-rules';
import {
  ActivityPageDto, CampaignDetailDto, CampaignPageDto, CampaignQueryDto, CampaignScreenDto, CampaignSummaryDto,
  CampaignValidationDto, CmsOperationDto, CmsOperationPageDto, CmsOperationQueryDto, CreateCampaignDto, CreateCmsOperationDto,
  CreativeLinkDto, ReplaceScheduleDto, ScreenIdsDto, ScreenOptionPageDto, ScreenOptionQueryDto, TransitionDto, UpdateCampaignDto,
} from './campaigns.dto';

type Tx = Prisma.TransactionClient;
const org = { select: { id: true, name: true, type: true } } as const;
const summarySelect = {
  id: true, code: true, name: true, status: true, startAt: true, endAt: true, timezone: true, primaryGoal: true,
  targetPlayouts: true, targetImpressions: true, createdAt: true, updatedAt: true, planChangedAt: true, advertiserId: true,
  advertiser: org, agency: org, internalOwner: { select: { id: true, name: true } },
  _count: { select: { screens: true, creatives: true } },
} satisfies Prisma.CampaignSelect;
const screenFields = {
  id: true, screenId: true, name: true, active: true, deletedAt: true, timezone: true, resolutionWidth: true, resolutionHeight: true,
  orientation: true, operatingStart: true, operatingEnd: true, loopLengthSec: true, defaultSlotLengthSec: true,
  venue: { select: { name: true, city: true, active: true } },
} satisfies Prisma.ScreenSelect;
const detailSelect = {
  ...summarySelect, notes: true, maxPlayoutsPerHourPerScreen: true, launchedAt: true, completedAt: true, createdAt: true,
  pricingModel: true, currency: true, unitPrice: true, budget: true, contractedAmount: true, guaranteedImpressions: true,
  contractedQuantity: true, overdeliveryTolerancePct: true, pgBillingBasis: true, publisherSharePct: true, protargetSharePct: true,
  screens: { select: { screen: { select: screenFields } }, orderBy: { screen: { screenId: 'asc' } } },
  creatives: { select: { creative: { select: creativeSelect } }, orderBy: { createdAt: 'asc' } },
  schedules: { select: { dayOfWeek: true, startTime: true, endTime: true }, where: { screenId: null },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
} satisfies Prisma.CampaignSelect;
type SummaryRow = Prisma.CampaignGetPayload<{ select: typeof summarySelect }>;
type DetailRow = Prisma.CampaignGetPayload<{ select: typeof detailSelect }>;
type ScreenRow = Prisma.ScreenGetPayload<{ select: typeof screenFields }>;

const dec = (value: Prisma.Decimal | null, places: number) => value?.toFixed(places) ?? null;
const big = (value: bigint | null) => value?.toString() ?? null;

function presentSummary(row: SummaryRow, now = new Date()): CampaignSummaryDto {
  return {
    id: row.id, code: row.code, name: row.name, status: row.status,
    advertiser: row.advertiser, agency: row.agency ?? null, internalOwner: row.internalOwner,
    startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), timezone: row.timezone,
    primaryGoal: row.primaryGoal, targetPlayouts: big(row.targetPlayouts), targetImpressions: big(row.targetImpressions),
    screenCount: row._count.screens, creativeCount: row._count.creatives,
    flightEnded: (row.status === 'LIVE' || row.status === 'PAUSED') && row.endAt <= now,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    planChangedAt: row.planChangedAt.toISOString(),
  };
}
/** Audit snapshot: scalar booking fields only (relations are audited by their own actions). */
function snapshot(row: DetailRow) {
  return {
    code: row.code, name: row.name, status: row.status, advertiserId: row.advertiser.id, agencyId: row.agency?.id ?? null,
    internalOwnerId: row.internalOwner.id, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(),
    timezone: row.timezone, notes: row.notes, primaryGoal: row.primaryGoal, targetPlayouts: big(row.targetPlayouts),
    targetImpressions: big(row.targetImpressions), maxPlayoutsPerHourPerScreen: row.maxPlayoutsPerHourPerScreen,
    ...commercial(row),
  };
}
function commercial(row: DetailRow) {
  return {
    pricingModel: row.pricingModel, currency: row.currency, unitPrice: dec(row.unitPrice, 4), budget: dec(row.budget, 4),
    contractedAmount: dec(row.contractedAmount, 4), guaranteedImpressions: big(row.guaranteedImpressions),
    contractedQuantity: big(row.contractedQuantity), overdeliveryTolerancePct: row.overdeliveryTolerancePct.toFixed(2),
    pgBillingBasis: row.pgBillingBasis, publisherSharePct: dec(row.publisherSharePct, 2), protargetSharePct: dec(row.protargetSharePct, 2),
  };
}

const PLAN_FIELDS = ['name', 'advertiserId', 'agencyId', 'internalOwnerId', 'startAt', 'endAt', 'timezone', 'primaryGoal',
  'targetPlayouts', 'targetImpressions', 'maxPlayoutsPerHourPerScreen', 'pricingModel', 'currency', 'unitPrice', 'budget',
  'contractedAmount', 'guaranteedImpressions', 'contractedQuantity', 'overdeliveryTolerancePct', 'pgBillingBasis',
  'publisherSharePct', 'protargetSharePct'] as const;

const DECIMAL_PLACES: Record<string, number> = { unitPrice: 4, budget: 4, contractedAmount: 4, overdeliveryTolerancePct: 2,
  publisherSharePct: 2, protargetSharePct: 2 };
const BIGINT_FIELDS = ['targetPlayouts', 'targetImpressions', 'guaranteedImpressions', 'contractedQuantity'];
/** Stored values in the same normalized form as `incomingValue` (Decimal/BigInt/date strings compared as values). */
function storedValues(row: DetailRow): Record<string, unknown> {
  return {
    name: row.name, advertiserId: row.advertiser.id, agencyId: row.agency?.id ?? null, internalOwnerId: row.internalOwner.id,
    startAt: row.startAt.getTime(), endAt: row.endAt.getTime(), timezone: row.timezone, notes: row.notes,
    primaryGoal: row.primaryGoal, targetPlayouts: big(row.targetPlayouts), targetImpressions: big(row.targetImpressions),
    maxPlayoutsPerHourPerScreen: row.maxPlayoutsPerHourPerScreen, pricingModel: row.pricingModel, currency: row.currency,
    unitPrice: dec(row.unitPrice, 4), budget: dec(row.budget, 4), contractedAmount: dec(row.contractedAmount, 4),
    guaranteedImpressions: big(row.guaranteedImpressions), contractedQuantity: big(row.contractedQuantity),
    overdeliveryTolerancePct: row.overdeliveryTolerancePct.toFixed(2), pgBillingBasis: row.pgBillingBasis,
    publisherSharePct: dec(row.publisherSharePct, 2), protargetSharePct: dec(row.protargetSharePct, 2),
  };
}
function incomingValue(key: string, value: unknown): unknown {
  if (key === 'startAt' || key === 'endAt') return new Date(value as string).getTime();
  if (key === 'notes') return value ? value : null;
  if (key in DECIMAL_PLACES) return value == null ? null : new Prisma.Decimal(value as string).toFixed(DECIMAL_PLACES[key]);
  if (BIGINT_FIELDS.includes(key)) return value == null ? null : BigInt(value as string).toString();
  return value ?? null;
}
const scheduleKey = (slots: { dayOfWeek: number; startTime: string; endTime: string }[]) =>
  slots.map(slot => `${slot.dayOfWeek}|${slot.startTime}|${slot.endTime}`).sort().join(',');

@Injectable()
export class CampaignsService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService) {}

  list(actor: Principal, query: CampaignQueryDto): Promise<CampaignPageDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const where: Prisma.CampaignWhereInput = { deletedAt: null,
        ...(query.status ? { status: query.status } : {}),
        ...(query.advertiserId ? { advertiserId: query.advertiserId } : {}),
        ...(query.agencyId ? { agencyId: query.agencyId } : {}),
        ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } }] } : {}),
      };
      const [items, total] = await Promise.all([
        tx.campaign.findMany({ where, select: summarySelect, skip: query.skip, take: query.pageSize,
          orderBy: [{ startAt: 'desc' }, { id: 'desc' }] }),
        tx.campaign.count({ where }),
      ]);
      const now = new Date();
      return { items: items.map(row => presentSummary(row, now)), total, page: query.page, pageSize: query.pageSize };
    });
  }

  get(actor: Principal, id: string): Promise<CampaignDetailDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      return this.detail(tx, id);
    });
  }

  create(actor: Principal, dto: CreateCampaignDto): Promise<CampaignDetailDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.checkReferences(tx, dto);
      const startAt = new Date(dto.startAt); const endAt = new Date(dto.endAt);
      if (endAt <= startAt) throw invalid('endAt must be later than startAt');
      const row = await tx.campaign.create({ data: {
        code: await nextCode(tx, 'campaigns', 'CMP', 4), name: dto.name, advertiserId: dto.advertiserId,
        agencyId: dto.agencyId ?? null, internalOwnerId: dto.internalOwnerId, startAt, endAt, timezone: dto.timezone,
        notes: dto.notes || null, status: 'DRAFT',
      }, select: { id: true } });
      const after = await this.detail(tx, row.id);
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_CREATED', entityType: 'campaign', entityId: row.id,
        after: await this.snapshotOf(tx, row.id) });
      return after;
    });
  }

  update(actor: Principal, id: string, dto: UpdateCampaignDto): Promise<CampaignDetailDto> {
    requirePatch(dto);
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await this.load(tx, id);
      const status = row.status;
      if (!BOOKING_LIMITED_EDIT.includes(status as BookingStatus) && !BOOKING_PLAN_EDITABLE.includes(status as BookingStatus)) {
        throw conflict('This booking is read-only');
      }
      // Only values that really differ count as edits; unchanged fields (e.g. a wizard resending everything) are ignored.
      const stored = storedValues(row);
      const keys = (Object.keys(dto) as (keyof UpdateCampaignDto)[]).filter(key => dto[key] !== undefined
        && incomingValue(key, dto[key]) !== stored[key]);
      if (keys.length === 0) return this.detail(tx, id);
      const changed = new Set<string>(keys);
      if (BOOKING_LIMITED_EDIT.includes(status as BookingStatus)) {
        if (keys.some(key => key !== 'notes' && key !== 'endAt')) throw conflict('Only notes and a later end can change while live or paused');
        if (dto.endAt && changed.has('endAt') && new Date(dto.endAt) <= row.endAt) throw conflict('The end can only be extended while live or paused');
        if (dto.endAt && changed.has('endAt') && new Date(dto.endAt) <= new Date()) throw invalid('The extended end must be in the future');
      }
      if (changed.has('advertiserId') && row._count.creatives > 0) {
        throw conflict('Unlink creatives before changing the advertiser');
      }
      await this.checkReferences(tx, {
        advertiserId: changed.has('advertiserId') ? dto.advertiserId : undefined,
        agencyId: changed.has('agencyId') ? dto.agencyId : undefined,
        internalOwnerId: changed.has('internalOwnerId') ? dto.internalOwnerId : undefined });
      const startAt = dto.startAt ? new Date(dto.startAt) : row.startAt;
      const endAt = dto.endAt ? new Date(dto.endAt) : row.endAt;
      if (endAt <= startAt) throw invalid('endAt must be later than startAt');
      if (changed.has('publisherSharePct') || changed.has('protargetSharePct')) {
        const publisher = dto.publisherSharePct !== undefined ? dto.publisherSharePct : dec(row.publisherSharePct, 2);
        const protarget = dto.protargetSharePct !== undefined ? dto.protargetSharePct : dec(row.protargetSharePct, 2);
        if (publisher != null && protarget != null && !new Prisma.Decimal(publisher).plus(protarget).equals(100)) {
          throw invalid('publisherSharePct + protargetSharePct must equal 100');
        }
      }
      const pick = <K extends keyof UpdateCampaignDto>(key: K) => changed.has(key) ? dto[key] : undefined;
      const decimal = (value: string | null | undefined) => value === undefined ? undefined : value === null ? null : new Prisma.Decimal(value);
      const bigint = (value: string | null | undefined) => value === undefined ? undefined : value === null ? null : BigInt(value);
      const before = snapshot(row);
      const planChanged = keys.some(key => (PLAN_FIELDS as readonly string[]).includes(key));
      await tx.campaign.update({ where: { id }, data: {
        name: pick('name'), advertiserId: pick('advertiserId'), agencyId: pick('agencyId'), internalOwnerId: pick('internalOwnerId'),
        startAt: changed.has('startAt') ? startAt : undefined, endAt: changed.has('endAt') ? endAt : undefined, timezone: pick('timezone'),
        notes: changed.has('notes') ? dto.notes || null : undefined,
        primaryGoal: pick('primaryGoal'), targetPlayouts: bigint(pick('targetPlayouts')), targetImpressions: bigint(pick('targetImpressions')),
        maxPlayoutsPerHourPerScreen: pick('maxPlayoutsPerHourPerScreen'), pricingModel: pick('pricingModel'), currency: pick('currency'),
        unitPrice: decimal(pick('unitPrice')), budget: decimal(pick('budget')), contractedAmount: decimal(pick('contractedAmount')),
        guaranteedImpressions: bigint(pick('guaranteedImpressions')), contractedQuantity: bigint(pick('contractedQuantity')),
        overdeliveryTolerancePct: decimal(pick('overdeliveryTolerancePct')) ?? undefined, pgBillingBasis: pick('pgBillingBasis'),
        publisherSharePct: decimal(pick('publisherSharePct')), protargetSharePct: decimal(pick('protargetSharePct')),
        ...(planChanged ? { planChangedAt: new Date() } : {}),
      } });
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_UPDATED', entityType: 'campaign', entityId: id,
        before, after: await this.snapshotOf(tx, id), metadata: { fields: keys } });
      if (planChanged) await this.revertReady(tx, actor, id, status);
      return this.detail(tx, id);
    });
  }

  archive(actor: Principal, id: string): Promise<void> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await this.load(tx, id);
      if (row.status !== 'DRAFT') throw conflict('Only a draft booking can be deleted');
      await tx.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_DELETED', entityType: 'campaign', entityId: id,
        before: snapshot(row) });
    });
  }

  screenOptions(actor: Principal, id: string, query: ScreenOptionQueryDto): Promise<ScreenOptionPageDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const campaign = await this.load(tx, id);
      const selectedIds = (await tx.campaignScreen.findMany({ where: { campaignId: id }, select: { screenId: true } })).map(row => row.screenId);
      // Already-selected screens stay visible even when deactivated or deleted since (so they can be reviewed/removed).
      const where: Prisma.ScreenWhereInput = {
        ...(query.selected === true ? { id: { in: selectedIds } } : { deletedAt: null, active: true, venue: { active: true } }),
        ...(query.selected === false ? { id: { notIn: selectedIds } } : {}),
        ...(query.venueId ? { venueId: query.venueId } : {}),
        ...(query.city ? { venue: { ...(query.selected === true ? {} : { active: true }), city: { equals: query.city, mode: 'insensitive' } } } : {}),
        ...(query.orientation ? { orientation: query.orientation } : {}),
        ...(query.search ? { OR: [{ screenId: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } }] } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.screen.findMany({ where, select: screenFields, skip: query.skip, take: query.pageSize, orderBy: { screenId: 'asc' } }),
        tx.screen.count({ where }),
      ]);
      const rowsOut = await this.screenRows(tx, campaign, rows);
      const selected = new Set(selectedIds);
      return { items: rowsOut.map(row => ({ ...row, selected: selected.has(row.screenId) })), total, page: query.page, pageSize: query.pageSize };
    });
  }

  addScreens(actor: Principal, id: string, dto: ScreenIdsDto): Promise<CampaignDetailDto> {
    return this.planEdit(actor, id, async (tx, row) => {
      const screens = await tx.screen.findMany({ where: { id: { in: dto.screenIds }, deletedAt: null, active: true, venue: { active: true } },
        select: { id: true, screenId: true } });
      if (screens.length !== dto.screenIds.length) {
        const found = new Set(screens.map(screen => screen.id));
        throw new ApiError(409, 'INVALID_STATE_TRANSITION', 'Only active screens on active ships can be added',
          { unavailable: dto.screenIds.filter(screenId => !found.has(screenId)) });
      }
      const result = await tx.campaignScreen.createMany({ data: screens.map(screen => ({ campaignId: id, screenId: screen.id })), skipDuplicates: true });
      if (result.count === 0) return false;
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_SCREENS_ADDED', entityType: 'campaign', entityId: row.id,
        metadata: { screens: screens.map(screen => screen.screenId), added: result.count } });
      return true;
    });
  }

  removeScreens(actor: Principal, id: string, dto: ScreenIdsDto): Promise<CampaignDetailDto> {
    return this.planEdit(actor, id, async (tx, row) => {
      const linked = await tx.campaignScreen.findMany({ where: { campaignId: id, screenId: { in: dto.screenIds } },
        select: { screen: { select: { screenId: true } } } });
      const removed = await tx.campaignScreen.deleteMany({ where: { campaignId: id, screenId: { in: dto.screenIds } } });
      if (removed.count === 0) return false;
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_SCREENS_REMOVED', entityType: 'campaign', entityId: row.id,
        metadata: { screens: linked.map(link => link.screen.screenId) } });
      return true;
    });
  }

  linkCreative(actor: Principal, id: string, dto: CreativeLinkDto): Promise<CampaignDetailDto> {
    return this.planEdit(actor, id, async (tx, row) => {
      const creative = await tx.creative.findUnique({ where: { id: dto.creativeId }, select: { advertiserId: true, status: true, code: true } });
      if (!creative) throw missing('Creative');
      if (creative.advertiserId !== row.advertiser.id) throw invalid('The creative belongs to another advertiser');
      if (creative.status === 'REJECTED') throw conflict('A rejected creative cannot be linked');
      if (creative.status === 'REVOKED') throw conflict('A revoked creative cannot be linked');
      const existing = await tx.campaignCreative.findUnique({ where: { campaignId_creativeId: { campaignId: id, creativeId: dto.creativeId } } });
      if (existing) throw conflict('The creative is already linked');
      await tx.campaignCreative.create({ data: { campaignId: id, creativeId: dto.creativeId } });
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_CREATIVE_LINKED', entityType: 'campaign', entityId: id,
        metadata: { creativeId: dto.creativeId, code: creative.code } });
      return true;
    });
  }

  unlinkCreative(actor: Principal, id: string, dto: CreativeLinkDto): Promise<CampaignDetailDto> {
    return this.planEdit(actor, id, async tx => {
      const removed = await tx.campaignCreative.deleteMany({ where: { campaignId: id, creativeId: dto.creativeId } });
      if (removed.count === 0) throw missing('Linked creative');
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_CREATIVE_UNLINKED', entityType: 'campaign', entityId: id,
        metadata: { creativeId: dto.creativeId } });
      return true;
    }, async tx => {
      // The only exception to the plan lock: a revoked creative can be taken out of a LIVE/PAUSED booking.
      const creative = await tx.creative.findUnique({ where: { id: dto.creativeId }, select: { status: true } });
      return creative?.status === 'REVOKED';
    });
  }

  replaceSchedule(actor: Principal, id: string, dto: ReplaceScheduleDto): Promise<CampaignDetailDto> {
    if (dto.slots.some(slot => slot.startTime === slot.endTime)) throw invalid('A daypart start and end must differ');
    const overlap = findScheduleOverlap(dto.slots);
    if (overlap >= 0) throw invalid(`Daypart ${overlap + 1} overlaps another daypart`);
    return this.planEdit(actor, id, async (tx, row) => {
      const before = row.schedules;
      if (scheduleKey(before) === scheduleKey(dto.slots)) return false;
      // Only campaign-wide dayparts are replaced; legacy per-screen rows are left untouched.
      await tx.schedule.deleteMany({ where: { campaignId: id, screenId: null } });
      if (dto.slots.length) await tx.schedule.createMany({ data: dto.slots.map(slot => ({ campaignId: id, ...slot })) });
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_SCHEDULE_REPLACED', entityType: 'campaign', entityId: id,
        before, after: dto.slots });
      return true;
    });
  }

  validation(actor: Principal, id: string): Promise<CampaignValidationDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      return this.validate(tx, await this.load(tx, id));
    });
  }

  transition(actor: Principal, id: string, dto: TransitionDto): Promise<CampaignDetailDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await this.load(tx, id);
      const from = row.status;
      if (!isBookingStatus(from) || !canBookingTransition(from, dto.to)) {
        throw conflict(`Transition ${from} → ${dto.to} is not allowed`);
      }
      if (BOOKING_REASON_REQUIRED.includes(`${from}>${dto.to}`) && !dto.reason) throw invalid('A reason is required for this transition');
      let metadata: Record<string, unknown> = { reason: dto.reason ?? null };
      if (dto.to === 'READY' || dto.to === 'LIVE') {
        const check = await this.validate(tx, row);
        if (dto.to === 'LIVE' && row.endAt <= new Date() && !check.blockers.some(item => item.code === 'INVALID_FLIGHT')) {
          // Going live (also resuming from PAUSED) needs a flight that has not already ended.
          check.blockers.push({ code: 'INVALID_FLIGHT', screens: [] });
        }
        if (check.blockers.length) {
          throw new ApiError(409, 'CAMPAIGN_NOT_READY', 'The booking has blockers', { blockers: check.blockers });
        }
        if (dto.to === 'LIVE' && check.missingCmsUpload.length) {
          throw new ApiError(409, 'CAMPAIGN_NOT_READY', 'Record the CMS upload for every screen first', { missingCmsUpload: check.missingCmsUpload });
        }
      }
      if (dto.to === 'LIVE' || dto.to === 'PAUSED') {
        const expected = dto.to === 'PAUSED' ? 'PLAYBACK_PAUSED' : from === 'PAUSED' ? 'PLAYBACK_RESUMED' : 'PLAYBACK_STARTED';
        metadata = { ...metadata, declaration: 'OPERATOR_DECLARED', screensWithoutMatchingCmsRecord: await this.screensLacking(tx, id, expected, row) };
      }
      const now = new Date();
      await tx.campaign.update({ where: { id }, data: { status: dto.to,
        ...(dto.to === 'LIVE' && !row.launchedAt ? { launchedAt: now } : {}),
        ...(dto.to === 'COMPLETED' ? { completedAt: now } : {}) } });
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_STATUS_CHANGED', entityType: 'campaign', entityId: id,
        before: { status: from }, after: { status: dto.to }, metadata });
      return this.detail(tx, id);
    });
  }

  cmsOperations(actor: Principal, id: string, query: CmsOperationQueryDto): Promise<CmsOperationPageDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.load(tx, id);
      const where: Prisma.CampaignCmsOperationWhereInput = { campaignId: id, ...(query.screenId ? { screenId: query.screenId } : {}) };
      const [rows, total] = await Promise.all([
        tx.campaignCmsOperation.findMany({ where, select: cmsSelect, skip: query.skip, take: query.pageSize,
          orderBy: [{ performedAt: 'desc' }, { recordedAt: 'desc' }] }),
        tx.campaignCmsOperation.count({ where }),
      ]);
      return { items: rows.map(presentCms), total, page: query.page, pageSize: query.pageSize };
    });
  }

  recordCmsOperation(actor: Principal, id: string, dto: CreateCmsOperationDto): Promise<CmsOperationDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await this.load(tx, id);
      if (dto.type === 'NOTE' && !dto.note) throw new ApiError(400, 'VALIDATION_FAILED', 'A note requires non-empty text', { reason: 'NOTE_REQUIRED' });
      const cmsStatuses: string[] = ['READY', 'LIVE', 'PAUSED'];
      if (!cmsStatuses.includes(row.status) && !(dto.type === 'NOTE' && row.status === 'DRAFT')) {
        throw new ApiError(409, 'INVALID_STATE_TRANSITION', 'CMS operations can only be recorded for a ready, live or paused booking (notes also in draft)', { reason: 'CMS_STATUS_NOT_ALLOWED' });
      }
      const performedAt = new Date(dto.performedAt);
      const now = new Date();
      if (performedAt.getTime() > now.getTime() + 60_000) throw new ApiError(400, 'VALIDATION_FAILED', 'performedAt cannot be in the future', { reason: 'PERFORMED_IN_FUTURE' });
      if (performedAt < row.createdAt) throw new ApiError(400, 'VALIDATION_FAILED', 'performedAt cannot precede the booking', { reason: 'PERFORMED_BEFORE_BOOKING' });
      const link = await tx.campaignScreen.findUnique({ where: { campaignId_screenId: { campaignId: id, screenId: dto.screenId } } });
      if (!link) throw new ApiError(400, 'VALIDATION_FAILED', 'The screen is not part of this booking', { reason: 'SCREEN_NOT_IN_BOOKING' });
      const created = await tx.campaignCmsOperation.create({ data: {
        campaignId: id, screenId: dto.screenId, type: dto.type, performedAt, recordedAt: now, actorId: actor.user.id,
        cmsReference: dto.cmsReference ?? null, note: dto.note ?? null,
      }, select: cmsSelect });
      const after = presentCms(created);
      await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_CMS_OPERATION_RECORDED', entityType: 'campaign', entityId: id,
        after, metadata: { declaration: 'OPERATOR_DECLARED' } });
      return after;
    });
  }

  activity(actor: Principal, id: string, query: PaginationDto): Promise<ActivityPageDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      if (!await tx.campaign.findUnique({ where: { id }, select: { id: true } })) throw missing('Campaign');
      const where: Prisma.AuditLogWhereInput = { entityType: 'campaign', entityId: id };
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({ where, skip: query.skip, take: query.pageSize, orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          select: { id: true, action: true, timestamp: true, metadata: true, user: { select: { id: true, name: true } } } }),
        tx.auditLog.count({ where }),
      ]);
      return { items: rows.map(row => ({ ...row, user: row.user ?? null, timestamp: row.timestamp.toISOString() })),
        total, page: query.page, pageSize: query.pageSize };
    });
  }

  // ---- internals ----

  private async load(tx: Tx, id: string): Promise<DetailRow> {
    const row = await tx.campaign.findFirst({ where: { id, deletedAt: null }, select: detailSelect });
    if (!row) throw missing('Campaign');
    return row;
  }

  private async snapshotOf(tx: Tx, id: string) {
    return snapshot(await this.load(tx, id));
  }

  /** Plan sub-resources change only in DRAFT/READY (`allowWhenLocked` is a narrow per-action exception for LIVE/PAUSED).
   * `work` returns whether anything really changed: a no-op writes nothing (no audit, no planChangedAt, no READY→DRAFT).
   * An effective change stamps planChangedAt and returns a READY booking to DRAFT. */
  private planEdit(actor: Principal, id: string, work: (tx: Tx, row: DetailRow) => Promise<boolean>,
    allowWhenLocked?: (tx: Tx, row: DetailRow) => Promise<boolean>): Promise<CampaignDetailDto> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const row = await this.load(tx, id);
      if (!BOOKING_PLAN_EDITABLE.includes(row.status as BookingStatus)) {
        const exception = BOOKING_LIMITED_EDIT.includes(row.status as BookingStatus) && allowWhenLocked && await allowWhenLocked(tx, row);
        if (!exception) throw conflict('The plan is locked in this status');
      }
      if (await work(tx, row)) {
        await tx.campaign.update({ where: { id }, data: { planChangedAt: new Date() } });
        await this.revertReady(tx, actor, id, row.status);
      }
      return this.detail(tx, id);
    });
  }

  private async revertReady(tx: Tx, actor: Principal, id: string, status: string) {
    if (status !== 'READY') return;
    await tx.campaign.update({ where: { id }, data: { status: 'DRAFT' } });
    await this.audit.append(tx, { userId: actor.user.id, action: 'CAMPAIGN_STATUS_CHANGED', entityType: 'campaign', entityId: id,
      before: { status: 'READY' }, after: { status: 'DRAFT' }, metadata: { automatic: true, reason: 'PLAN_CHANGED' } });
  }

  private async checkReferences(tx: Tx, dto: { advertiserId?: string; agencyId?: string | null; internalOwnerId?: string }) {
    if (dto.advertiserId) {
      const advertiser = await tx.organization.findUnique({ where: { id: dto.advertiserId }, select: { type: true, active: true } });
      if (!advertiser || advertiser.type !== 'ADVERTISER' || !advertiser.active) throw invalid('advertiserId must reference an active advertiser');
    }
    if (dto.agencyId) {
      const agency = await tx.organization.findUnique({ where: { id: dto.agencyId }, select: { type: true, active: true } });
      if (!agency || agency.type !== 'AGENCY' || !agency.active) throw invalid('agencyId must reference an active agency');
    }
    if (dto.internalOwnerId) {
      const owner = await tx.user.findUnique({ where: { id: dto.internalOwnerId }, select: { role: true, active: true } });
      if (!owner || owner.role !== 'ADMIN' || !owner.active) throw invalid('internalOwnerId must reference an active admin');
    }
  }

  private async detail(tx: Tx, id: string): Promise<CampaignDetailDto> {
    const row = await this.load(tx, id);
    return {
      ...presentSummary(row), notes: row.notes, maxPlayoutsPerHourPerScreen: row.maxPlayoutsPerHourPerScreen,
      commercial: commercial(row),
      screens: await this.screenRows(tx, row, row.screens.map(link => link.screen)),
      creatives: row.creatives.map(link => presentCreative(link.creative)),
      schedule: row.schedules,
      launchedAt: row.launchedAt?.toISOString() ?? null, completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private async screenRows(tx: Tx, campaign: DetailRow, screens: ScreenRow[]): Promise<CampaignScreenDto[]> {
    if (!screens.length) return [];
    const ids = screens.map(screen => screen.id);
    const [multipliers, lastOps, uploads, anyUploads] = await Promise.all([
      this.currentMultipliers(tx, ids, campaign.startAt),
      tx.campaignCmsOperation.findMany({ where: { campaignId: campaign.id, screenId: { in: ids }, type: { not: 'NOTE' } }, distinct: ['screenId'],
        orderBy: [{ screenId: 'asc' }, { performedAt: 'desc' }, { recordedAt: 'desc' }], select: { screenId: true, type: true, performedAt: true } }),
      tx.campaignCmsOperation.findMany({ where: { campaignId: campaign.id, screenId: { in: ids }, type: 'CMS_UPLOADED',
        recordedAt: { gte: campaign.planChangedAt } }, distinct: ['screenId'], select: { screenId: true } }),
      tx.campaignCmsOperation.findMany({ where: { campaignId: campaign.id, screenId: { in: ids }, type: 'CMS_UPLOADED' },
        distinct: ['screenId'], select: { screenId: true } }),
    ]);
    const last = new Map(lastOps.map(op => [op.screenId, { type: op.type, performedAt: op.performedAt.toISOString() }]));
    const uploaded = new Set(uploads.map(op => op.screenId));
    const everUploaded = new Set(anyUploads.map(op => op.screenId));
    return screens.map(screen => {
      const hours = campaign.schedules.length ? weeklyWindowHours(campaign.schedules, campaign.timezone, screen) : null;
      return {
        screenId: screen.id, code: screen.screenId, name: screen.name, venueName: screen.venue.name, city: screen.venue.city,
        active: screen.active && !screen.deletedAt, venueActive: screen.venue.active, timezone: screen.timezone,
        resolutionWidth: screen.resolutionWidth, resolutionHeight: screen.resolutionHeight, orientation: screen.orientation,
        operatingStart: screen.operatingStart, operatingEnd: screen.operatingEnd,
        loopLengthSec: screen.loopLengthSec, defaultSlotLengthSec: screen.defaultSlotLengthSec,
        currentMultiplier: multipliers.get(screen.id) ?? null,
        weeklyWindowHours: hours === null ? null : hours.toFixed(2),
        lastCmsOperation: last.get(screen.id) ?? null, cmsUploaded: uploaded.has(screen.id),
        cmsUploadStale: everUploaded.has(screen.id) && !uploaded.has(screen.id),
      };
    });
  }

  /** Whole-screen approved profile effective at max(now, flight start); legacy dayparts are ignored. */
  private async currentMultipliers(tx: Tx, screenIds: string[], startAt: Date) {
    const now = new Date();
    const asOf = startAt > now ? startAt : now;
    const rows = await tx.multiplierProfile.findMany({ where: {
      screenId: { in: screenIds }, approvalStatus: 'APPROVED', specificityKey: '', daypartStart: null, daypartEnd: null,
      weekdays: { isEmpty: true }, validFrom: { lte: asOf }, OR: [{ validTo: null }, { validTo: { gt: asOf } }],
    }, select: { screenId: true, value: true } });
    return new Map(rows.map(row => [row.screenId, row.value.toFixed(4)]));
  }

  private async validate(tx: Tx, row: DetailRow): Promise<CampaignValidationDto> {
    const screens = row.screens.map(link => link.screen);
    const ids = screens.map(screen => screen.id);
    const [multipliers, uploads] = await Promise.all([
      this.currentMultipliers(tx, ids, row.startAt),
      // Only an upload recorded (server time) after the last effective plan change counts as proof.
      tx.campaignCmsOperation.findMany({ where: { campaignId: row.id, type: 'CMS_UPLOADED', recordedAt: { gte: row.planChangedAt } },
        distinct: ['screenId'], select: { screenId: true } }),
    ]);
    const uploaded = new Set(uploads.map(op => op.screenId));
    return validateBooking({
      status: row.status, startAt: row.startAt, endAt: row.endAt, timezone: row.timezone,
      primaryGoal: row.primaryGoal, targetPlayouts: row.targetPlayouts, targetImpressions: row.targetImpressions,
      commercial: { pricingModel: row.pricingModel, unitPrice: row.unitPrice, contractedAmount: row.contractedAmount,
        guaranteedImpressions: row.guaranteedImpressions, contractedQuantity: row.contractedQuantity },
      schedule: row.schedules,
      screens: screens.map(screen => ({
        code: screen.screenId, active: screen.active, deleted: Boolean(screen.deletedAt), venueActive: screen.venue.active,
        timezone: screen.timezone, operatingStart: screen.operatingStart, operatingEnd: screen.operatingEnd,
        defaultSlotLengthSec: screen.defaultSlotLengthSec, resolutionWidth: screen.resolutionWidth, resolutionHeight: screen.resolutionHeight,
        hasMultiplier: multipliers.has(screen.id), cmsUploaded: uploaded.has(screen.id) || !screen.active || Boolean(screen.deletedAt),
      })),
      creatives: row.creatives.map(({ creative }) => ({ status: creative.status,
        durationSeconds: creative.durationSeconds ? Number(creative.durationSeconds) : null, width: creative.width, height: creative.height })),
    });
  }

  /** Screens whose latest declared CMS operation is not the expected one (warning only; the status is a declaration). */
  private async screensLacking(tx: Tx, id: string, expected: string, row: DetailRow): Promise<string[]> {
    const last = await tx.campaignCmsOperation.findMany({ where: { campaignId: id, type: { not: 'NOTE' } }, distinct: ['screenId'],
      orderBy: [{ screenId: 'asc' }, { performedAt: 'desc' }, { recordedAt: 'desc' }], select: { screenId: true, type: true } });
    const latest = new Map(last.map(op => [op.screenId, op.type as string]));
    return row.screens.filter(link => latest.get(link.screen.id) !== expected).map(link => link.screen.screenId);
  }
}

const cmsSelect = {
  id: true, screenId: true, type: true, performedAt: true, recordedAt: true, cmsReference: true, note: true,
  screen: { select: { screenId: true } }, actor: { select: { id: true, name: true } },
} satisfies Prisma.CampaignCmsOperationSelect;
function presentCms(row: Prisma.CampaignCmsOperationGetPayload<{ select: typeof cmsSelect }>): CmsOperationDto {
  return { id: row.id, screenId: row.screenId, screenCode: row.screen.screenId, type: row.type,
    performedAt: row.performedAt.toISOString(), recordedAt: row.recordedAt.toISOString(), actor: row.actor,
    cmsReference: row.cmsReference, note: row.note, source: 'OPERATOR_DECLARED' };
}

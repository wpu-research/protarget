import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { CampaignDeliveryReport, PageResult, ReportCampaignListItem } from '@protarget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/api-error';
import { forbidden, Principal, unauthenticated } from '../../common/identity';
import { inventoryTransaction, missing } from '../../common/inventory-validation';
import { PaginationDto } from '../../common/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AddonsService } from '../addons/addons.service';
import { buildDeliveryReport } from './delivery-report';

/** Statuses a client never sees: a draft is internal planning, not a campaign they bought. */
const HIDDEN_FROM_PORTAL = ['DRAFT', 'READY_FOR_REVIEW'] as const;

/** Tenant predicate for agency/advertiser users; part of every portal query, never a post-fetch filter. */
export function portalCampaignWhere(actor: Principal): Prisma.CampaignWhereInput {
  return {
    deletedAt: null, status: { notIn: [...HIDDEN_FROM_PORTAL] },
    OR: [
      { advertiserId: actor.user.orgId }, { agencyId: actor.user.orgId },
      { permissions: { some: { OR: [{ orgId: actor.user.orgId }, { userId: actor.user.id }] } } },
    ],
  };
}

const campaignSelect = {
  id: true, code: true, name: true, status: true, startAt: true, endAt: true, timezone: true,
  primaryGoal: true, targetPlayouts: true, targetImpressions: true,
  advertiser: { select: { name: true } }, agency: { select: { name: true } },
} satisfies Prisma.CampaignSelect;

@Injectable()
export class ReportingService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService, private readonly addons: AddonsService) {}

  adminReport(actor: Principal, campaignId: string, now = new Date()): Promise<CampaignDeliveryReport> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      await this.addons.requireEnabled(tx, 'reporting');
      return this.build(tx, { id: campaignId, deletedAt: null }, now);
    });
  }

  portalCampaigns(actor: Principal, query: PaginationDto): Promise<PageResult<ReportCampaignListItem>> {
    return inventoryTransaction(this.db, async tx => {
      await this.requireViewer(tx, actor);
      await this.addons.requireEnabled(tx, 'reporting');
      const where = portalCampaignWhere(actor);
      const [rows, total] = await Promise.all([
        tx.campaign.findMany({ where, skip: query.skip, take: query.pageSize, orderBy: [{ startAt: 'desc' }, { id: 'asc' }],
          select: { id: true, code: true, name: true, status: true, startAt: true, endAt: true } }),
        tx.campaign.count({ where }),
      ]);
      return { items: rows.map(row => ({ ...row, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() })),
        total, page: query.page, pageSize: query.pageSize };
    });
  }

  async portalReport(actor: Principal, campaignId: string, now = new Date()): Promise<CampaignDeliveryReport> {
    try {
      return await inventoryTransaction(this.db, async tx => {
        await this.requireViewer(tx, actor);
        await this.addons.requireEnabled(tx, 'reporting');
        return this.build(tx, { id: campaignId, AND: [portalCampaignWhere(actor)] }, now);
      });
    } catch (error) {
      // Not found under the tenant predicate: record the attempt, answer as if it does not exist.
      if (error instanceof ApiError && error.code === 'NOT_FOUND') {
        await this.audit.recordSecurity({ userId: actor.user.id, action: 'UNAUTHORIZED_PORTAL_ACCESS', entityType: 'campaign',
          entityId: campaignId, metadata: { organizationId: actor.user.orgId } });
      }
      throw error;
    }
  }

  /** Same in-transaction session recheck as `requireAdmin`, for read-only agency/advertiser users. */
  private async requireViewer(tx: Prisma.TransactionClient, actor: Principal) {
    const session = await tx.session.findUnique({ where: { id: actor.sessionId }, include: { user: { include: { org: true } } } });
    if (!session || session.accessTokenHash !== actor.accessHash || !this.sessions.isUsable(session)) throw unauthenticated();
    if (session.user.role !== Role.AGENCY && session.user.role !== Role.ADVERTISER) throw forbidden();
  }

  private async build(tx: Prisma.TransactionClient, where: Prisma.CampaignWhereInput, now: Date): Promise<CampaignDeliveryReport> {
    const campaign = await tx.campaign.findFirst({ where, select: campaignSelect });
    if (!campaign) throw missing('Campaign');
    const [records, voidedRecords] = await Promise.all([
      tx.deliveryRecord.findMany({ where: { campaignId: campaign.id, voidedAt: null },
        select: { source: true, screenId: true, playedAt: true, count: true, impressions: true } }),
      tx.deliveryRecord.count({ where: { campaignId: campaign.id, voidedAt: { not: null } } }),
    ]);
    const screenIds = [...new Set(records.map(record => record.screenId))];
    const [screens, multipliers] = screenIds.length ? await Promise.all([
      tx.screen.findMany({ where: { id: { in: screenIds } }, select: { id: true, screenId: true, name: true, venue: { select: { name: true } } } }),
      // Same rule as the booking screen: approved whole-screen profiles only.
      tx.multiplierProfile.findMany({ where: { screenId: { in: screenIds }, approvalStatus: 'APPROVED', specificityKey: '',
        daypartStart: null, daypartEnd: null, weekdays: { isEmpty: true } },
        select: { screenId: true, value: true, validFrom: true, validTo: true }, orderBy: [{ validFrom: 'desc' }] }),
    ]) : [[], []];
    const goal = {
      primaryGoal: campaign.primaryGoal, targetPlayouts: campaign.targetPlayouts, targetImpressions: campaign.targetImpressions,
    };
    const report = buildDeliveryReport({ records, multipliers, goal, startAt: campaign.startAt, endAt: campaign.endAt, now,
      screens: screens.map(s => ({ id: s.id, code: s.screenId, name: s.name, venue: s.venue.name })) });
    return {
      campaign: {
        id: campaign.id, code: campaign.code, name: campaign.name, status: campaign.status,
        startAt: campaign.startAt.toISOString(), endAt: campaign.endAt.toISOString(), timezone: campaign.timezone,
        primaryGoal: campaign.primaryGoal, targetPlayouts: campaign.targetPlayouts?.toString() ?? null,
        targetImpressions: campaign.targetImpressions?.toString() ?? null,
        advertiser: campaign.advertiser.name, agency: campaign.agency?.name ?? null,
      },
      generatedAt: now.toISOString(), voidedRecords, ...report,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PageResult, ProposalDocument, RateView, SalesPackageView } from '@protarget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { Principal } from '../../common/identity';
import { conflict, inventoryTransaction, invalid, missing, requirePatch } from '../../common/inventory-validation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { AddonsService } from '../addons/addons.service';
import { buildProposal } from './proposal';
import { CreatePackageDto, CreateRateDto, RateQueryDto, UpdatePackageDto } from './sales.dto';
import { PaginationDto } from '../../common/pagination.dto';

const rateSelect = {
  id: true, screenId: true, dailyRate: true, currency: true, validFrom: true, note: true, createdAt: true,
  screen: { select: { screenId: true } }, createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ScreenRateSelect;
type RateRow = Prisma.ScreenRateGetPayload<{ select: typeof rateSelect }>;
const packageSelect = {
  id: true, name: true, description: true, active: true, createdAt: true, updatedAt: true,
  screens: { select: { screen: { select: { id: true, screenId: true, name: true } } }, orderBy: { screen: { screenId: 'asc' } } },
} satisfies Prisma.SalesPackageSelect;
type PackageRow = Prisma.SalesPackageGetPayload<{ select: typeof packageSelect }>;

/** `validTo` of a version = `validFrom` of the next version of the same screen (rows sorted by validFrom desc). */
export function presentRates(rows: RateRow[], successors: Map<string, Date>): RateView[] {
  return rows.map(row => ({
    id: row.id, screenId: row.screenId, screenCode: row.screen.screenId, dailyRate: row.dailyRate.toFixed(), currency: row.currency,
    validFrom: row.validFrom.toISOString(), note: row.note, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(),
    validTo: successors.get(row.id)?.toISOString() ?? null,
  }));
}
const presentPackage = (row: PackageRow): SalesPackageView => ({
  id: row.id, name: row.name, description: row.description, active: row.active,
  screens: row.screens.map(({ screen }) => ({ id: screen.id, code: screen.screenId, name: screen.name })),
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class SalesService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService, private readonly addons: AddonsService) {}

  rates(actor: Principal, query: RateQueryDto): Promise<PageResult<RateView>> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      const where: Prisma.ScreenRateWhereInput = query.screenId ? { screenId: query.screenId } : {};
      const [rows, total] = await Promise.all([
        tx.screenRate.findMany({ where, select: rateSelect, skip: query.skip, take: query.pageSize,
          orderBy: [{ screen: { screenId: 'asc' } }, { validFrom: 'desc' }] }),
        tx.screenRate.count({ where }),
      ]);
      // Successor of each listed version, looked up per screen so paging cannot hide it.
      const later = rows.length ? await tx.screenRate.findMany({ where: { screenId: { in: [...new Set(rows.map(r => r.screenId))] } },
        select: { id: true, screenId: true, validFrom: true }, orderBy: [{ validFrom: 'asc' }] }) : [];
      const successors = new Map<string, Date>();
      for (const row of rows) {
        const next = later.find(other => other.screenId === row.screenId && other.validFrom > row.validFrom);
        if (next) successors.set(row.id, next.validFrom);
      }
      return { items: presentRates(rows, successors), total, page: query.page, pageSize: query.pageSize };
    });
  }

  createRate(actor: Principal, dto: CreateRateDto, now = new Date()): Promise<RateView> {
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : now;
    // Like multipliers: a price list is never backdated, so a sent proposal cannot change afterwards.
    if (validFrom.getTime() < now.getTime() - 1000) throw invalid('validFrom cannot be in the past');
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      const screen = await tx.screen.findFirst({ where: { id: dto.screenId, deletedAt: null }, select: { id: true } });
      if (!screen) throw missing('Screen');
      const row = await tx.screenRate.create({ select: rateSelect, data: {
        screenId: dto.screenId, dailyRate: dto.dailyRate, currency: dto.currency, validFrom, note: dto.note || null, createdById: actor.user.id } });
      const [after] = presentRates([row], new Map());
      await this.audit.append(tx, { userId: actor.user.id, action: 'SCREEN_RATE_CREATED', entityType: 'screen_rate', entityId: row.id, after });
      return after;
    });
  }

  packages(actor: Principal, query: PaginationDto): Promise<PageResult<SalesPackageView>> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      const [rows, total] = await Promise.all([
        tx.salesPackage.findMany({ select: packageSelect, skip: query.skip, take: query.pageSize, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
        tx.salesPackage.count(),
      ]);
      return { items: rows.map(presentPackage), total, page: query.page, pageSize: query.pageSize };
    });
  }

  createPackage(actor: Principal, dto: CreatePackageDto): Promise<SalesPackageView> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      await this.requireScreens(tx, dto.screenIds);
      if (await tx.salesPackage.findUnique({ where: { name: dto.name }, select: { id: true } })) throw conflict('A package with this name exists');
      const row = await tx.salesPackage.create({ select: packageSelect, data: { name: dto.name, description: dto.description || null,
        screens: { create: dto.screenIds.map(screenId => ({ screenId })) } } });
      const after = presentPackage(row);
      await this.audit.append(tx, { userId: actor.user.id, action: 'SALES_PACKAGE_CREATED', entityType: 'sales_package', entityId: row.id, after });
      return after;
    });
  }

  updatePackage(actor: Principal, id: string, dto: UpdatePackageDto): Promise<SalesPackageView> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      requirePatch(dto);
      const current = await tx.salesPackage.findUnique({ where: { id }, select: packageSelect });
      if (!current) throw missing('Package');
      if (dto.screenIds) await this.requireScreens(tx, dto.screenIds);
      if (dto.name && dto.name !== current.name && await tx.salesPackage.findUnique({ where: { name: dto.name }, select: { id: true } })) {
        throw conflict('A package with this name exists');
      }
      if (dto.screenIds) await tx.salesPackageScreen.deleteMany({ where: { packageId: id } });
      const row = await tx.salesPackage.update({ where: { id }, select: packageSelect, data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.screenIds ? { screens: { create: dto.screenIds.map(screenId => ({ screenId })) } } : {}),
      } });
      const after = presentPackage(row);
      await this.audit.append(tx, { userId: actor.user.id, action: 'SALES_PACKAGE_UPDATED', entityType: 'sales_package', entityId: id,
        before: presentPackage(current), after });
      return after;
    });
  }

  proposal(actor: Principal, campaignId: string, now = new Date()): Promise<ProposalDocument> {
    return inventoryTransaction(this.db, async tx => {
      await this.guard(tx, actor);
      const campaign = await tx.campaign.findFirst({ where: { id: campaignId, deletedAt: null }, select: {
        id: true, code: true, name: true, startAt: true, endAt: true, timezone: true,
        advertiser: { select: { name: true } }, agency: { select: { name: true } },
        screens: { where: { active: true }, select: { screen: { select: { id: true, screenId: true, name: true, venue: { select: { name: true } } } } },
          orderBy: { screen: { screenId: 'asc' } } } } });
      if (!campaign) throw missing('Campaign');
      const screens = campaign.screens.map(({ screen }) => ({ id: screen.id, code: screen.screenId, name: screen.name, venue: screen.venue.name }));
      const rates = screens.length ? await tx.screenRate.findMany({ where: { screenId: { in: screens.map(s => s.id) }, validFrom: { lte: campaign.startAt } },
        select: { screenId: true, dailyRate: true, currency: true, validFrom: true } }) : [];
      const built = buildProposal(screens, rates, campaign.startAt, campaign.endAt);
      return {
        campaign: { id: campaign.id, code: campaign.code, name: campaign.name, advertiser: campaign.advertiser.name,
          agency: campaign.agency?.name ?? null, startAt: campaign.startAt.toISOString(), endAt: campaign.endAt.toISOString(), timezone: campaign.timezone },
        priceDate: campaign.startAt.toISOString(), generatedAt: now.toISOString(), ...built,
      };
    });
  }

  private async guard(tx: Prisma.TransactionClient, actor: Principal) {
    await this.sessions.requireAdmin(tx, actor);
    await this.addons.requireEnabled(tx, 'sales');
  }

  private async requireScreens(tx: Prisma.TransactionClient, ids: string[]) {
    const found = await tx.screen.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw invalid('Every package screen must exist');
  }
}

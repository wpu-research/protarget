import type { Prisma } from '@prisma/client';
import { FLEET_DECLARED_STATUSES, type CmsOperationType } from '@protarget/shared';
import type { FleetDeclarationDto } from './fleet.dto';

export const declarationSelect = {
  active: true,
  campaign: { select: {
    id: true, code: true, name: true, status: true, deletedAt: true,
    creatives: { select: { creative: { select: { status: true } } } },
  } },
} satisfies Prisma.CampaignScreenSelect;
export type DeclarationRow = Prisma.CampaignScreenGetPayload<{ select: typeof declarationSelect }>;
type OperationRow = { campaignId: string; screenId: string; type: CmsOperationType; performedAt: Date };

/** Operator declarations only: READY/LIVE/PAUSED bookings that still contain the screen. Pure and unit-tested. */
export function presentDeclarations(screenId: string, rows: DeclarationRow[], operations: OperationRow[]): FleetDeclarationDto[] {
  const declared: readonly string[] = FLEET_DECLARED_STATUSES;
  return rows
    .filter(row => row.active && row.campaign.deletedAt === null && declared.includes(row.campaign.status))
    .map(row => {
      const counts: FleetDeclarationDto['creativeStatusCounts'] = {};
      for (const link of row.campaign.creatives) counts[link.creative.status] = (counts[link.creative.status] ?? 0) + 1;
      const last = operations
        .filter(op => op.campaignId === row.campaign.id && op.screenId === screenId)
        .sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime())[0];
      return {
        campaignId: row.campaign.id, code: row.campaign.code, name: row.campaign.name, status: row.campaign.status,
        creativeStatusCounts: counts,
        lastCmsOperation: last ? { type: last.type, performedAt: last.performedAt.toISOString() } : null,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}


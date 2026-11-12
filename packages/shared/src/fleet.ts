import type { CampaignStatus, CreativeStatus } from './enums';
import type { CmsOperationType } from './campaigns';

/** Read-only 3D fleet view. Everything here is manual inventory or an operator declaration; nothing is measured. */
export const FLEET_SHIP_LIMIT = 50;
export const FLEET_SCREEN_LIMIT = 100;
export const FLEET_DECLARED_STATUSES = ['READY', 'LIVE', 'PAUSED'] as const satisfies readonly CampaignStatus[];

export interface FleetDeclaration {
  campaignId: string; code: string; name: string;
  /** Operator-declared booking status, not proof of playback. */
  status: CampaignStatus;
  creativeStatusCounts: Partial<Record<CreativeStatus, number>>;
  lastCmsOperation: { type: CmsOperationType; performedAt: string } | null;
}
export interface FleetScreen {
  id: string; screenId: string; name: string; active: boolean;
  locationLabel: string | null; resolutionWidth: number | null; resolutionHeight: number | null;
  orientation: 'LANDSCAPE' | 'PORTRAIT' | null; physicalSize: string | null;
  operatingStart: string | null; operatingEnd: string | null; timezone: string;
  declarations: FleetDeclaration[];
}
export interface FleetShip {
  id: string; name: string; active: boolean; city: string; timezone: string; notes: string | null;
  screens: FleetScreen[]; screensTruncated: boolean;
}
export interface FleetScene {
  /** Server instant of the read (UTC ISO). */
  asOf: string;
  ships: FleetShip[];
  shipsTruncated: boolean;
}

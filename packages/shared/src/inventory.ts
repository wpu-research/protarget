import type { MultiplierSourceType, VenueType } from './enums';
import type { PageResult } from './foundation';

/** Deliberately excludes ownership, commercial fields, players and credentials. */
export interface InventoryVenue {
  id: string; name: string; type: VenueType; country: string; city: string;
  timezone: string; notes: string | null; active: boolean;
  createdAt: string; updatedAt: string;
}
export interface CreateInventoryVenue {
  name: string; country: string; city: string; timezone: string;
  type?: VenueType; notes?: string | null; active?: boolean;
}
export type UpdateInventoryVenue = Partial<CreateInventoryVenue>;
export interface InventoryScreen {
  id: string; screenId: string; screenIdLocked: boolean; venueId: string;
  venue: InventoryVenue; name: string; timezone: string; active: boolean;
  locationLabel: string | null; resolutionWidth: number | null; resolutionHeight: number | null;
  orientation: 'LANDSCAPE' | 'PORTRAIT' | null; physicalSize: string | null; os: string | null;
  cmsName: string | null; cmsVersion: string | null; cmsReference: string | null; notes: string | null;
  loopLengthSec: number | null; defaultSlotLengthSec: number | null;
  operatingStart: string | null; operatingEnd: string | null;
  connectionStatus: 'NOT_CONNECTED';
  createdAt: string; updatedAt: string;
}
export interface CreateInventoryScreen {
  screenId: string; venueId: string; name: string; timezone: string; active?: boolean;
  locationLabel?: string | null; resolutionWidth?: number | null; resolutionHeight?: number | null;
  orientation?: 'LANDSCAPE' | 'PORTRAIT' | null; physicalSize?: string | null; os?: string | null;
  cmsName?: string | null; cmsVersion?: string | null; cmsReference?: string | null; notes?: string | null;
  loopLengthSec?: number | null; defaultSlotLengthSec?: number | null;
  operatingStart?: string | null; operatingEnd?: string | null;
}
export type UpdateInventoryScreen = Partial<CreateInventoryScreen>;
export interface InventoryMultiplier {
  id: string; screenId: string; value: string; sourceType: MultiplierSourceType; sourceRef: string;
  changeReason: string | null; confidenceNote: string | null;
  /** Draft dates are unset in the API; only approved intervals are effective. */
  validFrom: string | null; validTo: string | null;
  daypartStart: string | null; daypartEnd: string | null; weekdays: number[];
  approvalStatus: 'DRAFT' | 'APPROVED'; version: number; createdBy: string;
  approvedBy: string | null; approvedAt: string | null; supersedesId: string | null; createdAt: string;
}
export interface CreateInventoryMultiplier {
  /** Positive non-exponential decimal, at most 8 integer and 4 fractional digits. */
  value: string; sourceRef: string; changeReason: string;
}
export interface ApproveInventoryMultiplier {
  /** Omit for server-now. Otherwise an explicit future UTC ISO timestamp ending in Z. */
  validFrom?: string;
  validTo?: string | null;
  supersedesId?: string | null;
}
export interface InventoryMultiplierHistory extends PageResult<InventoryMultiplier> {
  /** Server instant used for the [validFrom, validTo) current selection. */
  asOf: string;
  current: InventoryMultiplier | null;
  latest: InventoryMultiplier | null;
}

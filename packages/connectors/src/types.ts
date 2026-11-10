import type { Currency, DealStatus, DealType } from '@protarget/shared';

export interface ConnectionStatus {
  ok: boolean;
  message?: string;
}

export interface CreateDealInput {
  internalDealId: string;
  dealType: DealType;
  buyerDsp?: string;
  buyerSeatId?: string;
  currency: Currency;
  /** Decimal string — para asla float taşınmaz. */
  cpm?: string;
  guaranteedImpressions?: number;
  startAt: Date;
  endAt: Date;
  /** Connector başına eşlenmiş dış inventory kimlikleri. */
  externalInventoryIds: string[];
  /** Manual modda admin'in girdiği external Deal ID. */
  manualExternalDealId?: string;
}

export interface ExternalDeal {
  externalDealId: string;
  /** Protarget durumuna eşlenmiş hali. */
  status: DealStatus;
  /** Dış sistemin ham durumu; teşhis için saklanır. */
  rawStatus: unknown;
}

export type CreateDealResult = ExternalDeal;
export type UpdateDealInput = Partial<Pick<CreateDealInput, 'cpm' | 'guaranteedImpressions' | 'startAt' | 'endAt' | 'externalInventoryIds'>>;
export type UpdateDealResult = ExternalDeal;

export interface ActionResult {
  ok: boolean;
  status?: DealStatus;
  rawStatus?: unknown;
  message?: string;
}

export interface ExternalDeliveryRow {
  date: string; // YYYY-MM-DD
  impressions: number;
}

export interface ExternalDeliveryReport {
  externalDealId: string;
  rows: ExternalDeliveryRow[];
  raw: unknown;
}

/**
 * Spec v2 §24 — tüm programmatic partnerler bu arayüzün arkasında yaşar.
 * Core platform (campaign/player/PoP/impression/reporting) yalnız bu arayüzü bilir.
 */
export interface DealConnector {
  readonly key: string;
  /** pauseDeal/resumeDeal dış sistemde gerçekten bir şey yapıyor mu? */
  readonly supportsPause: boolean;

  validateConnection(): Promise<ConnectionStatus>;
  createDeal(input: CreateDealInput): Promise<CreateDealResult>;
  getDeal(externalDealId: string): Promise<ExternalDeal>;
  updateDeal(externalDealId: string, changes: UpdateDealInput): Promise<UpdateDealResult>;
  pauseDeal(externalDealId: string): Promise<ActionResult>;
  resumeDeal(externalDealId: string): Promise<ActionResult>;
  fetchDelivery(externalDealId: string, from: Date, to: Date): Promise<ExternalDeliveryReport>;
}

export class ConnectorNotConfiguredError extends Error {
  constructor(connector: string) {
    super(`Connector "${connector}" is not configured.`);
    this.name = 'ConnectorNotConfiguredError';
  }
}

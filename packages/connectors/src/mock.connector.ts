import type { DealStatus } from '@protarget/shared';
import type {
  ActionResult, ConnectionStatus, CreateDealInput, CreateDealResult, DealConnector,
  ExternalDeal, ExternalDeliveryReport, UpdateDealInput, UpdateDealResult,
} from './types';

export interface MockConnectorOptions {
  /** true ise her çağrı hata fırlatır (T11 senaryosu). */
  failAll?: boolean;
  /** createDeal sonrası getDeal kaç çağrıda ACCEPTED'e geçsin. */
  acceptAfterPolls?: number;
}

/** Sandbox connector: gerçek partner olmadan uçtan uca deal akışını test etmek için. */
export class MockConnector implements DealConnector {
  readonly key = 'MOCK';
  readonly supportsPause = true;

  private readonly deals = new Map<string, { status: DealStatus; polls: number }>();
  private seq = 0;

  constructor(private readonly options: MockConnectorOptions = {}) {}

  private guard(): void {
    if (this.options.failAll) throw new Error('MockConnector: simulated partner outage');
  }

  async validateConnection(): Promise<ConnectionStatus> {
    return this.options.failAll ? { ok: false, message: 'simulated outage' } : { ok: true };
  }

  async createDeal(input: CreateDealInput): Promise<CreateDealResult> {
    this.guard();
    const externalDealId = `MOCK-${++this.seq}-${input.internalDealId}`;
    this.deals.set(externalDealId, { status: 'SENT', polls: 0 });
    return { externalDealId, status: 'SENT', rawStatus: { state: 'sent' } };
  }

  async getDeal(externalDealId: string): Promise<ExternalDeal> {
    this.guard();
    const deal = this.deals.get(externalDealId);
    if (!deal) throw new Error(`MockConnector: unknown deal ${externalDealId}`);
    deal.polls += 1;
    if (deal.status === 'SENT' && deal.polls >= (this.options.acceptAfterPolls ?? 1)) {
      deal.status = 'ACCEPTED';
    }
    return { externalDealId, status: deal.status, rawStatus: { state: deal.status.toLowerCase() } };
  }

  async updateDeal(externalDealId: string, _changes: UpdateDealInput): Promise<UpdateDealResult> {
    return this.getDeal(externalDealId);
  }

  async pauseDeal(externalDealId: string): Promise<ActionResult> {
    return this.setStatus(externalDealId, 'PAUSED');
  }

  async resumeDeal(externalDealId: string): Promise<ActionResult> {
    return this.setStatus(externalDealId, 'ACTIVE');
  }

  async fetchDelivery(externalDealId: string): Promise<ExternalDeliveryReport> {
    this.guard();
    return { externalDealId, rows: [], raw: { note: 'mock connector reports no delivery' } };
  }

  private setStatus(externalDealId: string, status: DealStatus): ActionResult {
    this.guard();
    const deal = this.deals.get(externalDealId);
    if (!deal) return { ok: false, message: `unknown deal ${externalDealId}` };
    deal.status = status;
    return { ok: true, status, rawStatus: { state: status.toLowerCase() } };
  }
}

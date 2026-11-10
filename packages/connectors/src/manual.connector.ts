import type {
  ActionResult, ConnectionStatus, CreateDealInput, CreateDealResult, DealConnector,
  ExternalDeal, ExternalDeliveryReport, UpdateDealInput, UpdateDealResult,
} from './types';

/**
 * Dış sistemle konuşmaz. createDeal yalnızca admin'in girdiği external Deal ID'yi geri verir;
 * durum admin tarafından elle yönetilir.
 */
export class ManualConnector implements DealConnector {
  readonly key = 'MANUAL';
  readonly supportsPause = false;

  async validateConnection(): Promise<ConnectionStatus> {
    return { ok: true, message: 'Manual connector needs no connection.' };
  }

  async createDeal(input: CreateDealInput): Promise<CreateDealResult> {
    if (!input.manualExternalDealId) {
      throw new Error('Manual connector requires an admin-entered external Deal ID.');
    }
    return { externalDealId: input.manualExternalDealId, status: 'SENT', rawStatus: 'manual' };
  }

  async getDeal(externalDealId: string): Promise<ExternalDeal> {
    // Dış kaynak yok: durum Protarget tarafında tutulur, sync onu değiştirmez.
    return { externalDealId, status: 'SENT', rawStatus: 'manual' };
  }

  async updateDeal(externalDealId: string, _changes: UpdateDealInput): Promise<UpdateDealResult> {
    return this.getDeal(externalDealId);
  }

  async pauseDeal(): Promise<ActionResult> {
    return { ok: true, message: 'No external action for manual deals.' };
  }

  async resumeDeal(): Promise<ActionResult> {
    return { ok: true, message: 'No external action for manual deals.' };
  }

  async fetchDelivery(externalDealId: string): Promise<ExternalDeliveryReport> {
    return { externalDealId, rows: [], raw: null };
  }
}

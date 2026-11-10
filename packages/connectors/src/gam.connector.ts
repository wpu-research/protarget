import {
  ConnectorNotConfiguredError,
  type ActionResult, type ConnectionStatus, type CreateDealResult, type DealConnector,
  type ExternalDeal, type ExternalDeliveryReport, type UpdateDealResult,
} from './types';

/**
 * Google Ad Manager — YALNIZCA İSKELET.
 * GAM'in pDOOH envanteri için uygunluğu ve Deal ID'yi hangi sistemin üreteceği
 * partner hesabı bazında doğrulanmadan gerçek çağrı yazılmaz (bkz. docs/CONNECTORS.md).
 */
export class GamConnector implements DealConnector {
  readonly key = 'GAM';
  readonly supportsPause = true;

  async validateConnection(): Promise<ConnectionStatus> {
    return { ok: false, message: 'GAM connector is not configured.' };
  }
  async createDeal(): Promise<CreateDealResult> { throw new ConnectorNotConfiguredError(this.key); }
  async getDeal(): Promise<ExternalDeal> { throw new ConnectorNotConfiguredError(this.key); }
  async updateDeal(): Promise<UpdateDealResult> { throw new ConnectorNotConfiguredError(this.key); }
  async pauseDeal(): Promise<ActionResult> { throw new ConnectorNotConfiguredError(this.key); }
  async resumeDeal(): Promise<ActionResult> { throw new ConnectorNotConfiguredError(this.key); }
  async fetchDelivery(): Promise<ExternalDeliveryReport> { throw new ConnectorNotConfiguredError(this.key); }
}

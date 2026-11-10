import type { DealConnector } from './types';
import { ManualConnector } from './manual.connector';
import { MockConnector } from './mock.connector';
import { GamConnector } from './gam.connector';

/** Yeni partner eklemek = DealConnector uygulayıp buraya kaydetmek. Core kod değişmez. */
export class ConnectorRegistry {
  private readonly connectors = new Map<string, DealConnector>();

  register(connector: DealConnector): this {
    this.connectors.set(connector.key, connector);
    return this;
  }

  get(key: string): DealConnector {
    const connector = this.connectors.get(key);
    if (!connector) throw new Error(`Unknown connector "${key}"`);
    return connector;
  }

  keys(): string[] {
    return [...this.connectors.keys()];
  }
}

export function createDefaultRegistry(): ConnectorRegistry {
  return new ConnectorRegistry()
    .register(new ManualConnector())
    .register(new MockConnector())
    .register(new GamConnector());
}

/** deal_sync_logs'a yazmadan önce secret/token alanlarını maskele. */
const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key|credential)/i;
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) ? '[REDACTED]' : redactSecrets(v),
      ]),
    );
  }
  return value;
}

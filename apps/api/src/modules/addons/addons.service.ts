import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ADDON_MODULES, addonCanEnable, addonDefinition, addonSettingKey, type AddonDefinition, type AddonKey, type AddonState,
} from '@protarget/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/api-error';
import { Principal } from '../../common/identity';
import { inventoryTransaction } from '../../common/inventory-validation';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';

type SettingRow = { key: string; value: Prisma.JsonValue; updatedAt: Date };

/** Only a stored JSON `true` enables a module; missing rows, other values or a not-ready module stay off. */
export function presentAddons(rows: SettingRow[], definitions: readonly AddonDefinition[] = ADDON_MODULES): AddonState[] {
  const byKey = new Map(rows.map(row => [row.key, row]));
  return definitions.map(definition => {
    const row = byKey.get(addonSettingKey(definition.key));
    const storedOn = row?.value === true;
    return { ...definition, enabled: addonCanEnable(definition) && storedOn, storedOn,
      updatedAt: row ? row.updatedAt.toISOString() : null };
  });
}

export const addonDisabled = (key: AddonKey) =>
  new ApiError(404, 'ADDON_DISABLED', 'This add-on module is disabled', { addon: key });

@Injectable()
export class AddonsService {
  constructor(private readonly db: PrismaService, private readonly audit: AuditService,
    private readonly sessions: SessionService) {}

  list(actor: Principal): Promise<AddonState[]> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      return presentAddons(await this.rows(tx));
    });
  }

  setEnabled(actor: Principal, key: AddonKey, enabled: boolean): Promise<AddonState> {
    return inventoryTransaction(this.db, async tx => {
      await this.sessions.requireAdmin(tx, actor);
      const definition = addonDefinition(key);
      if (enabled && !addonCanEnable(definition)) {
        throw new ApiError(409, 'ADDON_NOT_AVAILABLE', 'This add-on module cannot be enabled in this version', { addon: key });
      }
      const before = presentAddons(await this.rows(tx)).find(item => item.key === key)!;
      // No-op: keep "last changed" truthful and the audit log free of before == after rows.
      if (before.storedOn === enabled && before.enabled === enabled) return before;
      const settingKey = addonSettingKey(key);
      await tx.setting.upsert({ where: { key: settingKey }, create: { key: settingKey, value: enabled },
        update: { value: enabled } });
      const after = presentAddons(await this.rows(tx)).find(item => item.key === key)!;
      await this.audit.append(tx, { userId: actor.user.id, action: 'ADDON_TOGGLED', entityType: 'addon',
        entityId: key, before: { enabled: before.enabled }, after: { enabled: after.enabled } });
      return after;
    });
  }

  /** Call inside the business transaction of an add-on endpoint so the flag is checked consistently. */
  async requireEnabled(tx: Prisma.TransactionClient, key: AddonKey): Promise<void> {
    const state = presentAddons(await this.rows(tx, key)).find(item => item.key === key)!;
    if (!state.enabled) throw addonDisabled(key);
  }

  /** Enabled flags for read-only callers (portal); never exposes definitions of disabled modules. */
  async enabledKeys(tx: Prisma.TransactionClient): Promise<AddonKey[]> {
    return presentAddons(await this.rows(tx)).filter(item => item.enabled).map(item => item.key);
  }

  private rows(tx: Prisma.TransactionClient, key?: AddonKey) {
    return tx.setting.findMany({
      where: key ? { key: addonSettingKey(key) } : { key: { startsWith: 'addon.' } },
      select: { key: true, value: true, updatedAt: true },
    });
  }
}

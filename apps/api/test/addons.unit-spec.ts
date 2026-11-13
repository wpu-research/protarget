import { ADDON_KEYS, ADDON_MODULES, addonCanEnable, addonSettingKey } from '@protarget/shared';
import { presentAddons } from '../src/modules/addons/addons.service';

const at = new Date('2026-11-13T08:00:00Z');
const row = (key: string, value: unknown) => ({ key, value: value as never, updatedAt: at });

describe('Add-on modules', () => {
  it('lists all nine comparison areas once, disabled by default with no stored rows', () => {
    const states = presentAddons([]);
    expect(states.map(s => s.key)).toEqual([...ADDON_KEYS]);
    expect(states.map(s => s.area)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(states.every(s => !s.enabled && s.updatedAt === null)).toBe(true);
  });
  it('never enables a placeholder module even if a row says true', () => {
    const placeholders = ADDON_MODULES.filter(m => m.kind === 'PLACEHOLDER');
    expect(placeholders.map(m => m.key)).toEqual(['playback', 'programmatic', 'audience', 'dynamicContent']);
    const states = presentAddons(placeholders.map(m => row(addonSettingKey(m.key), true)));
    expect(states.filter(s => s.kind === 'PLACEHOLDER').every(s => !s.enabled)).toBe(true);
    expect(placeholders.some(addonCanEnable)).toBe(false);
    expect(states.filter(s => s.kind === 'PLACEHOLDER').every(s => s.storedOn)).toBe(true);
  });
  it('treats only a JSON true as enabled and reports when the flag last changed', () => {
    const ready = ADDON_MODULES.map(m => m.key === 'capacity' || m.key === 'sales' ? { ...m, ready: true } : m);
    const states = presentAddons([row(addonSettingKey('capacity'), true), row(addonSettingKey('sales'), 'true')], ready);
    expect(states.find(s => s.key === 'capacity')).toMatchObject({ enabled: true, updatedAt: at.toISOString() });
    expect(states.find(s => s.key === 'sales')!.enabled).toBe(false);
    expect(states.filter(s => s.enabled).map(s => s.key)).toEqual(['capacity']);
  });
  it('keeps a working module off until its code is ready, even with a stored true', () => {
    const notReady = ADDON_MODULES.map(m => ({ ...m, ready: false }));
    expect(presentAddons([row(addonSettingKey('reporting'), true)], notReady).every(s => !s.enabled)).toBe(true);
  });
  it('ignores unrelated settings rows', () => {
    expect(presentAddons([row('pacing.underThreshold', 0.9)]).every(s => !s.enabled && !s.updatedAt)).toBe(true);
  });
});

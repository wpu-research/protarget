/**
 * Ek özellik modülleri (Broadsign karşılaştırmasındaki eksik alanlar).
 * Hepsi varsayılan KAPALI; bayrak `settings` tablosunda `addon.<key>.enabled`
 * olarak tutulur, satır yoksa kapalıdır. Bkz. tech-spec-addon-modules.md.
 */
export const ADDON_KEYS = [
  'playback', 'proofOfPlay', 'capacity', 'sales', 'programmatic',
  'audience', 'dynamicContent', 'buyerCatalog', 'reporting',
] as const;
export type AddonKey = typeof ADDON_KEYS[number];

/** WORKING: dış sistem gerektirmeyen, çalışır kod. PLACEHOLDER: dış sistem gerektirir, açılamaz. */
export type AddonKind = 'WORKING' | 'PLACEHOLDER';

export interface AddonDefinition {
  key: AddonKey;
  /** Karşılaştırma listesindeki sıra (1–9). */
  area: number;
  kind: AddonKind;
  /** Kod bu sürümde var mı? WORKING olup henüz hazır olmayan modül açılamaz. */
  ready: boolean;
  /** Etkinleştirmeden önce gereken dış önkoşullar (i18n anahtar sonekleri). */
  prerequisites: readonly string[];
}

export const ADDON_MODULES: readonly AddonDefinition[] = [
  { key: 'playback', area: 1, kind: 'PLACEHOLDER', ready: false, prerequisites: ['player', 'cmsApi'] },
  { key: 'proofOfPlay', area: 2, kind: 'WORKING', ready: true, prerequisites: ['cmsExport'] },
  { key: 'capacity', area: 3, kind: 'WORKING', ready: true, prerequisites: ['loopSlot'] },
  { key: 'sales', area: 4, kind: 'WORKING', ready: false, prerequisites: ['priceList'] },
  { key: 'programmatic', area: 5, kind: 'PLACEHOLDER', ready: false, prerequisites: ['sspContract', 'technicalAccess'] },
  { key: 'audience', area: 6, kind: 'PLACEHOLDER', ready: false, prerequisites: ['audienceSource'] },
  { key: 'dynamicContent', area: 7, kind: 'PLACEHOLDER', ready: false, prerequisites: ['player', 'dataProvider'] },
  { key: 'buyerCatalog', area: 8, kind: 'WORKING', ready: false, prerequisites: [] },
  { key: 'reporting', area: 9, kind: 'WORKING', ready: true, prerequisites: ['deliveryData'] },
];

export const addonSettingKey = (key: AddonKey) => `addon.${key}.enabled`;
export const isAddonKey = (value: string): value is AddonKey => (ADDON_KEYS as readonly string[]).includes(value);
export const addonDefinition = (key: AddonKey): AddonDefinition => ADDON_MODULES.find(item => item.key === key)!;
/** Yalnız çalışır ve bu sürümde hazır olan modül açılabilir. */
export const addonCanEnable = (definition: AddonDefinition) => definition.kind === 'WORKING' && definition.ready;

export interface AddonState extends AddonDefinition {
  enabled: boolean;
  /** Ayarda JSON `true` saklı mı? Hazır olmayan/yer tutucu modülde eski satırı temizlemek için. */
  storedOn: boolean;
  /** Bayrağın son değiştiği an; hiç değişmediyse null. */
  updatedAt: string | null;
}

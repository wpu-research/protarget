/**
 * Ek özellik "oynatma kaydı" (PoP içe aktarma). Kaynaklar ayrı etiketli kalır ve
 * raporda toplanmaz: doğrulanmış CMS kaydı ≠ operatör beyanı ≠ doğrudan beyan edilen gösterim.
 */
export const DELIVERY_SOURCES = ['CMS_VERIFIED', 'OPERATOR_DECLARED', 'DECLARED_IMPRESSION'] as const;
export type DeliverySource = typeof DELIVERY_SOURCES[number];
export const DELIVERY_CSV_COLUMNS = [
  'campaign_code', 'screen_code', 'played_at', 'count', 'impressions', 'creative_code', 'duration_seconds', 'external_id',
] as const;
/** Varsayılan JSON gövde limiti (100 KB) içinde, JSON kaçışlarına pay bırakarak (UTF-8 bayt). Büyük dosya bölünür ya da `count` ile toplanır. */
export const DELIVERY_MAX_CSV_BYTES = 60_000;
export const DELIVERY_MAX_ROWS = 2_000;

export interface DeliveryRowErrorView { line: number; code: string; column?: string }
export interface DeliveryPreview {
  source: DeliverySource; rowCount: number; accepted: number;
  /** Aynı dosyada tekrarlanan ya da daha önce içe aktarılmış (iptal edilmemiş) satırlar; yazılmaz. */
  duplicates: number;
  /** En fazla 100 hata listelenir; toplam sayı ayrıca. */
  errors: DeliveryRowErrorView[]; errorCount: number;
  /** Kabul edilecek satırların toplamı. Playout DECLARED_IMPRESSION'da null; impression yalnız orada dolu. */
  playouts: number | null; impressions: string | null;
}
export interface DeliveryBatchView {
  id: string; source: DeliverySource; filename: string; note: string | null;
  rowCount: number; acceptedCount: number; duplicateCount: number;
  createdBy: { id: string; name: string }; createdAt: string;
}
export interface DeliveryRecordView {
  id: string; batchId: string; source: DeliverySource;
  campaign: { id: string; code: string }; screen: { id: string; code: string }; creative: { id: string; code: string } | null;
  playedAt: string; count: number | null; impressions: string | null; durationSeconds: string | null; externalId: string | null;
  voidedAt: string | null; voidReason: string | null;
}

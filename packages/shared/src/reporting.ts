import type { DeliverySource } from './delivery';

/**
 * Ek özellik "teslimat raporları". Kaynaklar yan yana gösterilir, asla toplanmaz.
 * Hesaplanamayan değer null; finansal alan yoktur (portal yanıtında da).
 */
export interface SourceFigures {
  /** Oynatma; DECLARED_IMPRESSION için null. */
  playouts: number | null;
  /** Yalnız DECLARED_IMPRESSION: doğrudan beyan edilen gösterim (decimal string). */
  declaredImpressions: string | null;
  /** Oynatma × o anda geçerli onaylı ekran çarpanı (decimal string); oynatmasız kaynakta null. */
  estimatedImpressions: string | null;
  /** Geçerli çarpanı olmayan oynatma; >0 ise tahmin kısmidir. */
  uncoveredPlayouts: number | null;
}
export interface SourceSummary extends SourceFigures {
  source: DeliverySource;
  /** Hedefe göre teslimat yüzdesi (bir ondalık); hedef/veri yoksa null. */
  deliveryPct: number | null;
  /** deliveryPct / geçen uçuş yüzdesi; hesaplanamazsa null. */
  pacing: number | null;
}
export interface DeliveryBreakdownRow { key: string; label: string; detail: string | null; figures: Record<DeliverySource, SourceFigures> }
export interface CampaignDeliveryReport {
  campaign: {
    id: string; code: string; name: string; status: string; startAt: string; endAt: string; timezone: string;
    primaryGoal: 'PLAYOUTS' | 'IMPRESSIONS' | null; targetPlayouts: string | null; targetImpressions: string | null;
    advertiser: string; agency: string | null;
  };
  generatedAt: string;
  /** Uçuşun geçen kısmı (%), bir ondalık. */
  elapsedPct: number;
  sources: SourceSummary[];
  byScreen: DeliveryBreakdownRow[];
  /** UTC gün. */
  byDay: DeliveryBreakdownRow[];
  voidedRecords: number;
}
export interface ReportCampaignListItem { id: string; code: string; name: string; status: string; startAt: string; endAt: string }

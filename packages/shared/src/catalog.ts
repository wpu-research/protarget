/**
 * Ek özellik "alıcı kataloğu": ajans/marka envanteri portalda salt okunur görür.
 * İç alanlar (sahip, not, CMS, ağırlık/çarpan) yoktur. Liste fiyatı yalnız kurumun finansal
 * görünürlüğü açıksa ve satış modülü etkinse; aksi halde null. Rezervasyon talebi yer tutucudur.
 */
export interface CatalogScreen {
  id: string; code: string; name: string;
  venue: { id: string; name: string; city: string | null; type: string };
  resolutionWidth: number | null; resolutionHeight: number | null; orientation: string | null; physicalSize: string | null;
  loopLengthSec: number | null; defaultSlotLengthSec: number | null;
  operatingStart: string | null; operatingEnd: string | null; timezone: string;
  listPrice: { dailyRate: string; currency: 'TRY' | 'USD'; validFrom: string } | null;
}
export interface CatalogPage {
  items: CatalogScreen[]; total: number; page: number; pageSize: number;
  /** Kurum için fiyat görünürlüğü açık mı (açık değilse tüm listPrice null). */
  pricesVisible: boolean;
  venues: { id: string; name: string }[];
}

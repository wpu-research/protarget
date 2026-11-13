/**
 * Ek özellik "satış araçları": sürümlü liste fiyatı (fiyat kartı), hazır paket ve teklif belgesi.
 * İndirim onay akışı ve fatura yer tutucudur. Fiyatı olmayan ekranın tutarı null; sahte fiyat yok.
 */
export const SALES_CURRENCIES = ['TRY', 'USD'] as const;
export type SalesCurrency = typeof SALES_CURRENCIES[number];

export interface RateView {
  id: string; screenId: string; screenCode: string;
  /** Bir slotun bir günlük liste fiyatı (decimal string). */
  dailyRate: string; currency: SalesCurrency;
  validFrom: string; note: string | null; createdBy: { id: string; name: string }; createdAt: string;
  /** Sonraki sürüm başlayınca biter; geçerliyse null. */
  validTo: string | null;
}
export interface SalesPackageView {
  id: string; name: string; description: string | null; active: boolean;
  screens: { id: string; code: string; name: string }[]; createdAt: string; updatedAt: string;
}
export interface ProposalLine {
  screenId: string; screenCode: string; screenName: string; venueName: string;
  dailyRate: string | null; currency: SalesCurrency | null;
  /** dailyRate × gün; fiyat yoksa null. */
  listAmount: string | null;
}
export interface ProposalDocument {
  campaign: { id: string; code: string; name: string; advertiser: string; agency: string | null; startAt: string; endAt: string; timezone: string };
  /** Uçuş süresi gün olarak (kesirli, 4 ondalık). */
  days: string;
  /** Fiyatlar kampanya başlangıcında geçerli sürümden alınır. */
  priceDate: string;
  lines: ProposalLine[];
  /** Para birimi başına toplam; fiyatı eksik ekran varsa ilgili tüm toplamlar yine verilir ama `missingRates` > 0. */
  totals: { currency: SalesCurrency; listAmount: string }[];
  missingRates: number;
  generatedAt: string;
}

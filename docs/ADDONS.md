# Ek özellik modülleri (pasif) — 13 Kasım 2026

Spec: `_bmad-output/implementation-artifacts/tech-spec-addon-modules.md`.
Broadsign karşılaştırmasında eksik kalan dokuz alan panele **ek özellik** olarak
eklendi. Kullanıcı kararı (13 Kasım 2026): bayrak arkasında kapalı; admin
"Ek özellikler" sayfasından tek tek açabilir; ajans/marka yalnız salt okunur.

## Bayrak

- Kayıt defteri: `packages/shared/src/addons.ts` (`ADDON_MODULES`).
- Saklama: `settings` tablosu, anahtar `addon.<key>.enabled`. Satır yoksa, değer
  JSON `true` değilse ya da modülün kodu bu sürümde hazır değilse modül **kapalı**.
  Migration ve seed hiçbir bayrağı açmaz; yayımlansa da canlı davranış değişmez.
- `GET /api/v1/addons` (admin) durumu listeler; `PATCH /api/v1/addons/:key`
  `{ enabled }` (admin) bayrağı değiştirir; audit (`ADDON_TOGGLED`) aynı serializable
  transaction içindedir. Yer tutucu veya henüz hazır olmayan modülü açma isteği
  `409 ADDON_NOT_AVAILABLE` döner. Modül uçları kapalıyken `404 ADDON_DISABLED` döner.
- Hiçbir modül mevcut booking akışına (durum geçişleri, doğrulama engelleri,
  CMS işlem kaydı) yazmaz veya engel eklemez.

## Alanlar

| # | Alan | Sınıf | Durum |
|---|---|---|---|
| 1 | Oynatma ve CMS | Yer tutucu | Açılamaz; player + CMS API gerekir |
| 2 | Oynatma kaydı (PoP) içe aktarma | Çalışır, kapalı | Story 3 |
| 3 | Kapasite ve müsaitlik | Çalışır, kapalı | Story 2 |
| 4 | Satış araçları | Çalışır, kapalı (indirim onayı/fatura yer tutucu) | Story 5 |
| 5 | Programatik satış | Yer tutucu | Açılamaz; SSP/DSP anlaşması + teknik erişim gerekir |
| 6 | Kitle ölçümü | Yer tutucu | Açılamaz; sensör veya veri sözleşmesi gerekir |
| 7 | Dinamik içerik / DCO | Yer tutucu | Açılamaz; player + veri sağlayıcı gerekir |
| 8 | Alıcı kataloğu | Çalışır, kapalı (rezervasyon talebi yer tutucu) | Story 6 |
| 9 | Teslimat raporları | Çalışır, kapalı | Story 4 |

Yer tutucu sayfalar yalnız açıklama ve önkoşul listesi gösterir; sahte veri,
istatistik veya bağlantı durumu göstermez.

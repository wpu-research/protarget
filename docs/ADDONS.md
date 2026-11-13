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
| 3 | Kapasite ve müsaitlik | Çalışır, kapalı | Story 2 — uygulandı |
| 4 | Satış araçları | Çalışır, kapalı (indirim onayı/fatura yer tutucu) | Story 5 |
| 5 | Programatik satış | Yer tutucu | Açılamaz; SSP/DSP anlaşması + teknik erişim gerekir |
| 6 | Kitle ölçümü | Yer tutucu | Açılamaz; sensör veya veri sözleşmesi gerekir |
| 7 | Dinamik içerik / DCO | Yer tutucu | Açılamaz; player + veri sağlayıcı gerekir |
| 8 | Alıcı kataloğu | Çalışır, kapalı (rezervasyon talebi yer tutucu) | Story 6 |
| 9 | Teslimat raporları | Çalışır, kapalı | Story 4 |

Yer tutucu sayfalar yalnız açıklama ve önkoşul listesi gösterir; sahte veri,
istatistik veya bağlantı durumu göstermez.

## Kapasite ve müsaitlik (story addon-capacity)

- `GET /api/v1/capacity?from=YYYY-MM-DD&days=1..31&venueId=` (admin, bayrak açık):
  aktif gemideki aktif ekranlar için `loop/slot` kapasitesi, dakika çözünürlüğünde
  tepe kullanım, tepe doluluk %, aşım ve aşıma katılan booking/hold'lar, UTC gün
  bazında tepe değer.
- Sayılanlar: READY/LIVE/PAUSED booking'ler (silinmemiş, ekran satırı aktif),
  kampanya saat diliminde yayın planı içinde **bir slot**; aktif hold'lar kendi
  slot sayıları kadar. Planı olmayan ya da saat dilimi tanınmayan booking tüm uçuş
  süresince sayılır (temkinli). DRAFT, COMPLETED, CANCELLED sayılmaz.
- Loop veya slot süresi girilmemiş/geçersizse kapasite, doluluk ve aşım `null`
  ("Hesaplanamadı"); kullanılan slot yine gösterilir.
- Hold: `screen_holds` tablosu (migration `20261113000000_addon_capacity_holds`).
  `GET/POST /capacity/holds`, `POST /capacity/holds/:id/release` (gerekçe zorunlu).
  Silinmez; serbest bırakma ve oluşturma audit'lidir. Süresi dolan hold sayılmaz.
- Hiçbir booking engeli veya uyarısı eklenmez; mevcut doğrulama değişmez.
- Varsayım (doğrulanmadı): bir booking loop başına bir slot kullanır. Gerçek CMS
  döngü kuralı öğrenilince formül güncellenmelidir.

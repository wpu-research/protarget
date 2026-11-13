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
| 2 | Oynatma kaydı (PoP) içe aktarma | Çalışır, kapalı | Story 3 — uygulandı |
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
- Sayılanlar: DRAFT, READY_FOR_REVIEW, COMPLETED ve CANCELLED dışındaki booking'ler
  (silinmemiş, ekran satırı aktif), kampanya saat diliminde yayın planı içinde
  **bir slot** (ekrana özel plan varsa o, yoksa kampanya geneli); aktif hold'lar
  kendi slot sayıları kadar ve yalnız `expiresAt`'e kadar. Planı olmayan ya da saat dilimi tanınmayan booking tüm uçuş
  süresince sayılır (temkinli). - Loop veya slot süresi girilmemiş/geçersizse kapasite, doluluk ve aşım `null`
  ("Hesaplanamadı"); kullanılan slot yine gösterilir.
- Hold: `screen_holds` tablosu (migration `20261113000000_addon_capacity_holds`).
  `GET/POST /capacity/holds`, `POST /capacity/holds/:id/release` (gerekçe zorunlu).
  Silinmez; serbest bırakma ve oluşturma audit'lidir. Süresi dolan hold sayılmaz.
- Hiçbir booking engeli veya uyarısı eklenmez; mevcut doğrulama değişmez.
- Varsayım (doğrulanmadı): bir booking loop başına bir slot kullanır. Gerçek CMS
  döngü kuralı öğrenilince formül güncellenmelidir.

## Oynatma kaydı içe aktarma (story addon-delivery-import)

- Kaynaklar: `CMS_VERIFIED` (CMS'nin kendi oynatma kaydı), `OPERATOR_DECLARED`
  (operatör beyanı, oynatma), `DECLARED_IMPRESSION` (doğrudan beyan edilen gösterim).
  Ayrı etiketli saklanır, raporda **toplanmaz**. CMS "yüklendi" kaydı kanıt değildir.
- `POST /api/v1/delivery/imports/preview` ve `POST /delivery/imports` — gövde
  `{ source, filename, csv, note? }`, CSV ≤ 90.000 karakter / 2.000 satır (varsayılan
  100 KB JSON limiti değişmedi). Başlık zorunlu; sütunlar: `campaign_code, screen_code,
  played_at (UTC Z), count, impressions, creative_code, duration_seconds, external_id`.
  Genel biçimdir; **gerçek CMS dışa aktarım biçimi doğrulanmadı**.
- Satır kuralları: kampanya kodu var ve en az bir kez yayına alınmış (`launchedAt`),
  ekran ve (varsa) kreatif kampanyada, `played_at` uçuş içinde ve gelecekte değil.
  Gösterim yalnız `DECLARED_IMPRESSION`'da ve orada `count` girilemez.
- Hepsi-ya-hiç: tek hatalı satır varsa hiçbir şey yazılmaz (önizleme hataları satır
  numarasıyla listeler). Aynı kaynakla aynı dosya (sha256) ikinci kez alınmaz (409).
- Tekilleştirme: kaynak + kampanya + ekran + kreatif + saniye + external_id. Dosya içi
  ya da daha önce alınmış (iptal edilmemiş) satır yazılmaz, "mükerrer" sayılır. Farklı
  kaynaktan gelen aynı oynatma ayrı tutulur; raporda yan yana gösterilir.
- Düzeltme: `POST /delivery/records/:id/void` (gerekçe zorunlu). Satır silinmez;
  DB tetikleyicisi silmeyi ve iptal dışı güncellemeyi engeller. Her işlem audit'li.
- Migration: `20261113000100_addon_delivery_import` (iki tablo, kısmi unique index,
  CHECK kısıtları, append-only tetikleyiciler). Yerel Postgres olmadığı için migration
  ve tetikleyiciler **gerçek veritabanında çalıştırılmadı**.

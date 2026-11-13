# Tech-spec — Ek özellik modülleri (pasif) — 12 Kasım 2026

Durum: **onaylandı (13 Kasım 2026)** — bayrak arkasında kapalı, 6 story sırayla, alıcı kataloğu salt okunur. Kaynak istek: Broadsign karşılaştırmasındaki
eksik alanların panele ek özellik olarak, **pasif** halde eklenmesi; dış sistem
gerektirmeyenlerin çalışır kodla yapılması. Çelişkide `docs/MVP_DECISIONS.md` önceliklidir.

## Ortak ilkeler

- Her alan `packages/shared` içindeki tek bir kayıt defterinde (`ADDON_MODULES`) tanımlanır:
  `key`, `kind` (`WORKING` = çalışır kod var / `PLACEHOLDER` = yalnız yer tutucu),
  etkinleştirme için gereken dış önkoşullar.
- Bayrak: `settings` tablosunda `addon.<key>.enabled`; satır yoksa **false**. Migration
  veya seed hiçbir bayrağı açmaz → canlıda yayımlansa bile davranış değişmez.
- API: bayrağı kapalı modülün uçları `404 ADDON_DISABLED` döner (`@RequiresAddon(key)` guard).
  `PLACEHOLDER` modül açılamaz (`409 ADDON_NOT_AVAILABLE`).
- Bayrak değişikliği: yalnız ADMIN, audit ile aynı serializable transaction içinde.
- Mevcut booking akışına (durum geçişleri, doğrulama, CMS işlem kaydı) hiçbir modül
  yazmaz veya engel eklemez. Kapasite/çakışma yalnız **bilgi** üretir.
- Sahte veri yok: bilinmeyen değer `null` ("Hesaplanamadı" / "Veri yok"). Yer tutucu
  ekranlarda istatistik, bağlantı durumu veya örnek kayıt gösterilmez.
- Kaynak etiketleri ayrı kalır: `CMS_VERIFIED`, `OPERATOR_DECLARED`, `DECLARED_IMPRESSION`.
- Para Decimal → string, zaman UTC, TR öncelikli + tam EN.

## Alan → sınıf

| # | Alan | Sınıf | Not |
|---|---|---|---|
| 1 | Oynatma ve CMS (player, loop gönderimi, sağlık, uzaktan yönetim) | PLACEHOLDER | Kendi player'ı ve CMS API erişimi yok |
| 2 | Oynatma kanıtı (PoP) — CMS kaydı içe aktarma | WORKING | Genel CSV biçimi; gerçek CMS dışa aktarım biçimi bilinmiyor |
| 3 | Kapasite ve müsaitlik (doluluk, çakışma, hold) | WORKING | loop/slot girilmemiş ekranda `null` |
| 4 | Satış araçları — teklif belgesi, fiyat kartı, hazır paket | WORKING | İndirim onay akışı ve fatura: PLACEHOLDER (e-fatura entegratörü yok) |
| 5 | Programatik satış (SSP/DSP/OpenRTB/PMP/Deal ID/açık artırma) | PLACEHOLDER | Ayrı anlaşma + teknik erişim gerekir |
| 6 | Kitle ölçümü | PLACEHOLDER | Sensör/kamera ya da üçüncü taraf veri yok |
| 7 | Dinamik içerik / DCO | PLACEHOLDER | Player ve veri sağlayıcı yok |
| 8 | Alıcı self-servisi | Kısmi | Salt-okunur envanter kataloğu WORKING; rezervasyon talebi PLACEHOLDER (yalnız ADMIN yazar kuralı) |
| 9 | Raporlama (teslimat + müşteri raporu) | WORKING | Kaynak: madde 2 verisi + operatör beyanı |

## Story bölümlemesi (her biri `story/{id}` dalı, CR turları `/home/wpu/CLAUDE.md` akışıyla)

1. **addon-foundation** — kayıt defteri, bayrak servisi + guard, `GET/PATCH /addons`,
   admin "Ek özellikler" sayfası (9 alan, durum rozetleri), 1/5/6/7 için yer tutucu
   sayfalar (gereken önkoşul listesiyle), nav girişleri. Migration yok.
2. **addon-capacity** — ekran × tarih aralığı için slot kapasitesi
   (`loopLengthSec / defaultSlotLengthSec`), dolu slot (o aralıkta DRAFT dışı aktif
   booking'ler + süresi dolmamış hold'lar), doluluk %, aşım/çakışma listesi.
   Yeni tablo `screen_holds` (ekran, aralık, slot sayısı, bitiş zamanı, gerekçe, admin).
   Booking'i engellemez; yalnız rapor/uyarı.
3. **addon-delivery-import** — yeni tablolar `delivery_import_batches`,
   `delivery_records` (kaynak etiketi, ekran, kampanya, kreatif, `playedAt`, süre, sonuç,
   tekilleştirme anahtarı UNIQUE). CSV içe aktarma (önizleme → onay), satır bazlı hata
   raporu, aynı kaydın ikinci kez sayılmaması, gerekçeli/audit'li düzeltme (iptal satırı).
   Operatör beyanı ve doğrudan impression beyanı ayrı kaynak olarak girilebilir.
4. **addon-reporting** — admin teslimat raporu (kampanya/ekran/gün kırılımı, kaynak
   kırılımı, hedef varsa delivery % ve pacing; hedef yoksa "Hesaplanamadı"), portal
   müşteri raporu (yalnız kendi kurumu, salt okunur, finansal alanlar varsayılan gizli
   ve API yanıtında da filtreli), CSV dışa aktarma.
5. **addon-sales** — fiyat kartı (ekran/gemi bazlı sürümlü liste fiyatı), hazır paket
   (adlandırılmış ekran grubu), kampanyadan yazdırılabilir teklif belgesi (TR/EN).
   İndirim onayı ve fatura yer tutucu.
6. **addon-buyer-catalog** — portalda salt-okunur envanter kataloğu (aktif gemi/ekran,
   teknik özellik; fiyat yalnız kurum için açılmışsa). Rezervasyon talebi yer tutucu.

## Bilinçli olarak yapılmayanlar

Gerçek player/manifest dağıtımı, otomatik PoP toplama, DSP/SSP/OpenRTB bağlantısı,
kitle sensörü, hava durumu/DCO, yasal e-fatura, ajans/markanın yazma yetkisi.

## Doğrulama

Her story: build, typecheck, lint, unit test (Node 24). Docker/Postgres erişimi yoksa
integration/E2E "çalıştırılamadı" olarak raporlanır. Push, `main`'e merge ve Railway
yayını yalnız kullanıcının açık onayıyla.

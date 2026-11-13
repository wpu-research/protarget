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

## Code Review Findings — Tur 1 (13 Kasım 2026, story addon-foundation) → Düzeltildi

0 high, 0 medium, 3 low (inceleme: ayrı alt ajan, salt okunur).
1. low — `addons.service.ts setEnabled`: aynı değerle PATCH `updatedAt`'i ve audit'i boşuna yazıyordu → değişiklik yoksa yazmadan döner.
2. low — `Addons.tsx Toggle`: yer tutucu/hazır olmayan modülde eski `true` satırı temizlenemiyordu → `storedOn` alanı; saklı `true` varsa "Pasife al" görünür, kapatma her zaman serbest.
3. low — `Addons.tsx StateBadges`: ekran okuyucuda iki rozet bitişik okunuyordu → görünmez ayırıcı.

## Code Review Findings — Tur 2 (13 Kasım 2026, story addon-foundation) → ✅ Onaylandı

Düzeltme diff'i yeniden incelendi (ana oturum): 0 patch, 0 intent_gap. Build, typecheck, lint, 147 unit test geçti.
`main`'e merge kullanıcı onayı bekliyor (görev kuralı: merge/push/yayın yalnız açık onayla).

## Code Review Findings — Tur 1 (13 Kasım 2026, story addon-capacity) → Düzeltildi

1 high, 5 medium, 2 low (ayrı alt ajan, salt okunur).
1. high — yalnız READY/LIVE/PAUSED sayılıyordu; şemadaki diğer çalışan durumlar (LIVE_WITH_EXTERNAL_ERROR, PAUSING…) atlanıyordu → DRAFT/READY_FOR_REVIEW/COMPLETED/CANCELLED dışındaki her durum sayılır.
2. medium — ekrana özel yayın planı yok sayılıyordu → `screenSchedule`: ekrana özel plan varsa o, yoksa kampanya geneli.
3. medium — hold `expiresAt` sonrasında da sayılıyordu → talep aralığı `min(endAt, expiresAt)` ile kırpılır.
4. medium — `expiresAt <= startAt` kabul ediliyordu → 400.
5. medium — rapor ve ekran seçicide 50/100 kaydın ötesi görünmüyordu → filtreleri koruyan sayfalama, ekran listesi tüm sayfalardan.
6. medium — eski aktif hold'lar listede kayboluyordu → varsayılan yalnız geçerli hold'lar (`activeOnly`), "tümü" anahtarı ve sayfalama.
7. low — **ertelendi**: UTC ofseti saat başına önbellekleniyor; 30 dakikalık DST kayması olan bölgelerde (ör. Lord Howe) ≤30 dk sapma. Europe/Istanbul'da DST yok; etkisiz.
8. low — penceresi bitmiş hold ACTIVE görünüyordu → `min(expiresAt, endAt) <= now` ise EXPIRED.

## Code Review Findings — Tur 2 (13 Kasım 2026, story addon-capacity) → ✅ Onaylandı

Düzeltme diff'i ana oturumda incelendi: 0 patch, 0 intent_gap (7 numara bilinçli erteleme). Build, typecheck, lint, 155 unit test geçti.

## Code Review Findings — Tur 1 (13 Kasım 2026, story addon-delivery-import) → Düzeltildi

0 high, 2 medium, 6 low (ayrı alt ajan, salt okunur; i18n eşliği temiz).
1. medium — boş satır/çok satırlı alan varken hata satır numaraları kayıyordu → `splitCsv` fiziksel başlangıç satırını döndürür.
2. medium — aynı anahtarlı ama farklı sayı/süreli satırlar sessizce "mükerrer" sayılıyordu → `CONFLICTING_DUPLICATE` hatası; yalnız aynı değerli satır mükerrer.
3. low — creative/user FK `ON DELETE SET NULL` append-only tetikleyiciyle çakışıyordu → `RESTRICT`.
4. low — beyan gösterim satırı `count = 1` saklıyordu → `count` null, CHECK kaynakla eşli.
5. low — BOM/CRLF farkı dosya-özeti kontrolünü aşıyordu → normalize edilip hash'lenir.
6. low — karakter limiti 100 KB gövde limitini aşabiliyordu → 60.000 bayt (UTF-8), sunucu ve istemcide.
7. low — gevşek tırnak (`"abc"def`) kabul ediliyordu → katı; MALFORMED_CSV.
8. low — özet en fazla 100 hata gösteriyordu → `errorCount`.

## Code Review Findings — Tur 2 (13 Kasım 2026, story addon-delivery-import) → ✅ Onaylandı

Düzeltme diff'i ana oturumda incelendi: 0 patch, 0 intent_gap. Build, typecheck, lint, 164 unit test geçti. Migration/tetikleyiciler gerçek Postgres'te çalıştırılmadı (erişim yok).

## Code Review Findings — Tur 1 (13 Kasım 2026, story addon-reporting) → Düzeltildi

0 high, 3 medium, 4 low (ayrı alt ajan; kurum izolasyonu, bayrak ve i18n temiz).
1. medium — kaydı olmayan kaynak 0 / %0 gösteriyordu → kayıt yoksa tüm rakamlar, teslimat % ve pacing `null`.
2. medium — rakamı eksik satır 0 sayılıyordu → böyle bir satır varsa o kaynağın rakamı `null` (DB CHECK'leri zaten engeller; savunma amaçlı).
3. medium — **kısmen ertelendi**: tüm satırlar belleğe alınıyor. DB tarafı toplama gerçek Postgres olmadan test edilemediği için şimdilik 200.000 satır sınırı (413); `count` sütunlu toplu satırlar gerçek kampanyaları bunun çok altında tutar.
4. low — CSV formül enjeksiyonu → `= + - @ TAB CR` ile başlayan metin hücresine `'` öneki, `\r` tırnaklanır.
5. low — pacing yuvarlanmış değerlerden hesaplanıyordu → yuvarlanmamış oran, en sonda yuvarlama.
6. low — her 404 güvenlik olayı sayılıyordu ve audit hatası 404'ü 500 yapabiliyordu → yalnız başka kuruma ait mevcut kampanya audit'lenir; audit hatası yutulur.
7. low — seçici ilk 100 kampanyayla sınırlıydı → tüm sayfalar (en çok 1.000) ve kesilme uyarısı.

## Code Review Findings — Tur 2 (13 Kasım 2026, story addon-reporting) → ✅ Onaylandı

Düzeltme diff'i ana oturumda incelendi: 0 patch, 0 intent_gap (3 numara kısmen, bilinçli erteleme). Build, typecheck, lint, 172 unit test geçti.

## Code Review Findings — Tur 1 (13 Kasım 2026, story addon-sales) → Düzeltildi

0 high, 2 medium, 4 low (ayrı alt ajan; migration, tetikleyici, bayrak, audit, i18n temiz).
1. medium — tutar 4 ondalığa yuvarlanmış gün sayısıyla çarpılıyordu → tam milisaniyeden hesaplanır, yalnız gösterilen gün yuvarlanır.
2. medium — arayüz para değerini `Number()` ile float'a çeviriyordu → `formatDecimal` (BigInt tam kısım + metin kesir).
3. low — DTO sıfır fiyatı kabul ediyordu (DB CHECK 409 veriyordu) → 400.
4. low — saniyeli `datetime-local` 400 veriyor, şimdiki dakika "geçmiş" sayılıyordu → `step=60`, `new Date(…Z)`, 60 sn tolerans.
5. low — 100 kaydın ötesi sessizce gizleniyordu → "ilk N / toplam" uyarısı.
6. low — pakette silinmiş ekran listeleniyor, pasif ekran kabul ediliyordu → silinmiş filtrelenir, yalnız aktif ekran.

## Code Review Findings — Tur 2 (13 Kasım 2026, story addon-sales) → ✅ Onaylandı

Düzeltme diff'i ana oturumda incelendi: 0 patch, 0 intent_gap. Build, typecheck, lint, 176 unit test geçti.

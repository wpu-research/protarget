---
title: 'Kampanya/booking — kreatif yükleme, ekran/tarih/hedef planı ve manuel CMS işlem kaydı'
type: 'feature'
created: '2026-11-11'
status: 'review'
acceptance_status: 'review'
target_file: 'tech-spec-campaign-booking.md'
branch: 'story/campaign-booking'
baseline_commit: '33462a7'
context:
  - 'docs/MVP_DECISIONS.md'
  - 'docs/SPRINT_PLAN.md'
  - 'docs/PRODUCT_SCOPE.md'
  - 'docs/BUILD_PROMPT.md §5–6, §11.7–11.10'
---

# Kampanya/booking — manuel CMS operasyonu

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Admin, reklamveren/ajans için kampanya planlayamıyor, kreatif yükleyemiyor, ekran/tarih/hedef seçemiyor ve operatörün mevcut CMS'ye yaptığı manuel yükleme/başlatma/durdurma işlemlerini kaydedemiyor. `campaigns` ve `creatives` modülleri boş kabuk.

**Approach:** Yalnız admin için kampanya listesi, 6 adımlı booking sihirbazı (Temel → Ekranlar → Ticari ve hedef → Kreatif → Yayın planı → Özet ve hazırlık), kampanya detayı, kreatif kütüphanesi (gerçek dosya yükleme + teknik doğrulama + ayrı admin onayı) ve ekran bazlı, salt eklenen CMS işlem kaydı. Durumlar operatör **beyanıdır**; fiziksel yayının kanıtı değildir.

**Kullanıcı kararları (11 Kasım 2026):** gerçek dosya yükleme bu story'de; sade durum alt kümesi; CMS checklist/işlem kaydı bu story'de; ticari alanlar şimdi ama yalnız admin; ajans/marka portal görünürlüğü müşteri raporu story'sinde; depolama tek arayüz + yerel disk/S3 sürücüleri; MP4/H.264 + JPG/PNG, ≤200 MB, sha256 + ffprobe, antivirüs yok; dal `inceleme-temizlik`'ten.

## Boundaries & Constraints

**Always:** Her okuma/yazma `sessions.requireAdmin` ile serializable transaction içinde; her mutation aynı transaction'da `audit.append` (önce/sonra, kampanya kimliği metadata'da). Para `Decimal` → API'de string; zaman UTC saklanır, arayüz kampanya timezone'unda gösterir. TR/EN anahtar eşliği. Sayfalama. Bilinmeyen değer `null` ve arayüzde “Bilinmiyor/Hesaplanamadı”; uydurma varsayılan yok (görsel kreatif süresi elle girilir, 10 sn varsayılanı yok). Kullanıcı arayüzünde terim “Booking / Rezervasyon”; Deal adımı ve dış Deal ID yok. LIVE/PAUSED etiketleri “operatör beyanı” notuyla gösterilir. Mevcut veri silinmez; migration yalnız ekleme yapar.

**Ask First:** Yıkıcı migration, Railway'e yayın veya bucket/servis oluşturma, `main`'e merge, push, kök `.env` değişikliği, yeni kapsam (portal, otomatik tamamlama işi, kapasite formülü).

**Never:** Ajans/marka/destek rollerine kampanya veya kreatif verisi ya da mutation rotası; spend/gelir hesaplama veya sahte tutar; PAUSING/RESUMING/READY_FOR_REVIEW/*_WITH_EXTERNAL_ERROR kullanımı; manifest, player, PoP, teslimat/impression girişi, pacing, Deal/connector; slot/loop kapasitesi varsayımıyla playout kapasitesi üretmek; üretimde geçici diske kreatif yazmak; gizli değerleri log/yanıt/audit'e koymak.

## Durum makinesi (sade alt küme)

```
DRAFT → READY            doğrulama blocker'sız; READY iken plan değişirse otomatik DRAFT (audit)
READY → LIVE             blocker'sız + her aktif ekranda CMS_UPLOADED kaydı var
LIVE  → PAUSED           gerekçe zorunlu; ekran bazlı PLAYBACK_PAUSED eksikleri uyarı olarak listelenir
PAUSED → LIVE            gerekçe zorunlu; blocker yeniden hesaplanır
LIVE/PAUSED → COMPLETED  manuel; bitiş geçince listede “Bitiş geçti” rozeti (otomatik iş yok)
DRAFT/READY/PAUSED → CANCELLED  gerekçe zorunlu
```
Geçersiz geçiş 409. COMPLETED/CANCELLED salt okunur. LIVE/PAUSED iken yalnız not ve bitişi ileri uzatma düzenlenir (ekran/kreatif/plan/ticari kilitli). Silme: yalnız DRAFT, soft delete.

## I/O & Edge-Case Matrix

| Senaryo | Girdi / Durum | Beklenen | Hata |
|---|---|---|---|
| Oluştur | Ad 3–150, aktif ADVERTISER kurum, opsiyonel aktif AGENCY kurum, aktif ADMIN sahip, start<end, IANA tz | DRAFT, `CMP-YYYY-NNNN` sunucuda, audit | 400 doğrulama; yanlış kurum tipi/pasif: 400 |
| Kod yarışı | Eşzamanlı oluşturma | Tekil, boşluksuz kodlar | Serileştirme tekrarı; kısmi yazma yok |
| Ekran seçimi | Toplu ≤100 ekran ID | Yalnız aktif ekran + aktif gemi eklenir | Pasif/eksik: 409 ve hiçbir ekran eklenmez |
| Sonradan pasif ekran | Seçili ekran pasifleşir | Kayıt kalır; doğrulamada blocker | — |
| Ticari | Model CPM/CPP/FIXED/PG, TRY/USD | CPM/CPP/PG: birim fiyat >0; FIXED: sözleşmeli tutar; PG: garanti impression **veya** sözleşmeli miktar; paylar ikisi varsa toplam 100 | Üs, >4 ondalık, negatif, aralık dışı: 400 |
| Ticari boş | Model `null` | Kaydedilir; özet “Ticari şart girilmedi” uyarısı (blocker değil) | — |
| Hedef | `primaryGoal` PLAYOUTS/IMPRESSIONS + ilgili hedef >0; diğeri opsiyonel bilgi | İkisi ayrı birimde saklanır/gösterilir | Hedef eksik: blocker |
| Yükleme | MP4(H.264)/PNG/JPEG ≤200 MB, advertiser | Akışla sha256, imza + ffprobe; geçerse VALIDATING (admin incelemesi bekliyor) | Tip/codec uyumsuz, bozuk: REJECTED + gerekçe; >200 MB: 413; depolama yapılandırılmamış: 503 |
| Görsel süre | PNG/JPEG | Gösterim süresi elle zorunlu (1–300 sn) | Eksik: 400 |
| Mükerrer | Aynı advertiser + checksum | — | 409 mevcut kreatif ID'si ile |
| Onay | VALIDATING → APPROVED / REJECTED(gerekçe) | Onaylanan dosya/metadata değişmez; yeni sürüm `replacesId` ile | Yanlış durum: 409 |
| Depolama hatası | Dosya yazıldı, DB tx düştü | Dosya en iyi çabayla silinir; artık kalırsa log | 500 standart zarf |
| Kreatif bağlama | Kampanya ile aynı advertiser | DRAFT'ta onaysız da bağlanır | Farklı advertiser: 400 |
| Plan | Gün 1–7, HH:mm başlangıç≠bitiş, gece yarısını aşan izinli | Kampanya geneli dilimler, tamamı değiştirilir | Aynı günde çakışma: 400 |
| Doğrulama | `GET /campaigns/:id/validation` | Blocker: ekran yok, onaylı kreatif yok, geçersiz flight, hedef yok, pasif ekran, plan yok, IMPRESSIONS hedefinde çarpansız ekran, bilinen saatlerle kesişim yok, video süresi bilinen slot süresinden uzun. Uyarı: ekran saati/slot bilinmiyor, saat dilimi farklı (kesişim hesaplanmadı), çözünürlük uyumsuz, ticari şart yok | — |
| CMS işlemi | Ekran (kampanyada), tip, `performedAt` ≤ şimdi ve ≥ kampanya oluşturma, opsiyonel CMS referansı/not | Salt eklenir; aktör/kayıt zamanı sunucuda; “operatör beyanı” | Düzeltme yeni kayıtla; UPDATE/DELETE DB'de engelli |
| LIVE'a geçiş | CMS_UPLOADED eksik ekran var | — | 409 + eksik ekran listesi |
| Yetkisiz | Anonim / ajans / marka / destek, tüm rotalar | Veri veya mutation yok | 401 / 403; önce-sonra DB aynı |

</frozen-after-approval>

## Code Map

- `apps/api/prisma/schema.prisma` — Campaign/CampaignScreen/CampaignCreative/Creative/Schedule mevcut. Eklenecek: `Campaign.targetImpressions BigInt?`, `Campaign.primaryGoal CampaignGoal?`, `Creative.approvedById/approvedAt/videoCodec/displayDurationManual`, yeni `CampaignCmsOperation` + `CmsOperationType` enum (CMS_UPLOADED, PLAYBACK_STARTED, PLAYBACK_PAUSED, PLAYBACK_RESUMED, PLAYBACK_STOPPED, NOTE).
- `apps/api/prisma/migrations/20261110000100_constraints` — `campaigns_flight_valid`, `campaigns_share_sum` mevcut; korunur.
- `apps/api/src/modules/{venues,screens,multipliers}` — desen: `inventoryTransaction`, `requireAdmin`, `audit.append`, DTO + `common/inventory-validation`.
- `apps/api/src/modules/{campaigns,creatives}` — boş modüller; doldurulacak.
- `apps/web/src/components/Inventory.tsx`, `apps/web/src/app/admin/[[...slug]]/page.tsx`, `apps/web/src/lib/nav.ts`, `Shell.tsx` — arayüz deseni ve yönlendirme.
- `packages/shared/src/{inventory,enums,errors,index}.ts`, `packages/i18n/src/{tr,en}.json`.
- `infra/Dockerfile.api`, `docker-compose.yml` (`storage` profilinde MinIO), `.env.example`.

## Tasks & Acceptance

**Execution:**
- [x] `schema.prisma`, `migrations/20261111000000_campaign_booking/migration.sql` — yukarıdaki alanlar/tablo; `campaign_cms_operations` için UPDATE/DELETE engelleyen trigger; hedef >0 ve kampanya ↔ kreatif advertiser eşleşmesi kontrolleri; indeksler. Mevcut satırlar korunur (tümü nullable/ek).
- [x] `packages/shared/src/campaigns.ts`, `enums.ts`, `errors.ts`, `index.ts` — yanıt sözleşmeleri, blocker/uyarı kodları, sade durum geçiş tablosu (API ve web ortak kullanır).
- [x] `apps/api/src/common/storage/` — `ObjectStorage` arayüzü; `LocalDiskStorage` (geliştirme/test) ve `S3Storage` (`@aws-sdk/client-s3`, sürüm sabit). `STORAGE_DRIVER` üretimde açıkça ayarlı değilse yükleme 503; anahtarlar yalnız ortamdan, yanıt/audit'e girmez.
- [x] `apps/api/src/modules/creatives/` — liste (advertiser/durum filtresi, sayfalı), detay, multipart yükleme (multer disk temp, 200 MB sınır), imza (magic bytes) + `ffprobe` (süre, genişlik/yükseklik, codec), sha256, onay/red, yeni sürüm, admin-only dosya akışı (`GET /creatives/:id/file`). Kod `CR-YYYY-NNNNN`.
- [x] `apps/api/src/modules/campaigns/` — CRUD (sayfalı, durum/advertiser/ajans/arama filtreleri), ekran seçenekleri (gemi/şehir/yön/aktif filtreleri; mevcut çarpan, çalışma saatleri, loop/slot ve kampanya planıyla kesişen pencere saati veya `null`), toplu ekran ekle/çıkar, kreatif bağla/çöz, plan değiştir, ticari ve hedef PATCH, doğrulama, geçiş (`POST /campaigns/:id/transitions`), CMS işlemleri (liste/ekle + ekran bazlı checklist özeti), etkinlik (kampanya audit geçmişi).
- [x] `infra/Dockerfile.api` — çalışma imajına `ffmpeg` (ffprobe için); `.env.example` — depolama değişkenleri (değersiz); `docker-compose.yml` — API'yi `storage` profiline bağla.
- [x] `apps/web/src/components/Campaigns.tsx`, `Creatives.tsx`, admin dispatcher, `nav.ts`, `Shell.tsx`, `globals.css` — liste; 6 adımlı sihirbaz (her adım taslak kaydeder); detay sekmeleri Genel / Ekranlar / Kreatif / Plan / CMS işlemleri / Etkinlik; geçiş butonları blocker varken devre dışı ve gerekçe diyaloğu; kreatif kütüphanesi (yükleme ilerlemesi, önizleme, onay/red). “Operatör beyanı”, “Bilinmiyor”, “Hesaplanamadı” etiketleri; mobil taşma yok.
- [x] `packages/i18n/src/{tr,en}.json` — eşleşen anahtarlar; Booking/Rezervasyon terimi; kampanya navigasyonu “planlanıyor”dan çıkar, rapor/teslimat planlı kalır.
- [x] `apps/api/test/campaigns.unit-spec.ts`, `creatives.unit-spec.ts`, `campaigns.integration-spec.ts`, `apps/web/e2e/campaigns.spec.ts` — matrisin tamamı; tüm rollerle önce/sonra DB kontrolü; geçiş tablosu; kod yarışı; trigger ile salt ekleme; migration öncesi veri korunumu; ffmpeg ile test sırasında üretilen MP4/PNG fikstürleri; yerel disk sürücüsü; S3 sürücüsü mock istemciyle; TR/EN ve 375 px mobil akış (oluştur → ekran → kreatif yükle/onayla → plan → READY → CMS kaydı → LIVE → PAUSED → COMPLETED).
- [x] `docs/openapi.json`, `docs/CAMPAIGNS.md`, `docs/ACCEPTANCE.md`, `README.md`, `sprint-status.yaml` — yeni rotalar ve gerçek doğrulama; S3/Railway bucket ve Compose çalıştırılamadıysa açıkça “çalıştırılamadı”.

**Acceptance Criteria:**
- Admin bir kampanyayı sihirbazla oluşturup yeniden açtığında ekran, kreatif, plan, ticari alanlar ve hedef TR/EN'de, mobilde taşmadan, audit geçmişiyle görünür.
- Blocker varken READY/LIVE geçişi hem arayüzde hem API'de reddedilir; CMS_UPLOADED kaydı eksik ekran LIVE'ı engeller; tüm geçişler ve CMS işlemleri audit'tedir ve “operatör beyanı” olarak etiketlidir.
- Ajans/marka/destek hiçbir kampanya/kreatif verisini veya dosyasını alamaz; mevcut Faz 0 ve envanter regresyon testleri geçer; çalıştırılmayan kontroller doğrulanmamış olarak kalır.

## Spec Change Log

- 2026-11-11: Kullanıcı tarafından onaylandı ("Onaylıyorum, başla").
- 2026-11-11 (CR-1 sonrası, kullanıcı: "Önerilenlerle düzelt"):
  - G1: CMS_UPLOADED yalnız son etkin plan değişikliğinden (`planChangedAt`) sonra sunucuya kaydedilmişse (`recordedAt`) sayılır. CMS işlemi yalnız READY/LIVE/PAUSED'da; NOTE ayrıca DRAFT'ta. COMPLETED/CANCELLED salt okunur kalır.
  - G2: Onaylı kreatif gerekçeyle `REVOKED` yapılabilir. Bağlı READY kampanyalar DRAFT'a döner; LIVE/PAUSED kampanyalarda `REVOKED_CREATIVE` uyarısı çıkar ve kreatif plan kilidine rağmen çözülebilir.
  - G3: Para birimi, tolerans ve faturalama esası yalnız fiyat modeli seçilince gösterilir (yalnız arayüz).
  - Belgelenen sapmalar (P31): el ile READY→DRAFT izinli; `performedAt` için 60 sn istemci saat toleransı; `maxPlayoutsPerHourPerScreen` yalnız bilgi amaçlı plan frekansı (kapasite hesabı yok); REJECTED kayıtlar mükerrer sayılmaz.
  - P33 defer'e taşındı: migration yükseltme kontrolü owner rolü gerektirir; test rolü yetkisiz. Elle yapılan satır sayısı karşılaştırması kanıt olarak kalır.

## Verification

- `rtk pnpm build`, `rtk pnpm typecheck`, `rtk pnpm lint`, `rtk pnpm test` — Node 24.22.2 (`/tmp/protarget-node24`).
- `rtk pnpm local integration`, `rtk pnpm local e2e` — kullanıcı dizinindeki izole PostgreSQL 14 cluster'ı; üretime asla.
- `rtk pnpm local openapi` — rotalardan yeniden üret.
- Çalıştırılamayacağı öngörülen: gerçek S3/bucket, Docker Compose `storage` profili, Railway yayını.


## Implementation record — 2026-11-11

- Kullanıcı onayıyla `story/campaign-booking` dalında; remote işlem ve yayın yok.
- API: `campaigns`, `creatives`, `common/storage` (yerel disk + S3), `common/codes`.
  Web arayüzü ve E2E bir alt ajanla yazıldı; ana oturum tüm zinciri yeniden çalıştırdı.
- Spec'ten sapmalar ve ek kararlar:
  - CORS yalnız GET/POST/PATCH izin verdiği için kaldırma işlemleri POST
    (`/screens/remove`, `/creatives/remove`, `/archive`) ve plan değiştirme POST `/schedule`.
  - Teknik doğrulamadan geçmeyen dosya depolamaya yazılmaz; `REJECTED` satırında `storageKey` boştur.
  - Web proxy'si (`apps/web/src/app/api/v1/[...path]/route.ts`) yalnız `POST /creatives`
    için multipart akışına (≤201 MB, 10 dk) ve yalnız `GET /creatives/:id/file` için
    ikili yanıta açıldı; diğer rotalarda JSON/32 KB sınırı aynı.
  - Gereksiz bir geçici dosya temizleme interceptor'ı denendi ve kaldırıldı
    (Nest 12 FileInterceptor zaten temizliyor); sızıntı yokluğu entegrasyon testinde.
- Doğrulama: build 8/8, typecheck, lint; 120 + 2 unit, 77 integration, 36 E2E geçti.
  Çalıştırılamayanlar `docs/ACCEPTANCE.md` içinde.
- Bilinen küçük kusurlar (CR'da değerlendirilmeli): boş not detayda “Bilinmiyor”
  görünüyor; reklamveren filtresi `/organizations`'tan en fazla 1000 kayıt okuyor;
  portal navigasyonunda önceden var olan “Kampanyalar/Rezervasyonlar” gelecek
  yer tutucuları duruyor (veri yok).

### Code Review Findings — Tur 1 (2026-11-11) → Düzeltildi, CR-2 bekleniyor

Katmanlar: Blind Hunter, Edge Case Hunter, Acceptance Auditor (hepsi tamamlandı). 103 ham bulgu → birleştirme sonrası 3 intent_gap, 33 patch, 7 defer; 15 red.

**Intent gap (kullanıcı kararı gerekli)**
- G1 (yüksek) CMS_UPLOADED kanıtı hiç eskimiyor: plan değişikliği, ekran çıkar/ekle, kreatif değişimi ya da DRAFT'ta yazılmış kayıt LIVE kapısını açıyor. Öneri: yalnız son plan değişikliğinden sonra (`planChangedAt`) yazılmış CMS_UPLOADED sayılsın; CMS işlemi DRAFT'ta kabul edilmesin. — campaigns.service.ts validate/recordCmsOperation
- G2 (orta) Onaylı kreatif geri çekilemiyor (trigger statüyü donduruyor, uç nokta yok). Öneri: gerekçeli APPROVED→REVOKED (yeni durum) ve bağlı READY kampanyaları DRAFT'a düşürme; ya da bilinçli olarak kapsam dışı bırakma.
- G3 (düşük) Şema varsayılanları (TRY, %1 tolerans, CONTRACTED) admin girmiş gibi gösteriliyor. BUILD_PROMPT %1'i belirtiyor; ticari model seçilmeden bu alanlar gizlensin mi?

**Patch — yüksek/orta**
- P1 Kısa flight ile haftalık dilimler: NO_PLAYBACK_WINDOW yalnız soyut haftada hesaplanıyor; flight içinde hiç oynatma günü yoksa READY/LIVE geçiyor. Flight aralığıyla kesiştir. — booking-rules.ts
- P2 CMS işlemleri COMPLETED/CANCELLED'da API'den yazılabiliyor; NOTE boş not kabul ediyor. — recordCmsOperation
- P3 Büyük harfli UUID: depolama anahtarı regex'i 500 veriyor, replacesId ve advertiser karşılaştırması yanlış, ArrayUnique büyük/küçük harf ayrımı yanlış 409. DB'den dönen id'yi kullan / DTO'da küçült. — creatives.service.ts, campaigns.service.ts, campaigns.dto.ts
- P4 `replaceSchedule` ekran bazlı eski plan satırlarını audit'siz siliyor; `screenId: null` ile sınırla. — campaigns.service.ts
- P5 `NODE_ENV` ayarlı değilse üretimde geçici diske yazılıyor; geçici dizin yalnız NODE_ENV açıkça development/test iken. — object-storage.ts
- P6 MP4 kontrolü MOV/3GP'yi geçiriyor (`format_name` mov ailesi); `major_brand` kontrolü, `-protocol_whitelist file`, `attached_pic` akışlarını atla, döndürme (rotation) ile boyut değişimi, görsel boyut üst sınırı. — media.ts
- P7 ffprobe zaman aşımı/ENOBUFS/EACCES/sinyal kalıcı REJECTED üretiyor; 503 olmalı. — media.ts
- P8 `storage.put` temizleme try'ı dışında; yarım nesne kalıyor. S3 PutObject akışı SDK yeniden denemesinde tüketilmiş oluyor. — creatives.service.ts, object-storage.ts
- P9 Değer değiştirmeyen PATCH / 0 satırlık ekle-çıkar READY'yi DRAFT'a düşürüyor ve boş audit yazıyor; sihirbaz tüm ticari alanları gönderiyor. — campaigns.service.ts, CampaignWizard.tsx
- P10 PAUSED→LIVE bitişten sonra mümkün; READY→LIVE başlangıçtan çok önce uyarısız. — booking-rules.ts/transition
- P11 Durdurmada eksik PLAYBACK_PAUSED ekranları kullanıcıya gösterilmiyor (yalnız audit). — CampaignDetail.tsx
- P12 Mükerrer kontrolü yalnız uygulamada; kısmi UNIQUE (advertiserId, checksum) WHERE status<>'REJECTED'. Sürüm zinciri çatallanabiliyor (aynı replacesId iki kez). — yeni migration
- P13 Sihirbaz düzenlemede pasif reklamveren/ajans/sahip seçenekten düşüyor (düzenleme engelleniyor, ajans sessizce siliniyor). — page.tsx, CampaignWizard.tsx
- P14 Saniyeli `endAt`/`startAt`: dakikaya kırpma notes-only kaydı engelliyor ve READY'yi düşürüyor. — CampaignDetail.tsx, CampaignWizard.tsx, zone.ts

**Patch — düşük**
- P15 Onaylı kreatifin süresi null ise CREATIVE_TOO_LONG atlanıyor; uyarı ekle.
- P16 Saat dilimi karşılaştırması kanonikleştirilmeden (alias/küçük harf) yanlış TIMEZONE_MISMATCH.
- P17 `screenOptions` silinmiş seçili ekranı gizliyor.
- P18 CHECK ihlali (23514) 500 dönüyor; 409/400'e eşle.
- P19 Content-Disposition `'()*` kaçışı ve ASCII `filename=` yedeği.
- P20 Etkinlik sekmesi ham İngilizce aksiyon kodu ve JSON gösteriyor; TR/EN yerelleştir.
- P21 Boş not "Bilinmiyor" görünüyor; "Girilmedi".
- P22 Türkçe ondalık virgül (125,50) reddediliyor; normalize et.
- P23 Fiyat modeli "yok"a geçince tüm ticari alanlar sessizce null'lanıyor; onay iste.
- P24 Ekran seçicide sayfa/filtre değişiminde seçim tutarsızlığı; boş son sayfa.
- P25 Geçiş 409'unda durum yeniden yüklenmiyor; arşivlemede onay yok.
- P26 CMS zamanı varsayılanı/sunucu mesajları (gelecek / booking'den önce) için özel TR/EN ipuçları.
- P27 Özet adımında onay sonrası bayat onaylı kreatif sayısı.
- P28 Kreatif adımı 100 kayıtla, `listAll` 1000 ile sessizce sınırlı; sayfalama veya uyarı.
- P29 Gece yarısında biten dilim (08:00–00:00) "gece aşan" etiketleniyor.
- P30 Yükleme istemcisi: onabort yok, sayfadan çıkınca XHR iptal edilmiyor, 401'de tüm dosya yeniden gönderiliyor.
- P31 Spec/belge eşitlemesi: READY→DRAFT el ile geçiş, `performedAt` 60 sn toleransı, `maxPlayoutsPerHourPerScreen` (bilgi amaçlı), REJECTED kayıtların mükerrer sayılmaması — Spec Change Log ve CAMPAIGNS.md'ye yaz.
- P32 Kreatif reddi/onayı CreativesStep içinde kampanyayı yenilemiyor (P27 ile aynı akış).
- P33 Migration korunumu yalnız elle doğrulandı; otomatik upgrade testi (6 migration + eski satırlar → 7.) ekle.

**Defer**
- D1 Video önizlemede Range/206 desteği yok (Safari, ileri sarma).
- D2 Proxy 10 dk toplam zaman aşımı; boşta kalma zaman aşımı ve 504.
- D3 Compose `storage` profili yarım (minio depends_on, bucket kurulumu) — Docker yok.
- D4 Çarpanın flight boyunca kısmi kapsaması (validTo flight içinde) — teslimat/impression story'si.
- D5 Advertiser değişimi için DB düzeyinde trigger (uygulama koruyor).
- D6 Yükleme geçici dosyası session kontrolünden önce diske yazılıyor (JWT rol guard'ı var); ayrı upload dizini + süpürücü + oran sınırı.
- D7 DST katlanma belirsizliği (Europe/Istanbul DST kullanmıyor).

**Reddedilenler (15):** `.env.example`'da S3 kimlik alanları zaten var; serializable çakışmalar `db.serializable` ile 3 kez yeniden deneniyor; LIKE joker karakterleri; depolama yapılandırma hatasında açılışta düşme (bilinçli fail-fast); overlapping onaylı çarpan (DB exclusion engelliyor); eşit çalışma saatleri (envanter reddediyor); onaylanmamış kreatif reddinin READY'yi etkilememesi; audit'te campaignId (entityId zaten kampanya); ekran seçicide aktif filtresi (pasif eklenemez); test dosya adları; S3 akış iptali (Nest StreamableFile); `durationManual` adı; legacy NOT VALID (taşınan veride ihlal yok, P18 kapsıyor); yükleme ilerleme doğrulaması; manuel READY→DRAFT (P31'de belgeleniyor).

**Tur 1 düzeltme kaydı (2026-11-11):** G1–G3 kullanıcının "Önerilenlerle düzelt" kararıyla; P1–P32 uygulandı (P33 defer). Yeni migration `20261111000100_campaign_booking_review` (yalnız ekleme; test DB satır sayıları önce/sonra aynı). Bilinçli davranış: LIVE/PAUSED'da bitişi uzatmak plan değişikliğidir; yeniden LIVE'a geçmeden önce yeni CMS_UPLOADED kaydı gerekir. Ana oturum doğrulaması: build 8/8, typecheck, lint temiz; 136 API + 2 web unit, 88 integration, 42 E2E geçti. Unit-only: 23514 eşlemesi, ffprobe kesinti (503), döndürme, gerçek S3 yeniden denemesi.

### Code Review Findings — Tur 2 (2026-11-11) → Düzeltildi (CR-3 incelendi)

Aralık `c6609b9..8f007c9`. Katmanlar: Blind Hunter, Edge Case Hunter, Acceptance Auditor (hepsi tamamlandı). CR-1'in G1–G3 ve P1–P32 maddeleri büyük ölçüde doğru uygulanmış; yeni bulgular çoğunlukla düşük/orta. Bu turda çalıştırılan test yok; yalnız kodda doğrulama yapıldı. **1 intent_gap, 14 patch, 6 defer**; 11 red.

**Intent gap (kullanıcı kararı gerekli)**
- G4 (orta) REVOKED kreatifin içeriği o reklamverene kalıcı kilitleniyor: mükerrer kontrolü (`creatives.service.ts:137`) ve kısmi UNIQUE `creatives_advertiser_checksum_live_key` yalnız REJECTED'ı dışlıyor. Aynı dosya revoke sonrası yüklenirse `DUPLICATE_CREATIVE` döner; yeniden yükleme yolu yok. Seçenekler: (a) REVOKED'ı da dışla (indeks + kontrol; geri çekilen içerik yeniden yüklenip onaylanabilir); (b) bilinçli kilit, ama mükerrer yanıtında "geri çekilmiş" ayrı mesaj. Öneri: (b)'nin mesajı + hukuki geri çekme senaryosu için kilit korunur.

**Patch — orta**
- P1 `CampaignWizard.tsx:248` `decimal()` virgülü hep ondalık sayıyor; EN'de `1,500` → 1.500, `1,000,000` → reddedilir/yanlış. Yalnız tek virgül ve nokta yokken çevir, aksi halde ham bırak (sunucu reddetsin); EN için E2E.
- P2 `media.ts:112-115` ffprobe `killed/signal/ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 503 yapıyor: ffprobe'u çökerten/zaman aşımına uğratan/4 MB'dan büyük çıktı üreten dosya hiç REJECTED olmuyor, sonsuz 503. Bunları `UNREADABLE_MEDIA` REJECTED say; yalnız ENOENT/EACCES/ENOMEM/EMFILE/EAGAIN 503 kalsın. Unit test ekle.
- P3 `creatives.service.ts:187` revoke COMPLETED/CANCELLED kampanyalara da `planChangedAt` yazıyor (spec: salt okunur). Terminal durumları atla (audit istenirse yalnız audit).
- P4 `docs/CAMPAIGNS.md` P31/G1/G2/P5 ile eşitlenmemiş: el ile READY→DRAFT, `performedAt` 60 sn toleransı, `maxPlayoutsPerHourPerScreen` bilgi amaçlı, CMS işlemi yalnız READY/LIVE/PAUSED (+NOTE DRAFT), `planChangedAt` tazeliği, `REVOKED_CREATIVE` davranışı; geçici dizin/HTTPS kuralı artık "yalnız NODE_ENV development/test" (satır ~59–60 eskimiş).

**Patch — düşük**
- P5 Migration `UPDATE campaigns SET planChangedAt = updatedAt` (`…_review/migration.sql:19`): `updatedAt` READY→LIVE geçişiyle de ilerlediği için mevcut LIVE/PAUSED kampanyaların tüm CMS kanıtları eski görünür. `LEAST(updatedAt, ilk CMS_UPLOADED recordedAt)` ya da `createdAt` kullan (yeni migration gerekmez; henüz dağıtılmadıysa mevcut dosyayı düzelt, aksi halde yeni migration).
- P6 `MP4_BRANDS` (`media.ts:53`) dar: `iso3`, `mmp4`, `MSNV`, `iso8/9`, `cmfc` gibi geçerli H.264 MP4 markaları reddedilir. Kara liste (`qt  `, `3gp*`, `3g2*`) ya da geniş liste.
- P7 `/admin/creatives` sayfasında `advertisers` seçenekleri aynı 1000 kayıt sınırıyla kuruluyor ama `truncated` uyarısı iletilmiyor (`page.tsx:91`; P28 kısmi).
- P8 Eşzamanlı aynı dosya yüklemesinde kısmi UNIQUE ihlali (P2002) genel 409 `INVALID_STATE_TRANSITION` oluyor; yükleme transaction'ında `DUPLICATE_CREATIVE`'e çevir (mevcut kreatif ID'siyle).
- P9 `upload.ts`: `request.timeout` tanımsız, `ontimeout` hiç tetiklenmez; yarım bağlantıda yükleme sonsuza dek "meşgul". Zaman aşımı ayarla; 2xx ama şekil uyumsuz yanıtta "kayıt oluşmuş olabilir, listeyi kontrol edin" mesajı.
- P10 `CampaignDetail.tsx` `CreativesTab onChange={setCampaign}`: revoke edilmiş kreatif unlink edilince `refreshValidation()` çağrılmıyor; genel sekmedeki engel/uyarı bayat kalır (CmsTab yeniliyor).
- P11 `campaigns.service.ts` `screenRows` `lastOps` NOTE'u dışlamıyor ve `performedAt` ile sıralıyor; `screensLacking` ise NOTE'u dışlıyor → PLAYBACK_PAUSED sonrası NOTE girilmiş ekran arayüzde "eksik" çıkıyor, audit'te çıkmıyor. İkisini aynı kurala getir (+ aynı `active` filtresi). *Kodda yalnız kısmen doğrulandı.*
- P12 `S3Storage.put` yeniden denenemez hataları (403/AccessDenied/NoSuchBucket) da 3 kez gecikmeyle deniyor; `$metadata.httpStatusCode < 500 && !== 429` ise hemen at.
- P13 `update`: `overdeliveryTolerancePct: null` gönderimi no-op tespitinden kaçıp `planChangedAt` damgalayabilir ve READY'yi DRAFT'a düşürebilir. *Doğrulanmadı; testle teyit et.*
- P14 `CMS` bağlamı `bookingError` 409'da diyaloğu düşürüyor / sunucu mesajı regex'ine bağlı (`/future/`, `/preced|before/`, `/\bnote\b/`): sunucuya ayrı hata `details.reason` kodu ekleyip istemci kodu okusun.

**Defer**
- D8 Migration'daki iki kısmi UNIQUE indeks mevcut kirli veride (çatal/mükerrer) düşer; henüz dağıtılmadı, ama dağıtımdan önce ön kontrol (`DO $$ … RAISE`) ekle.
- D9 `flightMask` PAUSED→LIVE'da geçmişi de kapsıyor; `weeklyWindowHours` flight'a duyarsız (tabloda "X saat", doğrulamada engel olabilir); `offsetMinutes` yarım saatlik DST bölgelerinde 30 dk kayabilir (Lord_Howe).
- D10 `revoke` çok kampanyaya bağlı kreatifte tek serializable işlemde N×update+audit (10 sn zaman aşımı); `updateMany`/`createMany`.
- D11 `isCheckViolation` yalnız birim testle doğrulanmış (belgelenmiş) ve her 23514'ü "reload and retry" 409'una çeviriyor; gerçek Prisma hata şeklini entegrasyonda doğrula; `\b23514\b` payload'da eşleşebilir.
- D12 Eski per-screen `schedule` satırları (varsa) `weeklyWindowHours`/doğrulamaya giriyor mu — kod yolunu doğrula.
- D13 `planChangedAt`/`recordedAt` uygulama saatiyle yazılıyor (çok örnekli saat kayması); `revokedAt` UTC gösteriliyor; `Asia/Calcutta` testi ICU'ya bağlı.

**Reddedilenler (11):** COMPLETED/CANCELLED sonrası CMS beyanı kapalı (G1 kullanıcı kararı, spec ile uyumlu); `REVOKED_CREATIVE` yalnız uyarı (G2 kararı); `planChangedAt` endAt uzatma/unlink'te ilerliyor (belgelenmiş bilinçli davranış); `SummaryStep` sonsuz istek riski (E2E 42 geçti, kanıt yok); `DeclarationWarning` ↔ `screensLacking` farkı (bilgi amaçlı); migration `UPDATE`'in kanıt eskitmesi güvenli yönde (fail-closed; yalnız P5 rahatlatma); ek kaynak/gürültü maddeleri.

**Tur 2 düzeltme kaydı (2026-11-11):** Kullanıcı kararı G4 = (b): kilit korunur, mükerrer yanıtı `details.status` ile ayrışır ve REVOKED için ayrı TR/EN mesaj gösterilir (`booking.error.duplicateRevoked`); aynı dosya yeniden yüklenemez. P1–P12, P14 uygulandı; tümü kodda ve testlerde:
- P1 TR'de yalnız tek virgül ondalık sayılır; EN'de `1,500` ham gider ve istemci doğrulamasında reddedilir (E2E eklendi).
- P2 çöken ffprobe (SIGSEGV/SIGABRT/SIGBUS/SIGILL/SIGFPE) ve maxBuffer taşması `UNREADABLE_MEDIA` REJECTED olur. **Sapma:** zaman aşımı (SIGTERM) ve spawn/kaynak hataları bilinçli olarak 503 kalır; geçerli büyük dosyayı reddetmemek için.
- P3 revoke COMPLETED/CANCELLED kampanyalara dokunmaz (planChangedAt ve audit yok). P4 CAMPAIGNS.md eşitlendi.
- P5 migration geri doldurması `LEAST(updatedAt, ilk CMS_UPLOADED recordedAt)` oldu; migration henüz dağıtılmadığı için yerinde düzeltildi (test DB'leri yeniden oluşturulmadı; yalnız mevcut satırları etkiler).
- P6 MP4 markası kara listeyle (`qt`, `3g*`) reddedilir, diğer ISO markaları kabul. P7 kreatif sayfası kesilme uyarısı. P8 eşzamanlı yüklemede P2002 → `DUPLICATE_CREATIVE`/yeni sürüm çakışması. P9 yükleme `timeout` 12 dk + 2xx ama okunamayan yanıtta `UPLOAD_UNCONFIRMED` mesajı. P11 arayüz son-işlem `NOTE`'u dışlar. P12 S3 `put` kalıcı 4xx'te yeniden denemez. P14 CMS hataları `details.reason` kodu taşır, istemci kodu okur (regex yedek).
- **Reddedilen/yapılmayan:** P10 (unlink sonrası `campaign.updatedAt` değiştiği için doğrulama zaten yenileniyor, `CampaignDetail.tsx:46`); P13 (DTO `overdeliveryTolerancePct: null`'u 400 ile reddediyor; test eklendi). Defer D8–D13 açık.
- Doğrulama (bu oturumda çalıştırıldı): typecheck, lint, build 8/8; 136 API birim; 89 integration (88 + 1 yeni); 43 E2E (42 + 1 yeni). Çalıştırılamayan: gerçek S3, Compose storage profili, ~200 MB yükleme, migration yükseltme testi.

### Code Review Findings — Tur 3 (2026-11-11) → Düzeltildi, CR-4 bekleniyor

Aralık `8f007c9..4ac94d4` (CR-2 düzeltmeleri). Katmanlar: Blind Hunter, Edge Case Hunter, Acceptance Auditor (üçü de tamamlandı). 0 intent_gap, 0 bad_spec, 5 patch, 4 defer, 7 reject. Kod okuma ile doğrulandı; testler bu turda çalıştırılmadı.

**Patch**
- **P1 (orta) — CR-2 P8 ölü kod.** `creatives.service.ts` ~L164–171: `inventoryTransaction` (`common/inventory-validation.ts:41-52`) P2002/P2004/P2034'ü `conflict('Inventory conflict…')` (409 `INVALID_STATE_TRANSITION`) olarak sarar; dıştaki `PrismaClientKnownRequestError` dalı hiç çalışmaz. Eşzamanlı aynı-dosya yüklemesinin kaybeden tarafı yine genel 409 alır. Düzeltme: `tx.creative.create` çevresinde P2002'yi işlemin içinde sentinel hataya çevir, işlem bittikten sonra `this.db` ile mevcut kaydı yeniden sorgulayıp `DUPLICATE_CREATIVE` (REVOKED ise REVOKED mesajı, `details.status` ile) veya "newer version" fırlat. Eşzamanlı yükleme için entegrasyon testi ekle.
- **P2 (düşük-orta) — Yanıt kaybı UPLOAD_UNCONFIRMED sayılmıyor.** `apps/web/src/lib/upload.ts`: gövde tamamen gönderildikten (`upload.onload`) sonra `ontimeout`/`onerror` veya kodsuz 5xx gelirse `UPLOAD_UNCONFIRMED` dönmeli; şu an `SERVICE_UNAVAILABLE` (kör yeniden deneme → şaşırtıcı mükerrer hatası). 12 dk toplam zaman aşımı yavaş hatta 200 MB'ı keser; gönderim bitmeden zaman aşımı yerine ilerleme/boşta temelli sınır düşün.
- **P3 (düşük-orta) — S3 geçici 400/409 kalıcı sayılıyor.** `object-storage.ts` ~L76–79: `RequestTimeout`, `RequestTimeTooSkewed`, `OperationAborted` hata adları yeniden denenmeli (408/429'a ek).
- **P4 (düşük) — Test boşlukları.** Eklenecek: P8 eşzamanlı yükleme, P12 (kalıcı 4xx yeniden denenmez / geçici denenir), revoke'un LIVE/PAUSED kampanyalara yine uygulandığı, gelecek `performedAt` testinde `details.reason` doğrulaması, web eşlemeleri (`duplicateRevoked`, `uploadUnconfirmed`, reason kodları) ve P9 `UPLOAD_UNCONFIRMED`. P7 yalnız arayüz uyarısı; E2E ile örtülmedi, düşük öncelik.
- **P5 (düşük) — Belge notu.** `docs/CAMPAIGNS.md`: "Hata yanıtları `details.reason` kodu taşır" yalnız CMS kaydı hataları için doğru; ifadeyi daralt.

**Defer**
- D14 Migration geri doldurması `LEAST(updatedAt, ilk CMS_UPLOADED)` plan değişikliğinden önceki eski kanıtı taze sayabilir. CR-2 P5 bilinçli ödünleşimi; migration dağıtılmadı, yalnız mevcut dev/test satırlarını etkiler.
- D15 ffprobe çökme sinyallerini (SIGSEGV/SIGABRT) dosya özelliği saymak, bozuk kurulumda her yüklemeyi `UNREADABLE_MEDIA` yapıp operasyon arızasını gizleyebilir; izleme/log eklenmeli.
- D16 `useLocale().startsWith('tr')` yeni virgül-ondalıklı yerel ayarlarda (de, fr…) yanlış davranır; yeni dil eklenirken ele alınmalı.
- D17 P11: `screenRows` (geçirilen `screens`) ile `screensLacking` (`row.screens`) aktif-ekran filtresi tam hizalı değil; kozmetik.

**Reddedilen (7):** `booking.listTruncated`/`orgsTruncated` eksik (doğrulandı, mevcut); `isMp4Brand` kara liste güvenlik gerilemesi (CR-2 P6 kararı; `mp4` format_name + h264 + süre kapıları kalıyor); TR `1.500,50` reddi (istemci doğrulaması açık hata verir, sessiz değil); `maxPlayoutsPerHourPerScreen` NaN (yalnız bilgilendirici); 409 kodsuz → genel çakışma mesajı (yalnız eski API); REVOKED dosyanın kalıcı kilidi (G4 (b) kullanıcı kararı); backfill trigger spekülasyonu.

**Tur 3 düzeltme kaydı (2026-11-12):** P1–P5 uygulandı.
- P1 `tx.creative.create` P2002'yi işlem içinde `UploadRace` sentinel'ine çevirir; işlem bittikten sonra `this.db` ile mevcut kayıt yeniden sorgulanır → `DUPLICATE_CREATIVE` (REVOKED ise REVOKED mesajı + `details.status`), `replacesId` varsa "newer version", aksi halde genel çakışma. Eşzamanlı yükleme entegrasyon testi eklendi (201 + 409 DUPLICATE_CREATIVE).
- P2 `upload.ts`: gövde tamamen gittikten sonra `onerror`/`ontimeout`/kodsuz 5xx → `UPLOAD_UNCONFIRMED`. **Sapma:** 12 dk toplam `request.timeout` kaldırıldı; yalnız gövde gittikten sonra yanıt beklemesi 12 dk ile sınırlı (yavaş hatlarda büyük yükleme kesilmez).
- P3 S3 `put`: `RequestTimeout`, `RequestTimeTooSkewed`, `OperationAborted`, `SlowDown` adları 4xx olsa da yeniden denenir; kalıcı 4xx (403 AccessDenied vb.) tek denemede biter. Birim test eklendi.
- P4 testler: P8 yarışı, P12 S3 4xx, (revoke LIVE zaten mevcut testte kapsanıyor, yeniden eklenmedi). **Yapılmadı:** web eşleme birim testleri (web'de birim test altyapısı yok; E2E ile kısmen örtülü), P9/P7 için ayrı test. P5 `CAMPAIGNS.md` `details.reason` ifadesi CMS hatalarına daraltıldı.
- Doğrulama (bu oturumda çalıştırıldı): typecheck, lint, build 8/8; 137 API birim; 90 entegrasyon; 43 E2E. Çalıştırılamayan: gerçek S3, Compose storage profili, ~200 MB yükleme, migration yükseltme testi.

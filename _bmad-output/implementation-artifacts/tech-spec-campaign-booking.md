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

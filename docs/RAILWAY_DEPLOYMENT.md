# Railway pilot yayınları

## 12 Kasım 2026 — kampanya sertleştirme + ekran kartları/duvarı (`main` `c443303`)

Kullanıcı "hepsini commitle canlıya al" dedi. `story/campaign-hardening` (`5c1bfd5`) ve
`story/inventory-screens-cards` (`7f73907`) `main`'e birleştirildi (`c443303`); bu iki dal için ayrı
BMAD CR turu yapılmadı. Yayın öncesi `main` üzerinde: typecheck, lint, build 8/8; birim 142 API + 24 web;
entegrasyon 97 — hepsi geçti. **Çalıştırılmadı:** Playwright E2E, admin girişli canlı smoke.
Migration yok, veritabanına dokunulmadı, yedek alınmadı.
API `495d5e05-e88b-4d2d-81e4-58b132b8525d` (`SUCCESS`, 3D filo oturumu aynı commit'ten yükledi), web
`d55b3b28-ab35-4bd4-ab1d-6f82a0365548` (`SUCCESS`, temiz `git archive` klasöründen `railway up --service web`).
Kimliksiz kontroller: `/api/v1/health` 200, `/login` 200, `/admin` 307, kampanya/kreatif/filo uçları 401.
Geri dönüş: önceki API `d6313a45-896f-42d1-90c1-9f402411d8ba`, web `355797ca-adc6-4957-9ec7-23de64a74310`.

## 12 Kasım 2026 — Filo / 3D Adalar sahnesi (yalnız web)

Kaynak commit `eb44ba4` (`story/fleet-adalar`). Temiz `git archive` klasöründen `railway up --service web`;
API, migration ve veriye dokunulmadı. Web `355797ca-adc6-4957-9ec7-23de64a74310` (`SUCCESS`). Kimliksiz kontroller:
`/api/v1/health` 200, `/api/v1/fleet/scene` 401, `/admin/fleet` 307. Admin girişli canlı bakış yapılmadı.
Geri dönüş: önceki web `224cfe9c-b76d-4373-886f-d24efc38d965`.

## 12 Kasım 2026 — Filo / 3D yayını

Kullanıcı "şu anki hali canlıya al" dedi. Kaynak commit `dc3b32f` (`story/fleet-3d`;
**CR yapılmadı, `main`'e merge edilmedi**). Temiz `git archive` klasöründen `railway up`
(`protarget`/`production`; yalnız `api` ve `web`). Migration yok, veritabanına dokunulmadı,
yedek alınmadı. API `d6313a45-896f-42d1-90c1-9f402411d8ba`, web `224cfe9c-b76d-4373-886f-d24efc38d965`
(`SUCCESS`). Kimliksiz dış kontroller: `/api/v1/health` 200, `/api/v1/fleet/scene` 401, `/admin/fleet` girişe yönlenir.
**Yapılmadı:** admin girişli canlı smoke, Playwright, entegrasyon testi, `docs/openapi.json` yenileme.
Geri dönüş: önceki API `41737c24-c9d1-4b3d-8a71-49ad995a57f7`, web `cae37cd7-b4b7-4b62-8536-7938c52b8a39`.

## 12 Kasım 2026 — kampanya/booking yayını

**Durum: canlı; yayın sonrası kontroller kısmen yapıldı (aşağıya bakın).**
Kullanıcı canlıya almayı ve yedek/yayın izinlerini açıkça verdi. Kaynak commit
`c2ca020` (`story/campaign-booking`, `main` ile aynı); aynı `protarget`
projesi/`production` ortamı. Git remote yok: temiz `git archive` klasöründen
`railway up` ile yüklendi (`.railwayignore` geçerli; 7 production secret
değeriyle tarama, eşleşme 0). Repo klasörünün Railway bağlantısı başka bir
projeye işaret ettiği için yayın, yalnız `protarget` projesine bağlı ayrı bir
geçici klasörden yapıldı; başka projeye dokunulmadı.

| Adım | Sonuç |
|---|---|
| Yedek | 101.411 bayt PostgreSQL custom archive (30 tablo verisi); Postgres container'ında `pg_restore --list` ile doğrulandı; restore tatbikatı yapılmadı. Dosya gitignored `.local/backups/protarget-20261112-pre-campaign-c2ca020.dump` (0600) |
| Depolama | Yeni Railway bucket `protarget-creatives` (AMS, S3 uyumlu). API'ye `STORAGE_DRIVER=s3` ve `S3_*` değişkenleri eklendi (sırlar günlüklere/belgeye yazılmadı). Geçici kimlikle put/get/delete turu başarılı |
| Migration | `56961ff5-f791-40f1-8d3e-cd6b91a6ce36` — `schema`, `runtime-role`, `runtime-grants`, `administrator`, `status`, `all` tamam; `_prisma_migrations`: 8 uygulandı, 0 başarısız (son: `20261111000100_campaign_booking_review`) |
| API | `41737c24-c9d1-4b3d-8a71-49ad995a57f7` — `SUCCESS`, `api listening port=4100`, günlüklerde hata 0 |
| Web | `cae37cd7-b4b7-4b62-8536-7938c52b8a39` — `SUCCESS`; `/api/v1/health` 200 |

Dış HTTPS kontrolleri (kimliksiz): kampanya/kreatif/ekran uçları 401, yanlış
Origin ile `POST /api/v1/creatives` 403, `/login` 200, `/admin` 307 (girişe).

### Admin girişli canlı smoke (12 Kasım 2026, aynı gün)

Kullanıcı kendi oturumunu yerleşik tarayıcı panelinde açtı (parola girişi
otomasyonla yapılmadı; giriş dosyası okunmadı) ve test verisi oluşturulmasına
açıkça izin verdi. Üretimde gerçek HTTPS üzerinden denenenler:

- Kampanya sihirbazı: temel adım, ekran ekleme (çarpan 1.0000, çalışma saati
  08:00–22:00, loop 60 sn/slot 10 sn), hedef, kreatif bağlama, 7 günlük plan,
  özet; engel varken "Hazır yap" engelli, engel 0 iken DRAFT→READY.
- Kreatif (yalnız PNG): 1920×1080 yükleme, ffprobe ölçümü, sha256; dosya
  `GET /creatives/:id/file` ile S3 bucket'tan geri okundu (2.081.907 bayt,
  `image/png`, sha256 yüklenenle aynı); admin onayı; aynı içerik farklı adla
  yüklenince mükerrer reddi; geri çekilmiş içeriğin yeniden yüklenmesine REVOKED'a
  özel ret mesajı.
- CMS işlem kaydı: gelecekteki ve booking öncesi zaman reddedildi; geçerli
  `CMS_UPLOADED` beyanı kaydedildi. Beyan yokken LIVE engelliydi, beyandan sonra
  READY→LIVE→PAUSED (gerekçeyle)→CANCELLED çalıştı.
- PAUSED booking'de bağlı kreatif geri çekilince "bağlı kreatiflerden biri geri
  çekildi" uyarısı çıktı ve önceki CMS beyanı eskidi (yeniden beyan istendi).

Test verisi üretimde kalıcıdır: `CMP-2026-0001`/`0002` (iptal), `CR-2026-00001`/
`00002` (geri çekildi), "SMOKE TEST Reklamveren", "SMOKE TEST Gemi" ve
`SMOKE-TEST-01` ekranı (hepsi pasif), ekran için onaylı 1.0000 çarpan sürümü.
Denetim kaydı silinmez. Eski `DEPLOY-…` kaydına dokunulmadı.

### MP4 ve büyük dosya yükleme (12 Kasım 2026, akşam)

Aynı test reklamverenine (yükleme için geçici aktif edildi, sonra tekrar pasif):

- `CR-2026-00003`: 1280×720, 5 sn, h264 MP4 (1.742.923 bayt) yüklendi, sunucunun
  ölçtüğü sha256/boyut/süre/codec yerel dosyayla aynıydı.
- `CR-2026-00004`: 1920×1080, 40 sn, h264 MP4, **188.969.376 bayt (~189 MB)**.
  Tarayıcıdan yükleme ~112 sn sürdü (ilerleme çubuğu çalıştı), sunucu ölçümü
  yerelle aynı. `GET /creatives/:id/file` ile S3'ten geri okuma ~31 sn, bayt sayısı
  ve sha256 yüklenenle aynı.
- 215 MB'lık dosya "Dosya 200 MB sınırını aşıyor." ile reddedildi; ağ kaydında
  istek gitmedi, yani **istemci tarafı** ret görüldü. Sunucu tarafı için 215 MB'lık
  çok parçalı istek doğrudan `POST /api/v1/creatives`'e gönderildi: anında `413
  PAYLOAD_TOO_LARGE`, kreatif kaydı oluşmadı.
- İki kayıt da `REJECTED` yapıldı (gerekçeyle); onaylanmadı, bir kampanyaya bağlanmadı.
  Test dosyaları yerelde silindi.

### Restore tatbikatı ve tarayıcı kontrolü (12 Kasım 2026, akşam)

- **Restore:** `protarget-20261112-pre-campaign-c2ca020.dump` (101.411 bayt), Postgres
  konteynerine stdin ile aktarıldı (sha256 aynı), konteynerdeki `pg_restore` 18.6 ile
  **ayrı bir `restore_drill` veritabanına** `--exit-on-error` ile hatasız yüklendi
  (31 tablo; 6 migration, 1 kurum, 1 kullanıcı, 1 mekân, 1 ekran, 32 denetim satırı =
  yedek anı). Canlı `railway` veritabanına yazılmadı; sonra `restore_drill` silindi,
  dump konteynerden kaldırıldı, sağlık 200.
- **Tarayıcı:** canlıda `/admin`, `/admin/campaigns`, `/admin/creatives`, `/admin/fleet`
  375×812'de sayfa genelinde yatay taşma yok (nav yatay kaydırılır); EN'de çeviri
  eksiği görülmedi. Küçük kusurlar: `/admin/fleet` mobilde Eminönü/Kabataş etiketleri
  üst üste biniyor, EN'deki "Drag to rotate, scroll to zoom" dokunmatik için uygun değil.
- **Migration yükseltme provası:** 11 Kasım'da yerelde yapılmıştı (6→7 migration, veri
  sayıları aynı kaldı); sonradan eklenen `campaign_booking_review` veri üstünde ayrıca
  denenmedi, canlıda uygulandı.

**Yapılmayanlar (başarılı sayılmaz):** gerçek ağ takılması testi. D8–D23 defer'ları
spec'te (`tech-spec-campaign-booking.md`) açık backlog olarak duruyor.

Geri dönüş: önceki API `99952375-2d85-4e7f-ab89-43d44922c425`, web
`de68631c-99f2-47c8-8414-e5b9e01f6133` (Railway'de hedeflenerek;
`railway deployment redeploy` varsayılan olarak en son sürümü seçer).
Uygulama geri dönüşü migration'ları veya sonradan girilen veriyi geri almaz.

## 11 Kasım 2026 — manuel envanter yayını

**Durum: canlı pilot yayını ve yayın sonrası kontroller başarılı.**
Kullanıcı açıkça canlıya alma talimatı verdi. Kaynak commit `247aa02`;
aynı `protarget` projesi/`production` ortamı kullanıldı, başka projeye
dokunulmadı. Git remote push yapılmadı; temiz commit arşivi yüklendi.

Public web: `https://web-production-570f712c.up.railway.app`.
Gemi/ekran, CMS/OS metadata ve onaylı manuel çarpan geçmişi artık canlıdır;
kampanya/booking/teslimat ve gerçek CMS/player bağlantısı hâlâ kapsam dışıdır.

### Sıralı yayın ve kanıt

| Adım | Sonuç |
|---|---|
| Release | `247aa02146612250a2213e1e501cb1ccc9f71040`; 202 tracked dosya, 12 özel değerle tarama, eşleşme 0 |
| Yayın öncesi DB | PostgreSQL 18.6; 3 migration, başarısız migration 0, kanonik mükerrer ekran kodu 0 |
| Yedek | 85.638 bayt PostgreSQL custom archive; `pg_restore --list` başarılı; restore tatbikatı yapılmadı |
| Migration | `73d724b9-7f9d-4177-a07b-81dfa8b35526` — bütün aşamalar tamamlandı |
| API | `99952375-2d85-4e7f-ab89-43d44922c425` — `SUCCESS`, özel health 200 |
| Web | `de68631c-99f2-47c8-8414-e5b9e01f6133` — `SUCCESS`, HTTPS health 200 |
| Postgres | Mevcut `94042150-4b58-4c88-887b-b2389a86c37a` korundu; yeniden oluşturulmadı |

Altı migration'ın checksum'ı kaynakla birebir eşleşti; iki timing trigger'ı
ve kanonik kod index'i doğrulandı. Eski inventory tabloları boştu; veri
silinmedi. API `protarget_app` rolüyle çalışıyor; audit değişikliği ve migration
metadata erişimi yok. Aktif admin 1, demo hesap 0. Bootstrap değişkenleri
kapalı kaldı; mevcut admin parolası/secret'lar değiştirilmedi.
API/web özel/public ağ ayrımı ve healthcheck ayarları korundu.

Gerçek HTTPS/Chromium kontrolleri:

- Admin login, Secure/HttpOnly/Strict cookies; anonim envanter 401,
  yanlış Origin 403; logout sonrası 401.
- Gemi/ekran formuyla oluşturma, düzenleme, yeniden açma; bilinmeyen
  donanım alanları `null`, bağlantı “bağlı değil”.
- Manuel taslak, ayrı onay, açık öncülü seçerek ileri tarihli sürümle
  değiştirme; UTC tarihleri ve eski değer/kaynak korunması.
- TR/EN, desktop ve 375 px mobil; yatay sayfa taşması/browser hatası yok.
- Audit sayfası çalışıyor; SMTP daveti kapalı kalıyor.
- Yalnız yayına ait bir smoke gemisi/ekranı pasifleştirildi; iki onaylı
  sürümün geçmişi ve audit saklandı. Mevcut müşteri verisine test yazılmadı.
- Canlıda sunulan 16 browser asset, 7 gerçek production secret değeriyle
  tarandı; eşleşme 0. Container içindeki asset kontrolü de geçti.

İlk smoke dil düğmesinin erişilebilir adını kullanmayan test seçicisinde
durdu; ilk devam denemesi login'in 200 yerine 201 dönmesini bekledi.
Yalnız özel test harness'i düzeltildi. Son salt-okunur devam aynı pasif
fixture'larla geçti; uygulama düzeltmesi veya yeniden veri oluşturma
gerekmedi. Başarısız denemeler başarılı suite olarak sayılmadı.

Kanıt: `docs/verification/2026-11-11-railway-inventory/`.
Yayın öncesi yedek kullanıcı makinesindeki gitignored
`.local/backups/protarget-20261111-pre-inventory-247aa02.dump`
dosyasındadır (dizin 0700, dosya 0600); Git'e veya build context'e eklenmedi.
Bu manuel yedek otomatik yedek/restore politikasının yerine geçmez.

### Geri dönüş ve açık kabul işleri

Önceki API deployment'ı `350cad58-6562-480b-a78c-fc07c442e8d9`,
web deployment'ı `a219b2c3-2a01-4c06-ba92-76d0f89f2e83`.
Gerekirse bu sürümler Railway'de hedeflenerek geri alınmalıdır;
`railway deployment redeploy` varsayılan olarak **en son** sürümü seçer.
Uygulama geri dönüşü migration'ları/sonradan girilen veriyi geri almaz.
Otomatik down-migration, production DB reset veya yedekten restore yapılmadı.

Kullanıcının yayın onayı Faz 0 kabulünü kapatmaz. Compose runtime,
restore tatbikatı, kalan production hardening ve deferred bulgular açık;
sprint/kabul `review`, teknik implementation `done` kalır.

## 10 Kasım 2026 — Faz 0 pilotu (tarihsel kayıt)

Durum: **canlı pilot doğrulandı** — 10 Kasım 2026. Railway web/API/Postgres
sağlıklı; gerçek HTTPS tarayıcı testi başarılı.
Kullanıcı Railway'e yayımlamayı, geliştirmeye devamı ve verilen logoyu
Protarget yazısının üzerine şeffaf arka planla eklemeyi istedi.

## Kapsam ve kabul

- Mevcut Faz 0 paneli; kampanya, ekran, booking, teslimat veya gerçek DSP
  entegrasyonu tamamlanmış gibi gösterilmez.
- Ayrı `protarget` Railway projesi; diğer projelere dokunulmaz.
- Web HTTPS üzerinden erişilir, API yalnız özel ağdadır.
- Migration sahibi kimliği yalnız ayrı, tek seferlik `migration` servisindedir.
  API yalnız `protarget_app` rolüyle çalışır; web DB parolası/JWT secret almaz.
- Yeni DB'ye migration + kısıtlı rol izinleri uygulanır; yalnız bir rastgele
  parolalı admin oluşturulur. Yerel demo kullanıcıları/verileri kopyalanmaz.
- Kullanıcı daveti SMTP sağlanıncaya kadar API'de yazma öncesinde kapatılır;
  UI kapalı olduğunu açıkça gösterir, mevcut kullanıcı düzenleme çalışır.
- Railway'in doğrudan ingress olarak sağladığı `X-Real-IP`, web tarafından
  kısa ömürlü, yol/metot bağlı HMAC ile özel API'ye aktarılır. API imzasız
  kimliği reddeder. `X-Forwarded-For` veya istemcinin imza başlıkları kopyalanmaz.
  Ek CDN önüne koyulmadan önce güven sınırı yeniden değerlendirilmelidir.
- API auth IP kotası, bir müşterinin bütün paneli kilitlememesini sağlamalı;
  hesap bazlı kota korunmalı. Birim ve gerçek DB testleri bunu doğrular.
- HTTPS login, secure/HttpOnly cookies, admin sayfaları, logout, public
  health, yeni şeffaf logo, mobil taşma ve yetkisiz erişim canlı smoke testinde.
- Secret'lar frontend bundle, Git, build context veya loglarda bulunmaz.
- Yerel build/typecheck/lint/unit/DB/browser testleri ve üç bağımsız reviewer.
- Yayın gerçekleşirse domain, deployment kimlikleri, gerçek smoke sonuçları
  bu dosyaya kaydedilir. Başarısız veya çalıştırılmamış test başarılı sayılmaz.

## Servisler ve ayarlar

`infra/railway/service-settings.json`, istenen ayarların secretsiz kaydıdır.
CLI `environment edit --service-config` bu ortamda `No changes to apply`
döndürüp ayarları kaydetmedi. Bunun yerine resmi `serviceInstanceUpdate`
GraphQL mutation'ı ile alan adlarının `build.`/`deploy.` önekleri çıkarılarak
uygulandı; `builder` alanı gönderilmedi (API enum'u DOCKERFILE kabul etmiyor).
`dockerfilePath` ve `RAILWAY_DOCKERFILE_PATH` Docker build'i seçer.
Uygulanan ayarlar `railway status --json` ve gerçek deployment manifest'inden
doğrulanmalıdır. Eski `railway.toml` / `railway.json` yöntemine bağımlı değildir.

| Servis | Çalışma | Public domain | Secret kapsamı |
|---|---|---|---|
| Postgres | Kalıcı DB/volume | Gerekli değil | DB owner |
| migration | `node infra/railway/migrate.cjs`; restart NEVER | Yok | Owner URL, app DB parolası, tek seferlik admin |
| api | `infra/Dockerfile.api`; port 4100; host `::` | Yok | Runtime DB URL, JWT secret, proxy secret |
| web | `infra/Dockerfile.web`; port 3100; host `::` | HTTPS | Proxy secret; API private origin |

Her yayında sıralama: migration başarıyla tamamlanır → API health →
web health → dış HTTPS/browser kontrolü. Migration başarısızken uygulama
yayınını ilerletme. Şema değişiklikleri geriye uyumlu olmalıdır; uygulama
rollback'i veri tabanını otomatik geri almaz.

İlk kurulumda build'leri paralel başlatmak API'nin DB rolünden önce açılmasına,
web'in de hazır olmayan API için health timeout'a düşmesine yol açtı.
Migration tamamlandıktan sonra mevcut API sürümü yeniden dağıtıldı; ardından
web yeniden dağıtımı başlatıldı. Sonraki yayınlarda sadece build değil,
servis başlatma sırası da yukarıdaki bağımlılığa göre korunmalıdır.

`BOOTSTRAP_ADMIN_EMAIL` ve `BOOTSTRAP_ADMIN_PASSWORD` yalnız ilk kurulumda
migration servisine verilir, başarılı giriş kontrolü ardından silinir.
İdempotent bootstrap mevcut kullanıcının parolasını veya yetkilerini ezmez.
Uygulama ve proxy sırları, demo parolasından bağımsız rastgele üretilir.

## Bilinen sınırlar

Yerel Compose Docker socket erişimi olmadığı için hâlâ doğrulanmamıştır.
Railway'in PostgreSQL template'i şu an sürüm 18 sağladı; yerel test DB'si 14.
Cloud PostgreSQL 18.6 üzerinde migrations, rol izinleri ve bootstrap doğrulandı;
dış HTTPS/browser sonuçları aşağıdaki yayın kanıtında kaydedilir.
Canlı yayın, günlük yedek + restore tatbikatı, alarm/SLA, MFA, tam bağımlılık
denetimi veya kalan CR bulgularının kapatıldığı anlamına gelmez.
Bu aşama kontrollü Faz 0 pilotudur; gerçek müşteri kampanyası işletmeye hazır değildir.

## Görsel

Kullanıcı dosyası `logo.png` türevi: `apps/web/public/brand/protarget-mark.png`.
Off-white arka plan alfa kanalına çevrilmiştir. Orijinal dosya değiştirilmedi.
`Brand` bileşeni login ve admin/tenant/support kabuklarında yazının üzerinde
gösterir; koyu sidebar üzerinde aynı şeklin açık renk karşılığı kullanılır.

## Yayın kanıtı

Kaynak commit: `096bc8e`. Secret taraması geçen 154 tracked dosya ayrı release
klasöründen yüklendi; `.env`, `_vault`, Git geçmişi, test çıktıları veya yerel
veritabanı yüklenmedi.

- Project: `f03dbfdd-f270-4159-8d21-28a0dc288a49` (`protarget`).
- Environment: `c2344e59-93dc-4b3f-bee0-19541f78cc79` (`production`).
- Public web: `https://web-production-570f712c.up.railway.app`.
- Postgres deployment: `94042150-4b58-4c88-887b-b2389a86c37a`.
- Migration deployment: `b0dce91d-6a59-46df-90e6-06e44247c934`.
  `schema`, `runtime-role`, `runtime-grants`, `administrator`, `status`, `all`
  adımlarının tamamı başarılı. Container içindeki değişmemiş SQL çalıştı.
- API deployment: `350cad58-6562-480b-a78c-fc07c442e8d9`.
  Runtime check: `protarget_app` kısıtlı; audit UPDATE/DELETE/TRUNCATE,
  migration metadata okuma, schema CREATE, rol üyeliği, superuser,
  replication ve RLS bypass yok. Aktif admin **1**, demo hesap **0**.
- Web deployment: `a219b2c3-2a01-4c06-ba92-76d0f89f2e83` — `SUCCESS`.

Canlı HTTPS/Chromium kontrolleri başarılı:

- DB health **200**, anonim kullanıcı erişimi **401**, yanlış Origin **403**.
- Gerçek admin login; Secure/HttpOnly/SameSite=Strict oturum çerezleri.
- Kullanıcı ve audit sayfaları; SMTP davetinin kapalı olduğunun görünmesi.
- Şeffaf logo, Protarget yazısının üzerinde; masaüstü ve 375 px mobil görünüm.
- Mobil yatay sayfa taşması ve browser pageerror yok.
- Çıkış sonrası `/api/v1/me` yeniden **401**.
- İki sahte ingress IP ile gönderilen denemelerden sonra özel DB kontrolünde
  bu IP'lere ait rate-limit bucket sayısı **0**; istemci başlıkları kabul edilmedi.

Kanıtlar test makinesinde `/tmp/protarget-railway/` altında:
`smoke-result.json`, `cloud-check-result.json`, `live-desktop.png`,
`live-mobile.png`. Üç odaklı CR-3 reviewer'ı yeni bulgu bildirmedi.
Bootstrap e-posta/parola değişkenleri başarılı girişten sonra migration
servisinden kaldırıldı; kalan değişkenler korundu, yeniden dağıtım tetiklenmedi.
Yönetici e-posta adresi `admin@protarget.local`; parola Git'e veya bu belgeye
yazılmaz. Kullanıcının proje klasöründeki gitignored
`.local/railway-login.txt` dosyasına yalnız kullanıcı okuyabilir şekilde teslim edilir.

Başarısız denemeler (başarılı kabul edilmez):

1. `958141f3-34e1-4950-b707-9492519b66ec`: eski migration ayarları
   kaydedilmediği için yanlış başlangıç komutu çalıştı; GraphQL ile düzeltildi.
2. `89203c52-2c8f-472d-9150-5860ce624dfa`: API DB provisioning'den önce
   başladı ve yeniden başlatma denemeleri tükendi.
3. `bc3d1758-e8c5-4cf2-b8df-5fb3869c3f5e`: web, API hazır değilken
   health timeout aldı. Sıralı yeniden dağıtımlarla düzeltildi.

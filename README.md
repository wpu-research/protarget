# Protarget — operasyon ve müşteri takip paneli

**Mevcut durum:** Faz 0 kimlik/kurum/kullanıcı temeline gemi/ekran envanteri
ve sürümlü manuel çarpan yönetimi eklendi. Envanter yalnız yöneticilere açıktır.
Envanter **11 Kasım 2026'da Railway pilotuna yayımlandı**; canlı
gemi/ekran, çarpan ve TR/EN/mobil kontrolleri geçti. Yayın kanıtı:
`docs/RAILWAY_DEPLOYMENT.md`. Faz 0'ın Compose kabulü ve ertelenen işleri
açık kalır; tam üretim kabulü sayılmaz.

**Filo / 3D (yerel, `story/fleet-3d`):** admin için Boğaz simülasyonunda gemi/ekran görünümü; konum simülasyondur, durumlar operatör beyanıdır. Bkz. `docs/FLEET.md`.

**Kampanya/booking (yerel, `story/campaign-booking`, yayımlanmadı):** yalnız
admin için booking sihirbazı, kreatif yükleme (MP4/H.264, PNG, JPEG; ffprobe +
sha256 + ayrı onay), ekran/tarih/hedef/ticari plan, sade durum makinesi ve
salt eklenen CMS işlem kaydı. Durumlar ve CMS kayıtları operatör beyanıdır,
oynatma kanıtı değildir. Ayrıntılar: `docs/CAMPAIGNS.md`.

## Ürün kapsamı

Güncel kararlar: `docs/MVP_DECISIONS.md`.

MVP, mevcut CMS'ye operatörün manuel yükleme yapacağı kampanya/booking
operasyonunu hedefler. Gerçek DSP/SSP, otomatik CMS bağlantısı ve kendi
player'ımız ilk sürüm şartı değildir. Bunlar **bu Faz 0 teslimatında uygulanmadı**.
Teslimat ve rapor menüleri açıkça “Planlandı” durumundadır; sahte
teslimat veya kampanya istatistiği gösterilmez. Gemi/ekran ve çarpan
ekranları kullanılabilir; ayrıntılar `docs/INVENTORY.md` içindedir.

## Gereken ortam

- Node **24.22.2** (`.nvmrc`), pnpm **10.32.1**.
- PostgreSQL 16 hedefi; yerel entegrasyon testleri izole PostgreSQL 14 ile geçti.
- Docker Engine/Compose erişimi (tam konteyner akışı için).
- Ortam değişkenlerini açıkça sağlayın. API, depo `.env` dosyasını kendiliğinden
  okumaz; `pnpm local ...` yardımcı başlatıcısı okur.

```bash
pnpm install --frozen-lockfile
pnpm setup:env
docker compose up --build -d --wait
docker compose --profile seed run --rm seed
```

`setup:env` kriptografik rastgele parolalar/anahtarlar üretir, `.env` dosyasını
0600 izinleriyle yazar, değerleri terminale basmaz ve mevcut dosyayı **ezmez**.
Mevcut `.env` varsa `.env.example` ile gereken anahtarları karşılaştırın; gerçek
ortam dosyasını veya kimlik bilgilerini Git'e eklemeyin.

Yerel Compose hedefleri:

- Web: `http://localhost:3100`
- API sağlık: `http://localhost:4100/api/v1/health`
- Geliştirme Swagger UI: `http://localhost:4100/api/docs`
- Mailpit: `http://localhost:8125`

Tarayıcı adresi **WEB_ORIGIN ile birebir aynı** olmalı. `localhost` ve
`127.0.0.1` değiştirilebilir kabul edilmez. `docker-compose.yml` yalnız yerel
geliştirme içindir; API bilerek development modundadır. Üretimde API
`NODE_ENV=production`, HTTPS origin, TLS SMTP ve ayrı gizli değerler gerekir.

Konteyner başlangıcında migrate servisi uygulama ve test veritabanlarına altı
migration uygular. API ancak migrate başarıyla bitince başlar. Runtime DB
rolü `protarget_app`; migration sahibi kimlik bilgileri API/web'e verilmez.
Runtime audit kayıtlarını UPDATE/DELETE/TRUNCATE edemez.

## Örnek hesaplar

Yalnız açıkça seed çalıştırıldığında oluşturulur:

| E-posta | Rol | Parola ortam anahtarı |
|---|---|---|
| admin@example.test | Yönetici | SEED_ADMIN_PASSWORD |
| agency-a@example.test | Ajans A | SEED_TENANT_PASSWORD |
| agency-b@example.test | Ajans B | SEED_TENANT_PASSWORD |
| advertiser@example.test | Reklamveren | SEED_TENANT_PASSWORD |
| support@example.test | Destek | SEED_TENANT_PASSWORD |

Parolalar `.env` içindedir; buraya gömülü ortak parola yoktur. Seed mevcut
parolaları, MFA/aktiflik durumlarını veya isimleri sessizce değiştirmez.
Mailpit yalnız yerel davet inceleme içindir; gerçek alıcılara e-posta göndermez.

## Uygulamaları host üzerinde çalıştırmak

Önce altyapı ve migration/grant adımlarını tamamlayın. Kendi PostgreSQL'inizi
kullanıyorsanız migration sahibi ile `prisma migrate deploy` çalıştırın ve
`infra/runtime-grants.sql` uygulayın; API'ye ayrı runtime bağlantısı verin.
Özel ortamlarda DB/rol oluşturmayı mevcut veriye dokunmadan yönetin.

```bash
pnpm build
pnpm local seed
pnpm local api
# Ayrı terminal:
pnpm local web
```

Host uygulamalar varsayılan `127.0.0.1` adresine bağlanır. Portlar `.env` ile
değiştirilebilir. Next.js üretim sunucusu kendi `NODE_ENV=production` değeriyle,
yerel API ise HTTP geliştirme ortamıyla çalışır.

## Doğrulama

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm local integration
pnpm local e2e
pnpm local openapi
```

- Integration testi **ayrı**, adında `test` geçen `TEST_DATABASE_URL` ister;
  runtime DB ile aynı hedef reddedilir. Test rolü ayrıcalıklı olamaz.
- E2E için API/web ayakta ve seed uygulanmış olmalı. Test, loopback SMTP
  dinleyicisi kurar; `SMTP_HOST=127.0.0.1` ve boş bir SMTP portu gerekir.
  O portu kullanan Mailpit ile aynı anda çalıştırmayın. API'yi E2E SMTP portuna
  yönlendirip yeniden başlatın. Gerçek e-posta sağlayıcısına test gönderilmez.
- Playwright tarayıcısı: `PLAYWRIGHT_SKIP_BROWSER_GC=1 pnpm --filter @protarget/web exec playwright install chromium`.
- Integration testleri kendi fixture'larını pasifleştirir. E2E kurum
  cleanup'ı vardır; davetli test kullanıcısının cleanup'ı henüz eksiktir
  (F0-013). Append-only audit kayıtları silinmez. Parolaları/tokenları
  kaydedebileceği için browser trace kapalıdır.
- Ayrıntılı sonuçlar: `docs/ACCEPTANCE.md`.
- Üçlü incelemenin ertelenen düzeltmeleri:
  `_bmad-output/implementation-artifacts/deferred-work.md`. Yüksek önemli
  proxy rate-limit bulgusu (F0-001) `096bc8e` ile kapatıldı; F0-005/006/009/
  010/012 açık, F0-011 kısmi, R2-03…08 ertelendi. CR temiz değildir.
- `pnpm test` web proxy imza testini de (`infra/railway/proxy-address.test.mjs`)
  çalıştırır; Node 24 gerekir.

## Kapsam dışı / sınırlamalar

- Player/worker/connector/deal şemaları iskeletten korunmuştur; bu teslimat
  bunların iş akışlarını devreye almaz. Kampanya modülü yalnız manuel booking
  akışını uygular (`docs/CAMPAIGNS.md`). Worker/player servislerini çalıştırmayın.
- Envanterde pasifleştirme fiziksel ekranı durdurmaz. CMS/OS metadata'sı
  bağlantı veya oynatma kanıtı değildir. Manuel çarpan ve yönetici onayı,
  doğrulanmış izleyici sayısı ya da proof-of-play anlamına gelmez.
- Support yalnız `/me` ve `/health`; ajans/marka yalnız kendi kurumunu okur.
- Finansal görünürlük tercihleri kaydedilir; kampanya ticari alanları yalnız
  admin API'sinde döner, spend hesaplanmaz ve finansal rapor yoktur.
- MFA sonraki güvenlik fazında; MFA etkin hesaplar mevcut girişten reddedilir.
- İstemci IP'si yalnız Railway ingress'i arkasında güvenilirdir: web geçidi
  `X-Real-IP` değerini `PROXY_SHARED_SECRET` ile imzalar, API imzasız başlığı
  reddeder. `TRUSTED_INGRESS` boşken (yerel) auth IP limiti doğrudan bağlantı
  adresiyle çalışır; başka bir proxy zinciri ayrıca tasarlanmalıdır.
- Eski `pnpm dev` env loader'a henüz bağlı değildir (F0-005); yukarıdaki
  `pnpm local api/web` yolunu kullanın. Davet ekranında dil değişimi tam
  reload nedeniyle bağlantıyı yeniden açmayı gerektirir (F0-004).
- Redis Faz 0 iş akışında kullanılmaz. MinIO/ClamAV opsiyonel profildir.
  MinIO için onaylı, yerelde oluşturulmuş `MINIO_IMAGE` sağlanmadan `storage`
  profilini açmayın. Bu profillerin runtime doğrulaması yapılmadı.
- Tek Compose dosyası kökteki `docker-compose.yml`'dir (eski
  `infra/docker-compose.yml` iskelesi kaldırıldı). Volume silme/reset komutları
  kurulum adımı değildir.
- Image digest sabitleme, bağımlılık güvenlik taraması, TLS, yedekleme ve gerçek
  SMTP teslimatı production release öncesi ayrıca doğrulanmalıdır.

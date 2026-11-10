# Railway pilot yayını — 10 Kasım 2026

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

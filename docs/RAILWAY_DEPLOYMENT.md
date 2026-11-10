# Railway pilot yayını — 10 Kasım 2026

Durum: **hazırlanıyor**, henüz uygulama yayını doğrulanmadı.
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

`infra/railway/service-settings.json`, Railway CLI
`environment edit --service-config SERVICE PATH VALUE` ile uygulanan ayarların
secretsiz kaydıdır. Eski `railway.toml` / `railway.json` yöntemine bağımlı değildir.

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

`BOOTSTRAP_ADMIN_EMAIL` ve `BOOTSTRAP_ADMIN_PASSWORD` yalnız ilk kurulumda
migration servisine verilir, başarılı giriş kontrolü ardından silinir.
İdempotent bootstrap mevcut kullanıcının parolasını veya yetkilerini ezmez.
Uygulama ve proxy sırları, demo parolasından bağımsız rastgele üretilir.

## Bilinen sınırlar

Yerel Compose Docker socket erişimi olmadığı için hâlâ doğrulanmamıştır.
Railway'in PostgreSQL template'i şu an sürüm 18 sağladı; yerel test DB'si 14.
Cloud sürümünde migrations/readiness/login/immutability ayrıca doğrulanmalıdır.
Canlı yayın, günlük yedek + restore tatbikatı, alarm/SLA, MFA, tam bağımlılık
denetimi veya kalan CR bulgularının kapatıldığı anlamına gelmez.
Bu aşama kontrollü Faz 0 pilotudur; gerçek müşteri kampanyası işletmeye hazır değildir.

## Görsel

Kullanıcı dosyası `logo.png` türevi: `apps/web/public/brand/protarget-mark.png`.
Off-white arka plan alfa kanalına çevrilmiştir. Orijinal dosya değiştirilmedi.
`Brand` bileşeni login ve admin/tenant/support kabuklarında yazının üzerinde
gösterir; koyu sidebar üzerinde aynı şeklin açık renk karşılığı kullanılır.

## Yayın kanıtı

Henüz tamamlanmadı.

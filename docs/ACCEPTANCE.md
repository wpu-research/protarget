# Doğrulama kayıtları

## Manuel envanter — 10 Kasım 2026

Branch: `story/inventory-manual-multipliers`; baseline: `dea05dcc`.
Yerel değişikliktir; **Railway'e yayın yapılmadı**. Faz 0'ın Docker kabulü,
SMTP/production hardening ve deferred bulguları açık kalır.

- Node **24.22.2**, mevcut pnpm lockfile; eksik yerel bağımlılıklar
  frozen/offline kurulumla tamamlandı. Sistem Node'u değiştirilmedi.
- PostgreSQL **14**: yeni loopback cluster, ayrı runtime/test DB'leri,
  migration-owner ve kısıtlı uygulama rolü. Mevcut `.env`, canlı DB ve
  Faz 0'ın önceki test cluster'ı değiştirilmedi.
- Backend son doğrulama: **98 unit + 70 gerçek PostgreSQL integration**.
  Faz 0 regresyonları bu toplamların içindedir.
- Tarayıcı: **30/30 Chromium E2E** (11 Faz 0 + 19 envanter), son tur **50,4 sn**.
  TR/EN gemi/ekran CRUD, yalnız değişen alanların PATCH'i, sayfalama/filtre,
  pasif/seçili/yeni geminin korunması, çarpan onayı ve açık öncül seçimi,
  geçerli/son oluşturulan ayrımı, UTC sınırları, roller ve 404 kontrolleri.
- Desktop ve **375 px mobil** görüntüler ayrıca incelendi; taşma yok.
- Altı migration yeni runtime/test DB'lerine uygulandı. Ayrı eski-şema
  DB'lerinde hem normal verinin hem tutarsız eski zamanlamanın yükseltmesi
  doğrulandı; kaynak/değerler korunuyor, yeni hatalı zamanlama reddediliyor.
- Nihai yeniden çalıştırma: build **8/8**, typecheck **8 paket**, lint
  başarılı; **98 unit + 70 integration + 30 E2E = 198 test geçti**.
  OpenAPI yeniden üretildi. Beş özel yerel test değeriyle kaynaklar ve
  16 browser asset tarandı; gizli değer eşleşmesi yok. Kanıtlar:
  `verification/2026-11-10-inventory/`.
- Story doğrulama ve inceleme kaydı:
  `_bmad-output/implementation-artifacts/tech-spec-inventory-manual-multipliers.md`.
- Üçlü bağımsız kod incelemesi tamamlandı; üç turda dokuz orta önem
  dereceli uygulama bulgusu giderildi. Son odaklı incelemede açık bulgu yok.
  Bu sonuç Faz 0'ın ayrı deferred bulgularını kapatmaz.
- Spec'in teknik durumu `done`; kabul/sprint durumu Faz 0 önkoşulları
  nedeniyle `review` olarak korunur.

Eski veri sunumu ve yarış koşullarına yönelik bazı tarayıcı regresyonları
HTTP yanıtlarını kontrollü fixture'larla değiştirir; bunlar gerçek DB upgrade
kanıtı sayılmaz. Ayrıca **gerçek eski şema → altı migration → API → Chromium**
akışı HTTP interception olmadan çalıştırıldı: kilitli/kilitsiz ham kod,
hatalı saatler, metadata/pasifleştirme, bağımsız zamanlama düzeltmeleri ve
açık saat temizleme doğrulandı. Bu ayrı kontrol 198 test sayısına eklenmedi;
sonuçları `verification.json` içindedir.

### Yakalanan ve giderilen durumlar

İlk test denemeleri sistem Node 20, eksik kurulu paketler ve eski üretilmiş
Prisma istemcisi nedeniyle çalışmadı. Pinned ortam/istemciyle tekrarlandı.
Yerel harness'e yanlışlıkla eklenen Railway proxy secret'ı login'i kapattı;
yalnız yeni izole test ayarından çıkarıldı, uygulama güvenliği gevşetilmedi.
Tekrarlı debug login'leri test kotasını tüketti; yalnız bu izole runtime'ın
rate-limit fixture'ları final suite öncesi temizlendi.

Ek migration testi, `NOT VALID` timing CHECK'lerinin eski tutarsız kayıtları
pasifleştirmeyi de engellediğini gösterdi. İkinci migration yalnız yeni
timing kısıtlarını INSERT/değişen alan trigger'larıyla değiştirdi; özgün
constraint'lere dokunmadı. Gerçek eski-şemadan yükseltilmiş fixture üzerinde
metadata/deactivation/çarpan kilidi ve birbirinden bağımsız zamanlama
düzeltmeleri API üzerinden geçti; trigger kapatma veya eski veriyi silme yok.

Kod incelemesindeki dokuz düzeltme:

1. Değişmemiş eski zamanlamanın istemci doğrulamasında gereksiz reddi.
2. Native saat girdilerinin hatalı eski değeri sessizce temizlemesi.
3. Değişmemiş kilitli/kilitsiz eski ekran kodunun doğrulanması/normalize edilmesi.
4. Başarılı PATCH sonrası sunucunun gemi seçiminin formda güncellenmemesi.
5. Onay yenileme/409 sonrasında eski öncül seçeneklerinin kalması.
6. SQL `btrim` ile JavaScript `trim()` kenar boşluklarının farklı olması
   (üçüncü yeni migration ve gerçek PostgreSQL regresyonuyla giderildi).
7. Boşluk dolgulu kodda düzenle → geri al işleminin eski kodu değiştirmesi.
8. Ekran kaydı ile form içinden gemi oluşturmanın yarışması.
9. CR/LF dolgulu eski kodun native text input tarafından temizlenmesi nedeniyle
   düzenle → geri al karşılaştırmasının yanlış olması; ilk DOM değeri
   kaydedilerek ve boşluk/CR-LF tarayıcı regresyonlarıyla giderildi.

Özel test parolaları ve harness `/tmp/protarget-inventory-local/` içinde
0700/0600 izinleriyle tutulur; Git'e eklenmez. Bu dizin kalıcı kurulum değildir.
Yeni arayüz kullanım/kapsam sınırları: `INVENTORY.md`.

## Faz 0 — tarihsel doğrulama kaydı

## Railway / logo düzeltme turu — 10 Kasım 2026

Yerel son sonuç: build **8/8**, typecheck **8 paket**, lint başarılı;
**19 unit + 40 gerçek PostgreSQL integration + 11 Chromium E2E + 2 web proxy
testi = 72 başarılı test**. OpenAPI capabilities endpoint'iyle yeniden üretildi.
Gerçek local/canlı yapılandırmadan 6 secret değeriyle 15 browser asset dosyası
tarandı; eşleşme yok. Bu kontrol bütün log yüzeyleri için sentinel testinin
yerine geçmez. Kaynak görselin alfa kanalı ve logo/yazı yerleşimi E2E'de doğrulandı.

İlk iki yeni E2E turu 10/11 geçti: locale refresh'in davet fragment'ını geri
getirmesi bulundu. Next history senkronizasyonu düzeltildi; hedefli test 1/1,
ardından tam suite **11/11** geçti. Başarısız sonuçlar gizlenmedi.

Railway web/API/Postgres yayını **doğrulandı**. Gerçek HTTPS/Chromium smoke:
DB health, admin login, secure cookies, yetkisiz erişim/Origin reddi,
kullanıcı/audit sayfaları, şeffaf logo, 375 px mobil ve logout başarılı.
Cloud PostgreSQL 18.6 runtime rolü kısıtlı; aktif admin 1, demo kullanıcı 0.
Sahte ingress IP başlıkları için oluşturulan bucket sayısı 0.
Deployment kimlikleri ve başarısız ilk denemeler dahil güncel kanıt:
`docs/RAILWAY_DEPLOYMENT.md`. SMTP daveti kapalıdır. Önceki Compose engeli
aşağıda aynen korunur; canlı pilot bütün ürünün veya Faz 0'ın kabulü değildir.

CR-2 sonrası R2-01/02 için ek izole DB doğrulaması: normal rol kurulumu,
beklenmeyen üyelikle provisioning reddi ve yarıda kesilen GRANT'ın rollback'i
başarılı. Lokal psql14 `\getenv` desteklemediği için testte eşdeğer psql
değişkeni stdin ile verildi. Değişmemiş `\getenv` satırı dahil gerçek migration
SQL'i cloud container'da başarıyla çalıştı. App rolüne tehlikeli
üyelik/metadata izni bırakılmadı. CR-3 odaklı üç paralel review: yeni bulgu yok.

Tarih: **10 Kasım 2026**. Branch: `story/phase-0-foundation`.
Baseline: `9d15c72`. Test çalışma ağacı: `/tmp/protarget-phase0-work`.

## İlk doğrulama turu (Railway öncesi tarihsel kayıt)

| Kontrol | Sonuç |
|---|---|
| Monorepo build | 8/8 paket başarılı |
| Typecheck | 8 pakette başarılı (11 task, dependency build'leri dahil) |
| ESLint | Başarılı |
| Frozen/offline install | Lockfile güncel; kurulum başarılı, ek dependency resolution yok |
| Unit | 14/14 (2 suite) |
| Gerçek PostgreSQL integration | 36/36 (1 suite) |
| Gerçek Chromium E2E | 10/10 |
| Üç migration | İzole dev ve test PostgreSQL DB'lerine uygulandı |
| Seed | İzole dev ortamında uygulandı; mevcut hesapları ezmez |
| OpenAPI | `docs/openapi.json` üretildi |
| Env generator | 0600 izin, rastgele değerler, tekrar çalıştırmada ezmeme doğrulandı |
| `docker compose config --quiet` | Yeni geçici env ile başarılı |
| `docker compose up --build -d --wait` | **ÇALIŞTIRILAMADI** — Docker socket erişimi reddedildi |
| Kök Compose container migration/health | **DOĞRULANMADI** |
| Paralel üçlü code review | Tamamlandı; 13 birleştirilmiş deferred bulgu (1 high, 11 medium, 1 low) |
| Production / fiziksel CMS/player / DSP | Kapsam dışı; test edilmedi |

Docker erişimi sandbox dışı izinli komutla da kontrol edildi:
`permission denied ... /var/run/docker.sock`. Socket yetkileri değiştirilmedi,
sudo parolası istenmedi, gerçek PostgreSQL sonuçları Docker yerine sayılmadı.
**Faz 0 kabulü henüz kapanmaz; main'e tamamlandı olarak merge edilmez.**

## Ortam ve izolasyon

- İzole Node 24.22.2; sistem Node kurulumu değiştirilmedi.
- PostgreSQL 14, ayrı local cluster; dev/test DB farklı, runtime rolü kısıtlı.
- API loopback `127.0.0.1:14172`, web `127.0.0.1:13172`.
- Integration yalnız SMTP transport'unu mock eder; repository, auth, JWT,
  bcrypt, transaction, DB izinleri ve trigger'lar gerçektir.
- E2E gerçek web/API/DB ve loopback SMTP capture kullanır. Gerçek müşterilere
  e-posta göndermez. HTTP request trace/parola/token kaydı tutulmaz.

## Tarayıcı kapsamı

Anonim erişim/login hatası, admin formuyla kurum oluşturma/düzenleme,
boş opsiyonel alanı temizleme, görünürlük tercihi, audit sayfası,
iki ayrı ajans ve reklamverenin kendi kurumuna yönlenmesi,
başka kuruma erişim/yazma reddi, Support kısıtı, SMTP davet/fragment kabulü,
tek kullanımlı token, logout, access cookie yokken iki sekmede refresh,
TR/EN anahtar/interpolation eşliği ve 375 px mobil taşma kontrolü.

İlk E2E turunda 6/10 geçti: iki select erişilebilir adı, testte Next route
announcer seçicisi ve mobil grid taşması düzeltildi. Son tur **10/10**.
İlk build turundaki Web Locks Promise tipi düzeltildi. Başarısız eski turlar
başarılı olarak sayılmadı.

## Kalan kabul işleri

1. Docker erişimi olan ortamda temiz, projeye ait volume ile Compose build,
   migration, seed, API/web health ve tekrar başlatma doğrulaması.
2. Docker runtime rolüyle audit değişmezliği kontrolü.
3. Triage kaydedildi: `_bmad-output/implementation-artifacts/deferred-work.md`.
   Bir bölümü Railway turunda düzeltildi; güncel açık maddeler bu dosyada.
   Ortak proxy IP riski giderildi ve canlı ingress davranışı ayrıca doğrulandı.
4. Kalan production hardening, image/dependency taraması, yedek/restore
   ve operasyonel izleme. Canlı pilot bunların tamamlandığı anlamına gelmez.

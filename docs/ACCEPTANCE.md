# Faz 0 doğrulama kaydı

Tarih: **10 Kasım 2026**. Branch: `story/phase-0-foundation`.
Baseline: `9d15c72`. Test çalışma ağacı: `/tmp/protarget-phase0-work`.

## Son çalıştırmalar

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
   Düzeltmeler henüz uygulanmadı. Özellikle ortak proxy IP rate-limit riski
   internet erişimli kullanım öncesi giderilmeli.
4. Dağıtım öncesi production hardening ve kullanılan image/dependency taraması.

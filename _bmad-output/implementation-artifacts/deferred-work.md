# Ertelenen işler — Faz 0 / CR-1

## CR-2 yeni bulgular

Story dosyasının Tur 2 tablosu otoritedir. R2-01/02 yayın öncesi ayrı
hardening düzeltmesiyle kapatıldı (`096bc8e`); üç paralel CR-3 reviewer'ı
odaklı değişiklikleri onayladı. Gerçek cloud migration ve kısıtlı rol testi
başarılı. R2-03/04 (IPv6 literal/TLS parametre aktarımı),
R2-05/06 (bootstrap konfigürasyon hataları), R2-07 (logo test decode bekleme),
R2-08 (dil değişiminde eski bildirim dili) ertelendi.
Canlı konfigürasyon DNS hostname, şifreli Railway özel ağı ve geçerli/eşleşen
bootstrap değişkenleri kullanır; koşullu senaryolar başarılı diye raporlanmaz.

## 10 Kasım 2026 — Railway hazırlık düzeltmeleri

CR-2'ye sunulan değişiklikler:
- F0-001: Railway ingress IP'si web/API arasında imzalanır; hesap limiti
  korunur; farklı istemci kotası + imzasız sahte başlık testi geçti.
  Canlı ingress davranışı ayrıca doğrulandı: sahte istemci IP'leri için
  rate-limit bucket oluşmadı (0).
- F0-002/003/004/007/008/013: kod düzeltmeleri ve ilgili DB/browser
  regresyonları eklendi. Son yerel suite'ler başarılı; CR-2 tamamlandı.
- F0-011: gerçek secret/browser artifact taraması eklendi, **kısmi**;
  tüm auth logları için sentinel kapsamı hâlâ eksik.
- F0-005/006/009/010/012: bu turda kapatılmadı. Owner migration/status yolu
  Railway için eklendi; eski Compose yönergesi ayrı belge açığı olarak kalır.

Orijinal CR-1 kayıtları aşağıda tarihsel olarak korunur.

Tarih: 10 Kasım 2026. İncelenen implementation commit: `eec3342`.
Üç bağımsız reviewer paralel çalıştı: blind-hunter, edge-case-hunter,
acceptance-auditor. Kod değiştirmediler; raporlar birleştirildi.

**13 benzersiz bulgu: 1 yüksek, 11 orta, 1 düşük.** Bunlar bu commit'te
uygulanmış düzeltmeler değildir. Testlerin geçmesi bu bulguları geçersiz kılmaz.
Bulgu kategorisi `patch`; kapsam değişikliği gerektiren yeni iş talebi yoktur.

| ID | Önem | Lokasyon | Bulgu / önerilen düzeltme |
|---|---|---|---|
| F0-001 | **Yüksek** | `apps/web/src/app/api/v1/[...path]/route.ts:35–40`, `apps/api/src/modules/auth/auth.service.ts:23–24` | Web proxy arkasındaki kullanıcılar aynı IP limitini paylaşır. Tek istemci login/refresh/accept limitini tüketerek başkalarını engelleyebilir. Güvenilir ingress üzerinde istemci bazlı limit veya doğrulanmış/sahteciliğe kapalı istemci IP iletimi tasarla; keyfi X-Forwarded-For'a güvenme. Hesap bazlı limiti koru. İnternete açılmadan önce giderilmeli. |
| F0-002 | Orta | `apps/web/src/components/Management.tsx:112–113`, `apps/api/src/modules/users/users.service.ts:59–62` | Davetli pasif kullanıcının yalnız adı düzenlense bile UI `active:false` gönderir ve daveti iptal eder. PATCH'te yalnız değişen alanları gönder; pasiflik geçişi/davet iptalini açık ayır. Regresyon testi ekle. |
| F0-003 | Orta | `apps/api/src/modules/users/users.service.ts:44–45` | Pasif kurumdaki kullanıcı ayrıca pasifleştirilemiyor; kurum açılınca hâlâ aktif kullanıcı geri döner. Aktivasyon/taşıma için aktif kurum iste, mevcut pasif kurumda deactivation'a izin ver. |
| F0-004 | Orta | `apps/web/src/components/Locale.tsx:18–19`, `apps/web/src/components/AuthForms.tsx:39–45` | Davet fragment'ı URL'den kaldırıldıktan sonra dil düğmesi tam reload yapar ve bellekteki token kaybolur. Form state'ini koruyan locale değişimi/router refresh uygula; davet aç → dil değiştir → kabul et E2E testi ekle. |
| F0-005 | Orta | `package.json:10`, `apps/api/src/app.module.ts:26–30`, `infra/run-local.mjs:9–15` | Eski `pnpm dev` explicit env loader'ı kullanmaz; temiz shell'de API config doğrulaması başarısız olur. Watch-mode için açık env yükleyen API/web dev başlatıcısı ekle; iskelet worker/player'ı yanlışlıkla çalıştırma. Belgelenen `pnpm local api/web` yolu ayrı ve test edilmiştir. |
| F0-006 | Orta | `apps/web/src/lib/client.ts:21–22` | Web Locks yoksa yalnız sekme içi refresh tekilleştirilir. İki sekme aynı refresh'i kullanıp replay nedeniyle oturumu kapatabilir. Güvenli çapraz-sekme koordinasyonu veya açık destek sınırı ekle; locks olmayan tarayıcı testi yaz. |
| F0-007 | Orta | `apps/api/src/modules/auth/auth.service.ts:123–131`, `apps/api/src/modules/users/users.service.ts:106–116` | E-posta ulaşıp SMTP ACK gecikirse davet henüz pending iken kabul edilebilir; sonra SMTP timeout ile delivery failed yazılırken hesap aktif kalır. Kabul ve delivery finalization durumlarını atomik/uyumlu ele al; kabul edilmiş davet ile transport hatasını çelişkili raporlama. Race testi ekle. Bu, tek başına yetkisiz kişinin token edinmesi demek değildir. |
| F0-008 | Orta | `apps/web/src/components/Management.tsx:83–85` | Kullanıcı formunun org listesi/has-more state'i yeni server props ile eşleşmez. Başka sekmede eklenen 101. kurum router refresh sonrası görünmeyebilir. Seçimi koruyarak org state/pagination senkronizasyonu ekle. |
| F0-009 | Orta | `docs/openapi.json:98–143`, `apps/api/src/common/pagination.dto.ts:6–12` | OpenAPI'de 15 operation için yanıt gövdesi şeması yok; pagination integer yerine boş Object referansı taşıyor. Response/error DTO ve doğru parameter schema ekle, belgeyi yeniden üret, contract testi yaz. |
| F0-010 | Orta | `apps/api/test/foundation.integration-spec.ts:242–258` | Yetki matrisi 4 mevcut mutation route'unu elle listeler ve 403'ü doğrular; otomatik endpoint keşfi ve redden sonra veri değişmediği assertion'ı yok. Auth istisnaları açık olacak şekilde mutation discovery + before/after persistence kontrolü ekle. Mevcut bir yetki ihlali kanıtlanmış değildir. |
| F0-011 | Orta | `apps/api/test/phase0-security.unit-spec.ts:21–27`, `apps/api/test/foundation.integration-spec.ts:488–500` | Redaction/SMTP log kontrolleri var; browser bundle ve tüm foundation loglarında sentinel secret yokluğu otomatik test edilmiyor. İzole build asset/log taraması ekle. Kaynakta bilinen üretilmiş credential taraması geçti; bu bulgu gerçek sızıntı kanıtı değildir. |
| F0-012 | Orta | `tech-spec-phase-0-foundation.md:92`, `infra/runtime-grants.sql:6` | Spec'teki `docker compose exec api pnpm prisma migrate status` yanlış çalışma dizini/rol kullanır. Migration-owner one-shot service içinde doğru API workspace ve bağlantıyla status komutu sağla. Runtime rolüne migration metadata yetkisi verme. |
| F0-013 | Düşük | `apps/web/e2e/foundation.spec.ts:62–66,145–176` | E2E cleanup yalnız oluşturulan kurumları pasifleştirir; seed Agency A altındaki davetli test hesabı aktif kalır. Oluşturulan user ID'sini takip et, failure dahil admin API ile pasifleştir ve sonucu assert et. |

## Triage notları

- F0-001/002/003/004 birden çok reviewer tarafından bulundu, tekilleştirildi.
- Default Mailpit portuyla test SMTP capture çakışması README'de açık test
  önkoşulu olarak belgelenmiştir. Gelecekte test ortamı orchestration'ı
  iyileştirilebilir; mevcut bağımsız SMTP senaryosunun geçtiği iddiasını bozmaz.
- Docker daemon erişimsizliği kod hatası değildir, ayrı **kabul engelidir**.
- AC1 blocked, AC4 container kısmı unverified, AC5'in test kapsamı kısmi.
  Diğer AC'ler kaynak/test kayıtlarıyla desteklenir; reviewer'lar suite'leri
  bağımsız tekrar çalıştırmadı.
- Bu deferred liste yeni iş fazına otomatik başlama veya production yayını
  onayı değildir. Faz 0'ın Docker kabulü hâlâ açık.

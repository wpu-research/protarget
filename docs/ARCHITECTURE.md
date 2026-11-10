# Faz 0 mimarisi

## İstek akışı

Tarayıcı → Next.js `/api/v1/*` aynı-origin geçidi → NestJS → Prisma → PostgreSQL.
Next sunucu bileşenleri API'ye iç ağ adresiyle, mevcut HttpOnly cookie'lerle
erişir. Sayfa/layout ve API ayrı ayrı yetki denetler. Veri fetch'leri no-store.
Sunucu hataları istemciye iç bağlantı/stack/secret taşımaz.

Geçit yalnız sabit API origin'ine, doğrulanmış path segmentleriyle GET/POST/PATCH
gönderir. Redirect takip etmez, istemci forwarding başlıklarını kopyalamaz,
32 KiB body sınırı ve upstream timeout uygular. Unsafe istek Origin kontrolü
hem geçitte hem Nest guard'da, login/refresh/logout dahil çalışır.

## Kimlik ve yetki

- Bcrypt hash; parola en az 12 karakter (davet), en fazla 72 UTF-8 bayt.
- Access JWT 15 dakika; issuer/audience/type/algorithm/expiry doğrulanır.
- Opaque refresh token DB'de yalnız hash olarak tutulur, tek kullanımlı döner.
  Aile ömrü 7 gün; replay tüm session ailesini iptal eder.
- Her iş isteğinde DB session + güncel aktif kullanıcı/kurum/rol kontrolü.
  Logout veya izin değişikliği JWT süresi dolmadan etkili olur.
- Cookie: HttpOnly, SameSite=Strict, Path=/, production'da Secure.
- Yeni route varsayılan kapalı. Kimlik endpoint'leri hariç iş yazmaları admin.
- Agency/Advertiser repository sorgusunda own-org predicate ve dar select.
  Support için kurum, kullanıcı ve audit erişimi yoktur.
- Çoklu sekme refresh Web Locks ve mevcut `/me` kontrolüyle tekilleştirilir;
  Web Locks olmayan tarayıcıda sadece sekme içi tekilleştirme vardır.

## Kullanıcı daveti

24 saatlik, hash'lenmiş tek kullanımlık davet. Link token'ı URL fragment'ında
taşınır; sunucu loguna/Referer'a girmez. UI fragment'ı aldıktan sonra URL'den
kaldırır. SMTP gönderimi retryable transaction dışında; gönderilemeyen davet
iptal edilir. Aynı pasif, henüz kabul edilmemiş kullanıcı tekrar davet edilebilir.

## Audit ve DB rolleri

Business mutation ve audit aynı serializable transaction içinde. P2034
serialization/deadlock için sınırlı retry. Transaction içine SMTP konmaz.
Audit before/after/metadata recursive redaction'dan geçer; okurken de maskelenir.

Migration sahibi runtime'dan ayrıdır. Runtime tablolara normal CRUD yapar,
audit UPDATE/DELETE/TRUNCATE izinleri kaldırılır; ek trigger'lar değişikliği
reddeder. Runtime `_prisma_migrations` ve schema CREATE yetkisi almaz.

## Yapı

- `apps/api/src/modules/{auth,organizations,users,portal,audit}`: gerçek servisler.
- `apps/web/src/app`: giriş, davet, refresh, admin, tenant portalı, support.
- `packages/shared/src/foundation.ts`: güvenli yanıt tipleri ve rol/kurum eşlemesi.
- `packages/i18n/src/{tr,en}.json`: eş anahtarlı foundation arayüz sözlükleri.
- `infra`: konteyner dosyaları, DB grant ve güvenli env başlangıcı.
- `docs/MVP_DECISIONS.md`: manuel CMS/booking kapsamının yeni kaynağı.

## Yayın öncesi bilinen sınırlar

Docker çalıştırma henüz doğrulanmadı. Bu yerel Compose üretim konfigürasyonu
değildir. Web/API request ID ilişkilendirme, güvenilir proxy/IP limit modeli,
session/rate-limit veri yaşam süresi temizliği, MFA, CSP, bağımlılık taraması,
yedekleme/geri yükleme ve monitoring ayrı sertleştirme maddeleridir.

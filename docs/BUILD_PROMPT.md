# CODEX GÖREVİ — Protarget pDOOH Platform (MVP, uçtan uca)

Bu prompt iki kaynak dokümanın birleşimidir: **Technical PRD v1.0** (ürün neden/nasıl çalışır) ve **Development Specification v2** (tam olarak ne kodlanır). İki doküman çeliştiğinde **Specification v2 geçerlidir**; biri diğerinde olmayan bir şey tanımlıyorsa **ikisinin birleşimi** uygulanır. Bu prompt kendi başına yeterlidir; yine de iki `.docx` dosyası repoda `docs/source/` altında varsa onları da oku ve bu prompt ile arasında fark görürsen `docs/ASSUMPTIONS.md` dosyasına yaz.

---

## 0. Rolün ve çalışma biçimin

Sen bu projenin baş mühendisisin. Boş bir repodan başlayıp aşağıda tarif edilen platformu çalışır, test edilmiş ve belgelenmiş halde teslim edeceksin.

- Bölüm 23'teki fazları **sırayla** uygula. Her fazın sonunda: migration'lar çalışır, testler geçer, `docker compose up` ile sistem ayağa kalkar, faz için bir commit atılır (`feat(phase-N): ...`).
- Bir fazın "Definition of Done" maddesi sağlanmadan sonraki faza geçme.
- İş kararı gerektiren ve dokümanlarda açık bırakılmış her konu için (Bölüm 22.3) **kod yazmayı durdurma**: konfigüre edilebilir bir ayar yap, varsayılanı bu prompttaki gibi seç, kararı `docs/ASSUMPTIONS.md` içine yaz.
- Bir şeyi atlamak ya da basitleştirmek zorunda kalırsan gizleme; `docs/ASSUMPTIONS.md` içinde "Eksik / ertelenen" başlığı altında açıkça yaz.
- Testleri gerçekten çalıştır ve sonucu olduğu gibi raporla. Geçmeyen testi "geçti" diye yazma, testi silerek ya da gevşeterek geçirme.
- Gizli bilgi (parola, anahtar, token) kaynak koda, frontend bundle'ına ve loglara asla yazılmaz; `.env.example` sağla.

---

## 1. Ürün özeti ve değişmez ilkeler

Protarget pDOOH Platform; dijital açık hava (DOOH) ekranlarının tek merkezden yönetildiği, kampanya ve creative yayınının ekranlara dağıtıldığı, gerçekleşen her oynatmanın proof-of-play (PoP) olarak kaydedildiği, tanımlı audience multiplier üzerinden estimated impression hesaplandığı ve aynı kampanyanın PMP/PG/direct deal mantığıyla ajans ya da markanın DSP tarafına taşınabildiği bir operasyon ve raporlama platformudur.

**Değişmez ilkeler (her tasarım kararında geçerli):**

1. **Self-service DSP değildir.** Ekran seçimi, kampanya kurulumu, creative, scheduling, multiplier, pacing, pause/resume ve deal operasyonu yalnızca **Protarget Admin** tarafından yapılır.
2. **Ajans ve marka kullanıcıları strictly read-only.** Kendi kampanyalarını izler; Deal ID, ekranlar, flight, playout, estimated impression, pacing, spend görür. Hiçbir mutation yapamaz — UI'da buton olmaması yetmez, **API seviyesinde de erişilebilir gizli mutation rotası olmamalıdır**.
3. **Core platform partner-agnostic.** GAM, tek bir SSP veya tek bir DSP'ye bağımlı kod core içinde olamaz. Screen/player, campaign, PoP, multiplier, impression, agency portal ve reporting Protarget'ın kendi domain'idir. GAM/SSP/Exchange/DSP bağlantıları yalnızca **connector katmanında** yaşar. Yeni partner eklemek ana ürünü yeniden yazdırmamalıdır.
4. **Fiziksel teslimatın source-of-truth'u = Protarget PoP + multiplier engine.** Dış DSP/SSP rakamları iç değerlerin üzerine asla yazılmaz; ayrı tutulur ve discrepancy olarak raporlanır.
5. **Multiplier versiyonlu bir nesnedir**, screen tablosunda overwrite edilen bir kolon değildir. Geçmiş asla sessizce yeniden hesaplanmaz.
6. **Ekran/player katmanı Protarget kontrolündedir.** GAM signage CMS, PoP kaynağı ya da multiplier deposu olarak kullanılmaz. GAM'in her pDOOH inventory modelini native kabul ettiği **varsayılmaz**.
7. V1'de gerçek-zamanlı bidding/exchange yazılmaz. Domain model ileride CTV, Addressable TV ve diğer ekran bazlı envanter tiplerine ve OpenRTB 2.6 DOOH alanlarına map edilebilecek şekilde kurulur (Screen/Venue/Deal alanlarını buna göre adlandır, `docs/OPENRTB_MAPPING.md` içinde eşleme tablosu ver).

### Ürün vizyonu (hepsi karşılanmalı)
- Tek panelden fiziksel DOOH yayını ve programmatic deal operasyonu.
- Ekran/player katmanı Protarget kontrolünde.
- Ajans/marka tarafında şeffaf, read-only kampanya takibi.
- Multiplier tabanlı impression metodolojisi ekran ve tarih bazında versiyonlu.
- PMP/PG/direct anlaşmalar için dış platformlara bağlanabilen connector mimarisi.
- İlk versiyonda RTB/exchange yok; üçüncü taraf SSP/exchange/GAM bağlantılarıyla büyüme.
- CTV/Addressable TV gibi envanterlere genişleyebilen domain model.

---

## 2. Kapsam

| V1 kapsamında | V1 kapsamı dışında (yazma) |
|---|---|
| Screen inventory management | Kendi RTB exchange / auction engine |
| Protarget tarafından manuel kampanya kurulumu | Ajansın kendi kampanyasını oluşturması |
| Creative upload ve scheduling | Ajansın ekran/fiyat/multiplier değiştirmesi |
| Screen/player delivery API | Kendi DSP'mizi yazmak |
| Offline-safe player cache | Full identity / audience graph |
| Proof-of-play ingestion | Otomatik computer-vision audience ölçümü (V2+) |
| Multiplier + estimated impression engine | QPS ölçeğinde real-time bidding |
| PMP / PG / Direct deal kaydı ve connector katmanı | GAM/SSP'ye hard-coded bağımlılık |
| Agency / Advertiser read-only portal | Finance ERP / tam muhasebe |
| Pause / resume / pacing / delivery monitoring | Media-owner self-service marketplace / portal |
| CSV/PDF rapor export | Karmaşık forecasting/optimizasyon AI |

---

## 3. Teknoloji kararları ve repo yapısı

Dokümanlar stack'i ekibe bırakıyor; bu görevde aşağıdaki varsayılanları kullan (gerekçesini `docs/ARCHITECTURE.md` içinde yaz):

| Katman | Seçim |
|---|---|
| Monorepo | pnpm workspaces + Turborepo, tamamı TypeScript |
| Frontend | Next.js (App Router) + React + TypeScript; Admin paneli ve Agency/Advertiser portalı aynı web uygulamasında, role göre ayrı layout |
| Backend | NestJS (REST JSON), OpenAPI/Swagger otomatik üretim |
| Veritabanı | PostgreSQL + Prisma (migration'lar repoda) |
| Cache / kuyruk | Redis + BullMQ |
| Dosya depolama | S3-uyumlu object storage (yerelde MinIO) + CDN'e hazır signed URL |
| Auth | JWT access + refresh token; Admin için opsiyonel TOTP MFA |
| Referans player | Chromium kiosk / Electron içinde çalışan TypeScript web player + testler için headless player simülatörü (CLI) |
| Deployment | Docker + docker-compose (dev), prod için Dockerfile'lar ve env ayrımı (dev / staging / production) |
| Monitoring | Sentry entegrasyon noktası + yapılandırılmış JSON log + `/metrics` (Prometheus formatı) |
| Antivirüs | ClamAV container (upload taraması), env ile kapatılabilir |
| E-posta | SMTP (yerelde Mailpit) |
| Test | Jest (unit/integration), Supertest (API), Playwright (E2E) |

```
/apps
  /api            NestJS: auth, inventory, campaigns, creatives, scheduling, player, pop,
                  impressions, pacing, deals, reporting, portal, notifications, audit, settings
  /web            Next.js: /admin/** ve /portal/**
  /player         Referans player (web/Electron) 
  /player-sim     Headless player simülatörü (test ve pilot için)
  /worker         BullMQ worker'ları (manifest, pacing, deal sync, aggregation, alerts, reports, cleanup)
/packages
  /shared         DTO'lar, enum'lar, hata kodları, zod şemaları
  /connectors     DealConnector arayüzü + manual + mock + gam (iskelet)
  /i18n           tr (varsayılan), en
/docs             Bölüm 22'deki tüm teslim dokümanları
/infra            docker-compose, Dockerfile'lar, seed script'leri
```

**Dil:** Arayüz **Türkçe öncelikli**, mimari **İngilizceye hazır i18n** (hiçbir UI metni koda gömülmez; `tr.json` tam, `en.json` tam). **Varsayılan timezone: Europe/Istanbul.** Tüm datetime'lar veritabanında UTC (`timestamptz`), API'de ISO 8601 timezone-aware.

---

## 4. Roller ve yetkiler (RBAC)

| Rol | Yapabildikleri | Kısıtlar |
|---|---|---|
| **Protarget Admin** | Tüm ekranlar, kampanyalar, creative, multiplier, pricing, deals, kullanıcılar, pause/resume, raporlama | Yok; tam yetki |
| **Agency User** | Kendi ajansına bağlı kampanyalar: Deal ID, ekranlar, flight, playout, impression, spend, pacing, raporlar | Create/edit/pause yok. Multiplier değiştiremez |
| **Advertiser User** | Kendi markasının kampanyaları ve raporları | Create/edit/pause yok. Diğer advertiser verisini göremez |
| **Developer / Support** (opsiyonel rol, uygula) | Teknik loglar, player health, error diagnostics | Ticari fiyat ve revenue bilgileri gösterilmez |

Yetki matrisi (Admin / Agency-Advertiser):

| Alan | Protarget Admin | Agency / Advertiser |
|---|---|---|
| Screen selection | Select / edit | View only |
| Creative | Upload / approve / replace | View only |
| Multiplier | Create / version / edit | View only |
| Campaign dates | Create / edit | View only |
| Pause / Resume | Evet | Hayır |
| Deal | Create / send / sync | View / copy ID only |
| Delivery | Tam operasyonel detay | Read-only |
| Reports | Tüm kampanyalar | Yalnız kendi kampanyaları |
| Pricing / revenue share | Tam erişim | Opsiyonel / konfigüre edilebilir görünürlük |

**Varsayılan görünürlük kuralları:**
- Agency: `campaign.agency_id == user.organization_id` olan kampanyalar.
- Advertiser: `campaign.advertiser_id == user.organization_id` olan kampanyalar.
- Admin: hepsi.
- `campaign_permissions` tablosu (user/org → campaign görünürlük eşlemesi) şemada bulunsun; açık ek paylaşım UI'ı gelecek özelliktir.

**Zorunlu uygulama:** Veri izolasyonu `organization_id` üzerinden **sorgu katmanında** zorlanır (yalnız controller guard'ı değil; repository/servis seviyesinde scoped query). Yetkisiz kaynak denemesi `403` döner ve `UNAUTHORIZED_PORTAL_ACCESS` güvenlik olayı olarak loglanır. Ajans/marka kullanıcısı şunları **yapamaz**: pause/resume; ekran değiştirme; multiplier değiştirme; tarih, fiyat, bütçe veya guaranteed quantity değiştirme; creative yükleme/değiştirme (gelecekte açıkça etkinleştirilmedikçe); başka ajans/advertiser verisi görme.

---

## 5. Domain modeli ve veritabanı

### 5.1 Çekirdek nesneler
Screen (fiziksel ekran / player endpoint), Venue (lokasyon grubu), Inventory Slot (ekranın satılabilir yayın kapasitesi: loop length, slot length, daypart, availability), Multiplier Profile, Creative, Campaign, Campaign Screen (priority, caps, allocation weight), Schedule, Proof of Play, Impression Event, Deal, User / Organization.

### 5.2 Tablolar (minimum kolonlar — gerekirse ekle, çıkarma)

- **organizations**: id, name, type (`agency` / `advertiser` / `admin` / `media_owner`), brand_name (advertiser), tax_legal_label (opsiyonel), active, spend_visible (bool), revenue_share_visible (bool), created_at
- **users**: id, org_id, name, email (UNIQUE), role, password_hash / sso_id, mfa_secret (şifreli, opsiyonel), status/active, last_login
- **campaign_permissions**: id, user_id / org_id, campaign_id
- **venues**: id, name, type, country, city, district, lat, lon, timezone, owner_org_id (ileride media-owner), active, notes
- **screens**: id (UUID), screen_id (UNIQUE, insan-okur kod örn. `SCR-IST-001`), venue_id, name, owner, location_label, resolution_width, resolution_height, orientation, physical_size, aspect_ratio (türetilmiş), player_type, os, loop_length_sec, default_slot_length_sec, operating_start, operating_end, floor_cpm, floor_cpp, direct_rate, revenue_share, timezone, status (active/inactive), deal_eligible, player_id, last_playback_at, deleted_at (soft delete)
- **screen_external_mappings**: id, screen_id, connector, external_inventory_id (connector başına eşleme)
- **players**: id, screen_id, token_hash, credential_version, version, os, last_heartbeat, health, disk_free, current_manifest_version, last_successful_playback, last_error_code, last_error_message, force_refresh (bool)
- **multiplier_profiles**: id, screen_id, value (DECIMAL > 0), source_type, source_ref, valid_from, valid_to (NULL = açık uçlu), daypart_start, daypart_end, weekdays (dizi), confidence_note, approval_status (`DRAFT` / `APPROVED`), version, created_by, approved_by, approved_at, supersedes_id
- **creatives**: id, advertiser_id, file_url / storage_key, original_filename, mime, duration, width, height, status, checksum (sha256), version, replaces_id, rejection_reason
- **campaigns**: id, code (örn. `CMP-2026-104`), name, advertiser_id, agency_id (NULL olabilir), internal_owner_id, start_at, end_at, timezone, notes, pricing_model, currency, unit_price, budget, contracted_amount (FIXED), guaranteed_impressions, contracted_quantity, target_playouts, overdelivery_tolerance_pct (varsayılan 1), pg_billing_basis (`CONTRACTED` / `DELIVERED`), publisher_share_pct, protarget_share_pct, priority, distribution_mode (`EVEN` / `MANUAL`), max_playouts_per_hour_per_screen, deal_required, status, pacing_status, deleted_at (soft delete)
- **campaign_screens**: campaign_id, screen_id, allocation_weight, priority, caps, active
- **campaign_creatives**: campaign_id, creative_id, priority
- **schedules**: id, campaign_id, screen_id (NULL = tüm seçili ekranlar), day_of_week, start_time, end_time
- **manifests**: id, screen_id, manifest_version, valid_until, payload_json, built_at, acknowledged_at
- **scheduled_slots**: id (`SLOT-…`), manifest_id, screen_id, campaign_id, creative_id, valid_from, valid_to, priority, fulfilled (missed playout hesabı için)
- **proof_of_play**: id, event_id (UNIQUE), campaign_id, screen_id, creative_id, scheduled_slot_id, played_at, received_at, duration, result, offline_recorded, player_version, clock_drift_suspected
- **impression_events**: id, pop_id, multiplier_profile_id, estimated_impressions, calculation_version
- **deals**: id, campaign_id, internal_id (UNIQUE, `PTR-YYYY-NNNNN`), type, connector, seller_platform, dsp, buyer_seat_id, currency, cpm (floor/fixed), guaranteed_impressions, start_at, end_at, inventory_scope, external_id, status, external_status, raw_external_status (string/json), last_synced_at
- **deal_sync_logs**: id, deal_id, operation, request (redacted), response (redacted), status, created_at
- **external_delivery_reports**: id, deal_id, date, external_impressions, raw_json, fetched_at
- **audit_logs**: id, user_id, action, entity_type, entity_id, before_json, after_json, metadata_json (örn. connector sonucu), timestamp — **append-only**
- **ops_errors**: id, code, severity, entity_type, entity_id, message, details_json, resolved_at, created_at
- **player_error_logs**: id, screen_id, player_id, code, message, details_json, occurred_at
- **notifications**: id, trigger, recipient, channel, payload, sent_at, status
- **settings**: key, value_json (heartbeat eşikleri, pacing eşikleri, manifest grace period, poll aralığı, launch'ta deal zorunluluğu, source_reference görünürlüğü, log retention vb.)
- **raporlama aggregation tabloları**: `daily_campaign_screen_delivery` (date, campaign_id, screen_id, playouts, failed_playouts, estimated_impressions, estimated_spend), gerektiği kadar benzeri

### 5.3 Zorunlu constraint'ler

| Constraint | Neden |
|---|---|
| `proof_of_play.event_id` UNIQUE | Çift sayımı önler |
| `screens.screen_id` UNIQUE | Sabit fiziksel kimlik |
| `users.email` UNIQUE | Auth |
| Multiplier geçerlilik overlap kontrolü | Deterministik impression hesabı |
| `campaign.end_at > start_at` | Geçerli flight |
| `deals.internal_id` UNIQUE | İzlenebilirlik |
| Para alanları `DECIMAL` — **asla float** | Finansal doğruluk |
| campaigns / screens için soft delete | Audit / geçmiş |
| `audit_logs` üzerinde UPDATE/DELETE DB seviyesinde engelli (trigger ya da yetki) | Değişmezlik |

Dışa açılan entity ID'leri UUID olsun; insan-okur kodlar (`SCR-…`, `CMP-…`, `CR-…`, `PTR-…`, `SLOT-…`) ayrı alanlardır.

---

## 6. Durum makineleri

### 6.1 Campaign
```
DRAFT -> READY_FOR_REVIEW -> READY -> LIVE
LIVE -> PAUSING -> PAUSED | PAUSED_WITH_EXTERNAL_ERROR
PAUSED / PAUSED_WITH_EXTERNAL_ERROR -> RESUMING -> LIVE | LIVE_WITH_EXTERNAL_ERROR
LIVE / PAUSED -> COMPLETED
DRAFT / READY / PAUSED -> CANCELLED
```
Kurallar:
- LIVE için en az **1 screen + 1 approved creative + geçerli schedule** gerekir.
- PG/deal kampanyasında external deal gerekiyorsa connector status "accepted/active" kontrolü **konfigüre edilebilir** (blocker ya da "yine de başlat?" onayı).
- PAUSED (ve PAUSING) iken player manifest kampanyayı yayınlamaz.
- `end_at` geçince kampanya otomatik COMPLETED olur; COMPLETED read-only'dir. Admin **reopen** işlemi audit log üretir.
- `RESUMING` ve `LIVE_WITH_EXTERNAL_ERROR`, dokümandaki "Resume mirrors the above" ifadesinden türetilmiştir; `docs/ASSUMPTIONS.md` içine not düş.
- Geçersiz geçiş denemesi standart hata zarfıyla `409` döner. Her geçiş audit log üretir.

Duruma göre birincil aksiyonlar:

| Durum | Aksiyonlar |
|---|---|
| Draft | Edit / Delete / Validate |
| Ready | Launch / Edit |
| Live | Pause / Edit limited fields / View delivery |
| Paused | Resume / Cancel |
| Completed | Export / Clone |
| Cancelled | Clone / Export |

"Edit limited fields" (LIVE iken): notlar, `end_at` uzatma, creative değiştirme, schedule/ağırlıklar, ekran ekleme/çıkarma. Advertiser, agency, pricing model, currency kilitli. (Varsayım — `ASSUMPTIONS.md`.)

### 6.2 Creative
`UPLOADED -> VALIDATING -> APPROVED | REJECTED`

### 6.3 Deal (external_status, eşlenmiş)
`DRAFT / SENT / NEGOTIATING / ACCEPTED / ACTIVE / PAUSED / COMPLETED / ERROR` — ham dış durum `raw_external_status` içinde saklanır.

### 6.4 Multiplier profile
`DRAFT -> APPROVED` (onaylandığında `approved_by` otomatik dolar).

### 6.5 Player health
Online: heartbeat < 2 dk · Warning: 2–10 dk · Offline: > 10 dk. **Eşikler Settings'ten konfigüre edilir.**

---

## 7. Backend API

### 7.1 Konvansiyonlar
- V1 için REST JSON. Prefix: **`/api/v1`**.
- Dışa açılan entity ID'leri UUID.
- ISO 8601 timezone-aware datetime.
- Para DECIMAL olarak saklanır ve string olarak serileştirilir; float kullanılmaz.
- Tüm liste endpoint'lerinde pagination (+ filtre/sıralama).
- API rate limiting.
- OpenAPI/Swagger `/api/docs` altında; `docs/openapi.json` repoya yazılır.
- Standart hata zarfı:
```json
{
  "error": {
    "code": "MISSING_MULTIPLIER",
    "message": "No approved multiplier profile exists for SCR-001 at event time.",
    "details": {}
  }
}
```

### 7.2 Endpoint listesi (iki dokümanın birleşimi — hepsini uygula)

| Method | Endpoint | Rol | Amaç |
|---|---|---|---|
| POST | /auth/login | Hepsi | Login (MFA etkinse ikinci adım) |
| POST | /auth/logout | Hepsi | Logout |
| POST | /auth/refresh | Hepsi | Token yenileme |
| GET | /me | Hepsi | Mevcut kullanıcı |
| POST | /users/invite | Admin | Ajans/marka kullanıcısı davet |
| GET/POST/PATCH | /organizations, /organizations/{id} | Admin | Agency/Advertiser CRUD |
| GET/PATCH | /users, /users/{id} | Admin | Kullanıcı yönetimi, org/kampanya yetkisi |
| GET/POST | /venues | Admin | Venue CRUD |
| PATCH | /venues/{id} | Admin | Venue düzenleme |
| GET/POST | /screens | Admin | Screen CRUD |
| PATCH | /screens/{id} | Admin | Screen düzenleme / deactivate |
| GET | /screens/{id}/health | Admin, Support | Player health |
| POST | /screens/{id}/force-manifest-refresh | Admin, Support | Manifest'i zorla yenilet |
| GET/POST | /screens/{id}/multipliers | Admin | Multiplier profilleri (liste / yeni versiyon) |
| POST | /multipliers/{id}/approve | Admin | Onay |
| GET/POST | /campaigns | Admin | Liste / oluştur |
| GET/PATCH | /campaigns/{id} | Admin | Detay / düzenle |
| DELETE | /campaigns/{id} | Admin | Draft sil (soft) |
| POST | /campaigns/{id}/validate | Admin | Launch validation |
| POST | /campaigns/{id}/launch | Admin | Launch |
| POST | /campaigns/{id}/pause | Admin | Pause |
| POST | /campaigns/{id}/resume | Admin | Resume |
| POST | /campaigns/{id}/complete, /cancel, /reopen, /clone | Admin | Durum aksiyonları |
| POST | /campaigns/{id}/screens | Admin | Ekran ata |
| GET/POST | /campaigns/{id}/schedule | Admin | Schedule |
| POST | /creatives | Admin | Upload |
| GET | /creatives/{id} | Admin | Detay / önizleme |
| POST | /creatives/{id}/approve, /reject | Admin | Onay / ret |
| POST | /deals | Admin | Internal deal oluştur |
| POST | /campaigns/{id}/deals | Admin | Kampanyaya deal oluştur (aynı servis) |
| GET | /deals, /deals/{id} | Admin | Liste / detay |
| POST | /deals/{id}/send | Admin | Connector ile gönder |
| POST | /deals/{id}/sync | Admin | Dış durumu yenile |
| POST | /deals/{id}/pause, /resume | Admin | Dış deal pause/resume |
| GET | /deals/{id}/status | Admin | Durum |
| GET | /connectors, POST /connectors/{key}/validate | Admin | Connector listesi / bağlantı testi |
| GET | /reports/campaigns/{id} | Admin / scoped kullanıcı | Kampanya teslimatı |
| GET | /reports/screens/{id} | Admin | Ekran teslimatı |
| GET | /reports/revenue, /reports/discrepancy | Admin | Revenue / discrepancy |
| GET/POST | /reports/export | Admin / scoped kullanıcı | CSV/PDF export (arka plan işi) |
| GET | /portal/dashboard | Agency/Advertiser | Portal özet |
| GET | /portal/campaigns | Agency/Advertiser | Scoped kampanyalar |
| GET | /portal/campaigns/{id} | Agency/Advertiser | Read-only detay |
| GET | /portal/deals | Agency/Advertiser | Scoped deal'ler |
| GET | /dashboard | Admin | Admin dashboard widget verisi |
| GET | /ops/errors, /ops/player-health | Admin, Support | Operasyon ekranları |
| GET | /audit-logs | Admin | Audit (yalnız okuma) |
| GET/PATCH | /settings | Admin | Ayarlar |
| POST | /player/register | Player | İlk kayıt / credential alma |
| POST | /player/heartbeat | Player | Online health/status |
| GET | /player/{screen_id}/manifest | Player | Aktif playlist/schedule |
| POST | /player/proof-of-play | Player | Tekil PoP |
| POST | /player/proof-of-play/batch | Player | Offline biriken PoP'lar |
| POST | /player/error | Player | Playback/download/device hata logu |

PRD'deki `/reports/campaign/{id}` ve `/reports/screen/{id}` yazımları için çoğul rotalara yönlenen alias bırak.

---

## 8. Player katmanı

### 8.1 Mimari gereksinimleri
Her fiziksel ekranda ya da ekranı yöneten cihazda Protarget Player/Agent bulunur; ayrı uygulama olabilir ya da mevcut signage player'a SDK/API ile gömülebilir (bu yüzden Player API sözleşmesi player uygulamasından bağımsız ve belgeli olmalı).

- Player benzersiz `screen_id` ve device credential ile authenticate olur. **Long-lived ham token yerine rotatable device credential**: admin ekran için tek kullanımlık provisioning kodu üretir → player `/player/register` ile kodu credential'a çevirir → sunucu yalnız `token_hash` saklar → credential döndürülebilir/iptal edilebilir.
- Belirli aralıklarla heartbeat gönderir (player_version, disk_free, current manifest version, last successful playback, last error, cihaz saati).
- Playlist/schedule manifest'ini çeker (poll; aralık Settings'ten. Opsiyonel push bildirimi ile anında yenileme).
- Creative dosyalarını **önceden indirir** ve **checksum doğrular**.
- İnternet kesilirse **son geçerli schedule/cache** ile çalışmaya devam eder (konfigüre edilen grace period içinde).
- Bağlantı geri geldiğinde biriken PoP loglarını **batch** olarak gönderir — **kayıpsız**.
- Saat senkronizasyonu (NTP) ve timezone doğru olmalı; sunucu ayrıca **server timestamp doğrulaması** yapar (`received_at` saklanır, sapma eşiği aşılırsa `clock_drift_suspected`).
- Playback sonucu şu değerlerden biri olarak loglanır: `success` / `failed` / `skipped` / `corrupted` / `timeout`.

### 8.2 Manifest sözleşmesi
```
GET /api/v1/player/SCR-IST-001/manifest
Authorization: Bearer <device-token>

200 OK
{
  "manifest_version": "2026-11-10T18:40:00Z_1837",
  "screen_id": "SCR-IST-001",
  "valid_until": "2026-11-10T19:10:00Z",
  "items": [
    {
      "slot_id": "SLOT-8821",
      "campaign_id": "CMP-104",
      "creative_id": "CR-552",
      "asset_url": "https://cdn.../file.mp4?signed=...",
      "checksum": "sha256:...",
      "duration_seconds": 10,
      "valid_from": "2026-11-10T18:40:00Z",
      "valid_to": "2026-11-10T18:50:00Z",
      "priority": 100
    }
  ]
}
```
(`slot_id` alanı PoP'taki `scheduled_slot_id` ile eşleşmesi için eklenmiştir.) `asset_url` **signed ve süreli**dir; süresi dolmuş URL indirme yapamaz.

Player şunları yapmalı:
- Süresi dolmuş manifest item'larını yok say.
- Oynatmadan önce checksum doğrula.
- Aynı dosya için eşzamanlı çift indirme yapma.
- Manifest versiyonunu yerelde sakla.
- Offline fallback için son geçerli manifest'i konfigüre edilen grace period boyunca tut.

### 8.3 Proof-of-Play sözleşmesi
```
POST /api/v1/player/proof-of-play
{
  "event_id": "3f4e...uuid",
  "screen_id": "SCR-IST-001",
  "campaign_id": "CMP-104",
  "creative_id": "CR-552",
  "scheduled_slot_id": "SLOT-8821",
  "played_at": "2026-11-10T18:42:12+03:00",
  "duration_seconds": 10,
  "result": "success",
  "offline_recorded": false,
  "player_version": "1.0.0"
}
```

| Yanıt | Anlamı |
|---|---|
| 201 Created | İlk kez kabul edildi |
| 200 Duplicate | `event_id` zaten alınmış; çift sayım yok (`POP_DUPLICATE`, Info) |
| 400 Invalid | Eksik/geçersiz alan |
| 401 Unauthorized | Player credential geçersiz |
| 409 Mapping Error | Campaign/screen ilişkisi geçersiz |

- İdempotency DB seviyesinde: `event_id UNIQUE`. Yarış durumunda da tek kayıt oluşmalı.
- Screen A'nın token'ı Screen B için PoP **gönderemez**.
- **Dayanıklılık:** 2xx yanıtı döndükten sonra PoP kaybolamaz (önce kalıcı yaz, sonra yanıtla; impression hesabı event-driven arkadan gelebilir).
- Batch endpoint'i dizi alır, her event için ayrı sonuç döner (`created` / `duplicate` / `invalid` / `mapping_error`); bir event'in hatası diğerlerini düşürmez. Event'ler **orijinal `played_at`** ile işlenir.

### 8.4 Referans player (`apps/player`) ve simülatör (`apps/player-sim`)
En az MP4 cache/playback destekler; register, heartbeat, manifest poll, ön-indirme + checksum, zamanında oynatma, PoP gönderimi, kalıcı offline PoP kuyruğu (yeniden başlatmada kaybolmaz), bağlantı gelince batch flush, hata raporlama (`/player/error`), force-refresh'e uyma. Simülatör aynı sözleşmeyi headless çalıştırır; N ekranı, ağ kesintisini, saat sapmasını ve bozuk dosyayı simüle edebilir.

---

## 9. İş motorları

### 9.1 Manifest builder / scheduler
- Tetik: değişiklik anında (launch, pause, resume, creative/schedule/ekran değişikliği, force refresh) + periyodik.
- Bir ekranın manifest'ine yalnızca şu kampanyalar girer: status `LIVE` (ya da `LIVE_WITH_EXTERNAL_ERROR`), flight içinde, o ekran seçili ve `active`, schedule penceresi ekranın çalışma saatleriyle kesişiyor, creative `APPROVED` ve süresi slot ile uyumlu.
- Dağıtım: `EVEN` ya da `MANUAL` ağırlıklar (ağırlıklar toplamı %100'e normalize edilir). Öncelik: Low / Normal / High / Guaranteed. Opsiyonel frekans kuralı: ekran başına saatlik maksimum playout. Overdelivery toleransı (varsayılan %1) aşılınca kampanya manifest'ten çıkar.
- Kapasite modeli (varsayım, belgele): loop başına slot sayısı = `loop_length / slot_length`; her kampanya loop başına en fazla bir slot alır. Kapasite aşımı `SCREEN_CONFLICT` (Warning) üretir.
- Her manifest item'ı için `scheduled_slots` kaydı oluşur; karşılığında başarılı PoP gelmeyen slot **missed playout** sayılır.

### 9.2 Impression engine (event-driven, birebir bu mantık)
```
on proof_of_play(result == "success"):
    multiplier = find_approved_multiplier(screen_id = pop.screen_id, event_time = pop.played_at)

    if multiplier is None:
        create_ops_error("MISSING_MULTIPLIER")
        do not create impression_event
        return

    estimated_impressions = 1 * multiplier.value

    create impression_event(pop_id, multiplier_profile_id = multiplier.id, estimated_impressions)
```
Kurallar:
- V1 temel formül: `estimated_impressions = successful_playouts × applicable_multiplier` (örn. 500 başarılı playout × 74 = 37.000).
- `failed` / `skipped` / `corrupted` / `timeout` impression **üretmez**.
- Multiplier seçimi `played_at` zamanına göredir — offline PoP sonradan gelse bile event timestamp'ine göre doğru versiyon seçilir.
- Her impression kaydı hangi multiplier profil/versiyonuyla hesaplandığını saklar.
- Tek PoP, V1'de atomik source-of-truth'tur (batch/aggregate kaynak olsa bile).
- **Geçmiş impression'lar multiplier değişince asla sessizce yeniden hesaplanmaz.** Manuel "reprocess" eklenirse yeni `calculation_version` + audit kaydı oluşturur (eskisini silmez).
- Seçim önceliği: `APPROVED` + `valid_from <= t < valid_to` (NULL = açık uçlu) + daypart ve weekday eşleşmesi; daha spesifik profil (daypart/weekday tanımlı) genel profile üstün gelir.

### 9.3 Multiplier yönetim kuralları
- Aynı screen + aynı zaman aralığında overlap eden approved profil varsa kullanıcı **uyarılır**; deterministik hesap için aynı spesifiklikte iki approved profil aynı anı kapsayamaz (onay sırasında önceki açık uçlu profilin `valid_to` değeri yeni `valid_from` ile kapatılması önerilir, onaylanınca uygulanır ve audit'lenir).
- Geçmiş multiplier **edit edilmez**; yeni versiyon açılır. Değer hiçbir zaman overwrite edilmez.
- Profil yoksa impression event oluşmaz ve `MISSING_MULTIPLIER` operasyon hatası oluşur.
- Agency portalında multiplier **değeri ve source type** gösterilebilir; **source_reference görünürlüğü admin ayarıyla** yönetilir. Değiştirme yetkisi verilmez.

### 9.4 Pacing engine (zamanlanmış iş, real-time değil; 5–15 dk'da bir)
```
expected_delivery_ratio = elapsed_active_campaign_minutes / total_active_campaign_minutes
expected_impressions_now = guaranteed_impressions * expected_delivery_ratio
pacing_ratio = delivered_impressions / expected_impressions_now

< 0.90      => UNDERPACING
0.90 - 1.10 => ON_TRACK
> 1.10      => OVERPACING
```
Planlama tarafı:
```
remaining_target = guaranteed_impressions - delivered_impressions
remaining_hours  = active_hours_until_end
required_rate    = remaining_target / remaining_hours
her ekran için: planned_playouts = allocation_weight × required_rate / expected_multiplier
```
- "Aktif" dakika/saat = flight ∩ schedule ∩ ekran çalışma saatleri.
- Sistem kalan hedef / kalan aktif zaman / uygun ekran kapasitesi üzerinden **önerilen günlük playout** hesaplar. Hedef playout bazlıysa aynı mantık `target_playouts` ile çalışır.
- Admin dashboard pacing durumunu ve **önerilen aksiyonu** gösterir.
- İlk sürümde **otomatik ekran yeniden dağıtımı yok**: ekran offline olursa sistem kalan hedefin diğer ekranlara dağıtımını **önerir**, admin onayıyla uygulanır; aksi halde yalnız uyarı.
- Underpacing → `UNDERPACING` ops uyarısı + bildirim.

### 9.5 Pricing ve revenue engine

| Model | Formül / mantık |
|---|---|
| CPM | Revenue = estimated_impressions / 1000 × CPM |
| CPP | Revenue = successful_playouts × CPP |
| FIXED | Sözleşmeli sabit tutar; teslimat ayrı izlenir |
| PG | Fixed CPM × (contracted **ya da** delivered miktar) — `pg_billing_basis` ile seçilir |

Revenue share: medya sahibi / Protarget oranları kampanya ya da inventory-owner bazında saklanır; buyer-facing portalda opsiyonel olarak gizlenir. Para birimi: **TRY + USD**. Vergi gösterim kuralı açık iş kararıdır — vergi hesabı yapma, ayar yeri bırak.

### 9.6 Raporlama metrikleri (hepsini hesapla)

| Metrik | Tanım |
|---|---|
| Playouts | Başarılı PoP sayısı |
| Estimated Impressions | PoP × geçerli multiplier toplamı |
| Delivery % | Delivered impressions / guaranteed impressions |
| Pacing | Gerçekleşen teslimat vs beklenen teslimat eğrisi |
| Spend | Pricing modeline ve sözleşmeli miktara göre |
| eCPM | Spend / estimated impressions × 1000 |
| CPP | Spend / playouts |
| Screen Uptime | Heartbeat tabanlı online oranı |
| Missed Playouts | Planlanmış ama başarıyla oynatılmamış |
| Discrepancy | Protarget impression vs dış connector/DSP raporu farkı |

### 9.7 External delivery / discrepancy

| Metrik | Formül |
|---|---|
| Internal Impressions | İç impression event'lerinin toplamı |
| External Impressions | Connector/DSP raporu |
| Absolute Difference | External − Internal |
| Discrepancy % | (External − Internal) / Internal × 100 |

İç değerlerin üzerine yazma. Admin görünümü ikisini de gösterir (mutabakat); agency portalı yalnızca ticari olarak kararlaştırılan tanımı gösterir (ayar).

---

## 10. Deal servisi ve connector katmanı (kritik)

### 10.1 Deal iç modeli

| Alan | Örnek | Kural |
|---|---|---|
| internal_deal_id | PTR-2026-00124 | Protarget üretir, UNIQUE |
| campaign_id | CMP-104 | 1 kampanyanın bir ya da daha fazla deal'i olabilir |
| deal_type | PG | Enum: PMP / Preferred / PG / Direct |
| connector | GAM | Enum / konfigüre edilebilir: Manual / GAM / SSP-X / future |
| seller_platform | GAM / SSP-X | |
| buyer_dsp | DV360 | |
| buyer_seat_id | 123456 | Connector'a özgü; opsiyonel/zorunlu connector belirler |
| currency | USD | |
| cpm (floor / fixed) | 12.00 | |
| guaranteed_impressions | 1500000 | |
| start / end | 10–30 Kas 2026 | |
| inventory_scope | Selected screens / package | |
| external_deal_id | ABC123 | Dış sistemden döner; manual modda admin girer/düzenler |
| external_status | ACCEPTED | Eşlenmiş durum |
| last_synced_at | timestamp | |
| raw_external_status | string/json | Teşhis için |

Deal nesnesi, Protarget kampanyası ile dış programmatic sistemdeki gerçek deal arasında **soyutlama katmanıdır**. İlk sürüm manuel External Deal ID ile çalışır; connector'lar sonradan otomatik deal oluşturur.

### 10.2 Connector arayüzü (birebir bu metotlar)
```ts
interface DealConnector {
  validateConnection(): ConnectionStatus
  createDeal(input: CreateDealInput): CreateDealResult
  getDeal(externalDealId: string): ExternalDeal
  updateDeal(externalDealId: string, changes: UpdateDealInput): UpdateDealResult
  pauseDeal(externalDealId: string): ActionResult
  resumeDeal(externalDealId: string): ActionResult
  fetchDelivery(externalDealId: string, from: datetime, to: datetime): ExternalDeliveryReport
}
```
- Adapter pattern + registry; connector seçimi konfigürasyonla. Core servisler yalnızca arayüzü bilir.
- **ManualConnector** aynı arayüzü uygular; `createDeal` yalnızca admin'in girdiği external Deal ID'yi saklar.
- **MockConnector** (sandbox): başarı, gecikmeli kabul, hata ve status mismatch senaryolarını deterministik simüle eder; test ve pilot için.
- **GamConnector**: yalnızca **iskelet** — arayüzü uygular, gerçek çağrılar `NotConfigured` döner; hangi GAM Programmatic Direct API uçlarına bağlanacağı `docs/CONNECTORS.md` içinde planlanır. İlk gerçek partner (GAM mi, bir pDOOH SSP/exchange mi) **açık iş kararıdır**; gerçek hesap/kimlik bilgisi olmadan canlı entegrasyon yazma.
- Tüm request/response payload'ları **secret/token alanları redakte edildikten sonra** `deal_sync_logs` içine yazılır.
- Connector hatası → `DEAL_SYNC_FAILED` (Critical); iç/dış durum çelişkisi → `DEAL_STATUS_MISMATCH` (Warning, "Resync").
- Connector başarısız olduğunda iç kampanya **konfigürasyona göre** devam eder; uyarı gösterilir.

### 10.3 GAM konumlandırması (koda ve dokümana yansıt)

| Kullanım | Karar |
|---|---|
| Programmatic Direct / proposal / PG workflow | Connector olarak değerlendirilebilir |
| Buyer DV360 deal orchestration | Uygun deal yolunda kullanılabilir; buyer/exchange uyumluluğu doğrulanmalı |
| Screen player / signage CMS | **Kullanılmaz** — Protarget platformunun görevi |
| PoP source of truth | **Kullanılmaz** — Protarget PoP servisi |
| Audience multiplier | Protarget engine'de tutulur |
| Evrensel pDOOH SSP varsayımı | **Varsayılmaz** — exchange/SSP eligibility ayrıca doğrulanır |

Not: GAM Programmatic Direct API proposal oluşturma ve müzakereyi destekler; DV360 PG akışında publisher/exchange'in sağladığı Deal ID buyer tarafında kullanılır, publisher pacing'i kontrol eder. Deal ID'nin hangi sistem tarafından üretileceği partner hesabı bazında doğrulanacaktır. Referanslar: IAB Tech Lab OpenRTB (https://iabtechlab.com/standards/openrtb/), GAM API Programmatic Direct (https://developers.google.com/ad-manager/api/programmatic), DV360 PG deals (https://support.google.com/displayvideo/answer/7067656).

---

## 11. Admin paneli

### 11.1 Navigasyon (birebir)
```
ADMIN
├── Dashboard
├── Inventory
│   ├── Venues
│   ├── Screens
│   ├── Player Health
│   └── Multipliers
├── Campaigns
│   ├── All Campaigns
│   ├── Create Campaign
│   └── Creatives
├── Deals
│   ├── All Deals
│   └── Connectors
├── Reporting
│   ├── Campaign Delivery
│   ├── Screen Delivery
│   ├── Revenue
│   └── Discrepancy
├── Organizations
│   ├── Agencies
│   ├── Advertisers
│   └── Users
└── Settings
    ├── Pricing
    ├── Player
    ├── Notifications
    └── Audit Log

AGENCY / ADVERTISER
├── Dashboard
├── Campaigns
│   └── Campaign Detail
├── Deals
└── Reports
```

Admin modülleri ve aksiyonları: **Screens** (create/edit/deactivate, player mapping, health, multiplier) · **Campaigns** (create/edit/launch/pause/resume/complete) · **Creatives** (upload/validate/approve/replace) · **Scheduling** (daypart, screen selection, frequency/playout plan) · **Deals** (internal deal oluştur, connector seç, gönder, durum izle) · **Users** (ajans/marka davet, org/kampanya yetkisi) · **Reporting** (delivery, revenue, discrepancy, export) · **Operations** (player health, errors, missed playouts) · **Audit** (kim neyi ne zaman değiştirdi).

### 11.2 Admin Dashboard
Yalnızca operasyonel özet; ağır CRUD ilgili modüllerde.

| Widget | İçerik | Tıklama |
|---|---|---|
| Live Campaigns | Sayı + underpacing sayısı | Filtreli kampanyalar |
| Online Screens | Online / toplam + eşik üstü offline | Player health |
| Today Playouts | Başarılı / başarısız | Delivery raporu |
| Today Estimated Impressions | Bugünkü toplam | Delivery raporu |
| Delivery Risk | Beklenen pacing altındaki kampanyalar | Filtreli liste |
| Deal Status | Sent / Accepted / Active / Error | Deals |
| Player Errors | Son 24 saat kritik hatalar | Error log |
| Revenue Today / MTD | İç revenue metriği | Revenue raporu |

Filtre çubuğu: tarih preset'i (Today / Yesterday / Last 7 days / This Month / Custom) · Agency · Advertiser · Campaign status · Venue / City.

### 11.3 Inventory > Venue formu

| Alan | Tip | Zorunlu | Validasyon / not |
|---|---|---|---|
| Venue Name | Text | Evet | 2–120 karakter |
| Venue Type | Select | Evet | mall, metro, ferry, airport, street, office, other |
| Country | Select | Evet | Varsayılan Turkey |
| City | Text/Select | Evet | |
| District | Text | Hayır | |
| Latitude | Decimal | Hayır | −90..90 |
| Longitude | Decimal | Hayır | −180..180 |
| Timezone | Select | Evet | Varsayılan Europe/Istanbul |
| Owner Organization | Select | Hayır | İleride media-owner desteği |
| Active | Boolean | Evet | Varsayılan true |
| Notes | Textarea | Hayır | Maks 2000 karakter |

Aksiyonlar: **Save**, **Save & Add Screen**, **Cancel**.

### 11.4 Inventory > Screen formu

| Bölüm | Alan | Tip | Zorunlu | Kural |
|---|---|---|---|---|
| Identity | Screen ID | Text | Evet | Unique; **ilk live kampanyadan sonra değiştirilemez** |
| Identity | Screen Name | Text | Evet | |
| Identity | Venue | Select | Evet | |
| Display | Resolution Width | Integer | Evet | > 0 |
| Display | Resolution Height | Integer | Evet | > 0 |
| Display | Orientation | Select | Evet | Landscape / Portrait |
| Display | Physical Size | Text | Hayır | İnsan-okur |
| Playback | Player Type | Select | Evet | Protarget Player / External Signage |
| Playback | Loop Length (sec) | Integer | Evet | > 0 |
| Playback | Default Slot Length | Integer | Evet | örn. 10 |
| Playback | Operating Start | Time | Evet | |
| Playback | Operating End | Time | Evet | |
| Commercial | Default Floor CPM | Decimal | Hayır | ≥ 0 |
| Commercial | Default Floor CPP | Decimal | Hayır | ≥ 0 |
| Audience | Active Multiplier | Read-only | Hayır | En güncel geçerli profilden bağlanır |
| Programmatic | External Inventory ID | Text | Hayır | Connector başına eşleme |
| Status | Active | Boolean | Evet | |

Ek olarak ekran kaydında tutulacak alanlar (PRD): owner, location label, country/city/district/lat/lon (venue'den), aspect ratio, OS, daily operating hours, direct rate, revenue share, multiplier source + confidence note, online/offline, last heartbeat, last playback, external inventory id(ler), SSP/GAM mapping, deal eligibility.

Screen detay sayfası sekmeleri: **Overview / Campaigns / Player Health / Multipliers / Delivery / External Mappings**.

### 11.5 Player Health ekranı

| Kolon | Tanım |
|---|---|
| Screen | Ad + ID |
| Status | Online / Warning / Offline |
| Last Heartbeat | Timestamp |
| Player Version | Semantic version |
| Disk Free | % ya da GB |
| Current Manifest | Versiyon / timestamp |
| Last Successful Playback | Timestamp |
| Last Error | Kod / kısa mesaj |
| Actions | View logs / Force manifest refresh / Disable screen |

### 11.6 Multiplier yönetimi formu

| Alan | Tip | Zorunlu | Not |
|---|---|---|---|
| Screen | Select | Evet | |
| Multiplier Value | Decimal | Evet | > 0 |
| Source Type | Select | Evet | Camera / Municipality / Sensor / Manual Verified / Third Party |
| Source Reference | Text | Evet | Kaynak adı ya da rapor referansı |
| Valid From | Datetime | Evet | |
| Valid To | Datetime | Hayır | Null = açık uçlu |
| Daypart Start | Time | Hayır | |
| Daypart End | Time | Hayır | |
| Weekdays | Multi-select | Hayır | Hafta içi / hafta sonu profili |
| Confidence Note | Textarea | Hayır | |
| Approval Status | Select | Evet | Draft / Approved |
| Approved By | Otomatik | Koşullu | Approved olduğunda |

Versiyon geçmişi (kim girdi / kim onayladı) ekranda görünür.

### 11.7 Campaign Create Wizard — 6 adım (tek uzun form değil)

| Adım | Ekran | Amaç |
|---|---|---|
| 1 | Basics | Kimlik, advertiser, agency, flight |
| 2 | Inventory | Manuel ekran seçimi |
| 3 | Commercial | Pricing, target, guarantee, budget |
| 4 | Creative | Creative yükle/seç |
| 5 | Schedule | Daypart ve playout kuralları |
| 6 | Deal & Review | Deal ayarları, özet, launch hazırlığı |

Her adımda taslak kaydedilir; kampanya DRAFT olarak kalır.

**Adım 1 — Basics**

| Alan | Tip | Zorunlu | Validasyon |
|---|---|---|---|
| Campaign Name | Text | Evet | Unique zorunlu değil, 3–150 karakter; ajans portalında görünür |
| Advertiser | Select | Evet | |
| Agency | Select | Hayır | Direct advertiser olabilir |
| Internal Owner | User select | Evet | Protarget sahibi |
| Start DateTime | Datetime | Evet | End'den küçük olmalı |
| End DateTime | Datetime | Evet | Gelecek ya da aynı gün olabilir |
| Timezone | Select | Evet | Varsayılan Europe/Istanbul |
| Campaign Notes | Textarea | Hayır | |

**Adım 2 — Inventory** (Admin ekranları manuel seçer; V1'de auto-buy yok)

Filtreler: City (multi) · Venue Type (multi) · Venue (multi) · Orientation (Landscape / Portrait) · Resolution · Online Status (Online only / All) · Multiplier Range (Min / Max) · Availability (Conflict-free / All).

Seçim grid kolonları: Checkbox · Screen name / ID · Venue / city · Resolution / orientation · Current multiplier · Operating hours · **Kampanya flight'ında tahmini kullanılabilir playout** · Conflict indicator.

Sağ özet paneli: seçili ekran sayısı, tahmini kullanılabilir playout kapasitesi, kaba impression kapasitesi. Grid **en az 100 ekranla** akıcı çalışmalı (server-side pagination/filtre, toplu seçim).

**Adım 3 — Commercial**

| Alan | Tip | Zorunlu | Kural |
|---|---|---|---|
| Pricing Model | Select | Evet | CPM / CPP / FIXED / PG |
| Currency | Select | Evet | TRY / USD |
| Unit Price | Decimal | Koşullu | CPM/CPP/PG |
| Budget | Decimal | Opsiyonel | |
| Guaranteed Impressions | Integer | Koşullu | Impression garantili PG için zorunlu |
| Target Playouts | Integer | Opsiyonel | CPP/direct kullanılıyorsa zorunlu |
| Overdelivery Tolerance | Percent | Evet | Varsayılan %1 |
| Publisher/Media Owner Share | Percent | İç | Opsiyonel |
| Protarget Share | Percent | İç | Opsiyonel |

Validasyon: ikisi de kullanılıyorsa `publisher_share + protarget_share = 100%` · PG için `guaranteed_impressions` **ya da** sözleşmeli sabit teslimat miktarı · CPM için `unit_price > 0` · FIXED için sözleşmeli tutar.

**Adım 4 — Creative**

| Alan | Kural |
|---|---|
| File | V1: MP4/H.264; JPG/PNG opsiyonel (destekle) |
| Duration | İzinli slot süresiyle eşleşmeli (örn. 10/15/20 sn) ya da admin override; varsayılan creative süresi 10 sn, kampanya override edebilir |
| Resolution | Seçili ekran profillerinden en az biriyle eşleşmeli |
| Aspect Ratio | Uyuşmazlıkta uyarı |
| Checksum | Server-side üretilir (sha256) |
| Approval | Launch'tan önce Approved olmalı |

Creative yönetimi kuralları: MIME + antivirüs doğrulaması · çözünürlük/aspect ratio doğrulaması (ffprobe) · süre doğrulaması · checksum ve **versiyonlama** · durumlar UPLOADED → VALIDATING → APPROVED / REJECTED · player cache URL'leri signed ve süreli · creative değişikliği campaign audit log'a yazılır (eski/yeni creative ID) · preflight validation + test playback.

**Adım 5 — Schedule**

| Alan | Seçenek |
|---|---|
| Days | Pzt–Paz |
| Start/End Time | Daypart başına |
| Frequency Rule | Ekran başına saatlik maks playout (opsiyonel) |
| Priority | Low / Normal / High / Guaranteed |
| Distribution | Even / Manual weights |

Manual weights modunda admin ekran başına allocation weight girer; toplam %100'e normalize edilir.

**Adım 6 — Deal & Review**

| Alan | Tip | Not |
|---|---|---|
| Deal Required | Boolean | Fixed/direct internal-only için Hayır |
| Deal Type | Select | PMP / Preferred / PG / Direct |
| Connector | Select | Manual / GAM / SSP-X / future |
| Buyer DSP | Select/Text | DV360 vb. |
| Buyer Seat ID | Text | Connector'a göre opsiyonel/zorunlu |
| Floor / Fixed CPM | Decimal | |
| External Deal ID | Read-only | Gönderim sonrası; manual modda admin düzenleyebilir |
| Deal Status | Read-only | Draft/Sent/Negotiating/Accepted/Active/… |

Review sayfası şunların **hepsini** gösterir: seçili tüm ekranlar, creative, flight, ticari şartlar, beklenen impression ve **launch blocker'ları**.

### 11.8 Campaign Detail ekranı
Sekmeler: **Overview / Inventory / Creative / Schedule / Delivery / Deal / Activity**.

| Overview kartı | İçerik |
|---|---|
| Status | Draft / Ready / Live / Paused / Completed / Cancelled (+ ara durumlar) |
| Flight | Start – End |
| Advertiser / Agency | Adlar |
| Screens | Sayı |
| Target | Impression ve/veya playout |
| Delivered | Impression + playout |
| Pacing | % + durum |
| Spend / Revenue | Görünürlük ayarlarına göre |
| Deal | Tip + external Deal ID + durum |

Activity sekmesi kampanyanın audit geçmişini gösterir.

### 11.9 Launch validation kuralları
Launch butonu, tüm blocker'lar geçene kadar **disabled**. `POST /campaigns/{id}/validate` aynı listeyi döner.

| Kontrol | Blocker? | Mesaj |
|---|---|---|
| En az 1 seçili ekran | Evet | Select at least one screen. |
| Approved creative var | Evet | Campaign has no approved creative. |
| Geçerli flight | Evet | Campaign dates are invalid. |
| Seçili ekranlarda multiplier var | Impression bazlı kampanyada Evet | Missing multiplier on X screens. |
| Schedule çalışma saatleriyle kesişiyor | Evet | No valid playback window. |
| Creative süresi uyumlu | Evet | Creative duration incompatible with screen slot. |
| Deal active/accepted | Konfigüre edilebilir | Deal not ready; launch anyway? |
| Player online | Uyarı | X screens currently offline. |

(Mesajlar i18n anahtarıdır; TR çevirileri de sağlanır.)

### 11.10 Pause / Resume — birebir davranış
Pause kritik bir **çift operasyondur**:
1. Admin Pause'a tıklar.
2. Kampanya durumu **hemen** `PAUSING` olur.
3. Scheduler kampanyayı yeni üretilen manifest'lerden çıkarır.
4. Aktif player'lar yeni manifest'i sonraki poll'da ya da push bildirimiyle alır.
5. Connector worker, destekleniyor ve etkinse `pauseDeal()` çağırır (dış deal / inventory availability pause).
6. Player manifest dağıtımı + connector operasyonu tamamlanınca durum `PAUSED` olur. ("Dağıtım tamamlandı" = etkilenen tüm ekranlar için yeni manifest versiyonu üretildi; offline player'ların onayı beklenmez, ekran bazlı manifest acknowledgement ayrıca gösterilir.)
7. Connector başarısız olursa durum `PAUSED_WITH_EXTERNAL_ERROR` olur ve admin uyarı görür.

Resume bunun aynasıdır. Audit log: kullanıcı, timestamp, önceki durum, yeni durum ve **connector sonucu**.

---

## 12. Agency / Advertiser read-only portalı

Amaç operasyon yetkisi vermek değil; **şeffaflık ve takip**.

**Dashboard kartları:** Active Campaigns (sayı) · Delivered Impressions (bu ay / seçili aralık) · Playouts (bu ay) · Spend (organizasyon için etkinse) · Upcoming Campaigns (sayı) · Deals Pending Acceptance (sayı). Ayrıca: delivery %, upcoming/completed.

**Kampanya listesi kolonları:** Campaign · Advertiser · Flight · Status · Deal Type · DSP · Delivered / Target · Pacing · View.

**Campaign Detail (strictly read-only):**

| Bölüm | Alanlar |
|---|---|
| Header | Kampanya adı, advertiser, agency, status, flight |
| Delivery | Target impressions, delivered impressions, delivery %, playouts, pacing, günlük trend, ekran kırılımı |
| Commercial | CPM/CPP, pricing, target; görünürse spend |
| Deal | Deal type, DSP, external Deal ID, external status, CPM, guaranteed qty, **Copy Deal ID** |
| Screens / Inventory | Screen, venue, city/location, multiplier (+ source type), playouts, impressions, screen health özeti |
| Daily Trend | Tarih, playout, impressions, spend |
| Creative | Önizleme, süre, dosya adı, approval status |
| Reports | Gün/ekran/kampanya bazında CSV/PDF indirme |

**Deals sayfası:** kullanıcının kapsamındaki deal'ler (type, DSP, external Deal ID, status, CPM, guaranteed qty).

Kurallar: Edit butonu yok. Agency rolünün erişebildiği gizli mutation rotası yok. Spend ve revenue share görünürlüğü organizasyon bazında ayarlanır (varsayılan: spend kapalı, revenue share kapalı). Portal rakamları iç raporla **birebir tutmalı**.

---

## 13. Organizasyon ve kullanıcı yönetimi

| Varlık | Alanlar |
|---|---|
| Agency Organization | name, tax/legal label (opsiyonel), active |
| Advertiser Organization | name, brand name, active |
| User | name, email, organization_id, role, active, last_login |
| Campaign Permission | user/org → campaign görünürlük eşlemesi |

Admin ajans/marka kullanıcısı **davet eder** (e-posta ile, parola belirleme linki), org ve kampanya yetkisi atar. Rol/kapsam değişikliği audit'lenir.

---

## 14. Bildirimler (V1: e-posta; in-app opsiyonel)

| Tetik | Alıcı | Mesaj |
|---|---|---|
| Campaign launched | Admin owner + (opsiyonel) agency | Campaign is live |
| Campaign underpacing | Admin owner | Delivery below threshold |
| Screen offline | Ops admin | Screen offline > threshold |
| Deal created/sent | Admin | External deal sync status |
| Deal accepted/active | Admin + (opsiyonel) agency | Deal ready/active |
| Creative validation failed | Admin owner | Creative rejected |
| Campaign completed | Admin + agency | Final delivery available |

"Opsiyonel" alıcılar Settings > Notifications'tan açılır/kapanır. Şablonlar TR + EN.

---

## 15. Audit log

Her ticari ya da operasyonel mutation audit'lenir. **Append-only / immutable**; normal uygulama API'si ile düzenlenemez/silinemez.

| Aksiyon | Loglanacak |
|---|---|
| Campaign edit | before_json, after_json, user, timestamp |
| Pause/Resume | Durum geçişi + connector sonucu |
| Multiplier change | Eski profil + yeni profil |
| Screen mapping change | Eski/yeni external mapping |
| Creative replace | Eski/yeni creative ID |
| Deal update | Internal + external ID, request/response durumu |
| User permission change | Eski/yeni rol ya da kapsam |
| Campaign reopen | Kim, ne zaman, neden |

Settings > Audit Log ekranı: filtre (kullanıcı, entity, aksiyon, tarih), before/after diff görünümü.

---

## 16. Hata kodu kataloğu (`packages/shared` içinde enum; hepsi uygulanır)

| Kod | Seviye | Anlam | Admin aksiyonu |
|---|---|---|---|
| PLAYER_OFFLINE | Warning | Heartbeat yok | Cihaz/ağ kontrol |
| CREATIVE_DOWNLOAD_FAILED | Critical | Player asset'i çekemiyor | Retry / CDN kontrol |
| CREATIVE_CHECKSUM_MISMATCH | Critical | İndirilen dosya geçersiz | Asset'i geçersiz kıl / yeniden yükle |
| POP_DUPLICATE | Info | Tekrarlı event_id | Aksiyon yok |
| MISSING_MULTIPLIER | Critical | Impression hesaplanamıyor | Geçerli multiplier profili oluştur |
| DEAL_SYNC_FAILED | Critical | Connector API hatası | Retry / connector logunu incele |
| DEAL_STATUS_MISMATCH | Warning | İç/dış durum çelişkisi | Resync |
| UNDERPACING | Warning | Teslimat eğrinin gerisinde | Schedule/ekran dağılımını ayarla |
| SCREEN_CONFLICT | Warning | Kapasite çakışması | Scheduling'i gözden geçir |
| UNAUTHORIZED_PORTAL_ACCESS | Security | Rol yetkisiz kaynağa erişmeye çalıştı | Logla / güvenlik incelemesi |

Her hata Operations ekranında görünür; önerilen admin aksiyonu UI'da gösterilir.

---

## 17. Raporlama ve export

CSV export kolonları — campaign delivery (birebir bu sıra):
```
date,campaign_id,campaign_name,screen_id,screen_name,venue,city,
playouts,multiplier,estimated_impressions,pricing_model,unit_price,
estimated_spend,deal_id,deal_status
```
- Kampanya **ve** ekran bazında CSV export. Gün / ekran / kampanya kırılımı.
- CSV toplamları veritabanı toplamlarıyla **mutabık** olmalı (test edilir).
- Final PDF raporu: kampanya özeti · flight ve deal detayları · toplam playout / estimated impressions / spend · günlük teslimat grafiği · teslimata göre en iyi ekranlar · ekran bazlı tablo · **metodoloji notu** (multiplier kaynağı ve "estimated impression" tanımı).
- Büyük export'lar arka plan işi olarak üretilir; hazır olunca indirilir.
- Admin raporları: Campaign Delivery, Screen Delivery, Revenue, Discrepancy.
- Scoped kullanıcı yalnızca kendi kampanyasının raporunu alabilir; spend kolonları görünürlük ayarına uyar.

---

## 18. Arka plan işleri

| İş | Sıklık | Amaç |
|---|---|---|
| Manifest builder | Değişiklikte + periyodik | Güncel ekran schedule'larını üret |
| Pacing calculator | 5–15 dk | Pacing durumunu güncelle |
| Deal sync | 5–15 dk | Dış durum/teslimatı çek |
| Daily aggregation | Saatlik/günlük | Raporlama performansı |
| Offline screen detector | 1–2 dk | Health uyarıları |
| Creative cleanup | Günlük | Süresi dolmuş geçici asset'leri sil |
| Report generation | İstek üzerine | PDF/CSV |
| Campaign completer | Dakikalık | `end_at` geçen kampanyayı COMPLETED yap |
| Impression processor | Event-driven | PoP → impression event |

İşler idempotent ve yeniden denenebilir olmalı; sıklıklar Settings/env ile ayarlanır.

---

## 19. Güvenlik

- Her yerde HTTPS (prod'da zorunlu; HSTS).
- Admin için **MFA** (TOTP) — etkinleştirilebilir, akışı test edilir.
- RBAC + `organization_id` üzerinden zorunlu veri izolasyonu.
- Player auth: rotatable device credential; yalnız hash saklanır.
- Creative indirmeleri için signed, süreli URL.
- Secret'lar environment / secret manager'da.
- Audit log immutable/append-only.
- API rate limiting (login ve player uçlarında ayrı limitler).
- Dosya upload: antivirüs + MIME/magic-byte doğrulaması + boyut limiti.
- Veritabanı yedeği: günlük otomatik + **test edilmiş restore** (`infra/backup.sh`, `infra/restore.sh`, `docs/BACKUP_RESTORE.md`).
- Parolalar argon2/bcrypt; refresh token rotasyonu; logout'ta iptal.

**Zorunlu güvenlik testleri (otomatik):**
1. Agency A, URL'deki ID'yi değiştirerek Agency B kampanyasını açamaz.
2. Advertiser POST/PATCH mutation endpoint'lerini çağıramaz.
3. Screen A'nın player token'ı Screen B için PoP gönderemez.
4. Süresi dolmuş signed creative URL indirme yapamaz.
5. Etkinse Admin MFA akışı çalışır.
6. Audit loglar normal uygulama API'siyle düzenlenemez.
7. Secret'lar frontend bundle'ında ve loglarda yoktur.

Ek: tüm mutation rotalarını otomatik tarayıp Agency/Advertiser token'ı ile her birinin `403` döndüğünü doğrulayan bir test yaz.

---

## 20. Observability ve operasyon

- Yapılandırılmış (JSON) uygulama logları, request ID korelasyonu.
- Player heartbeat izleme.
- Uyarı: ekran offline > konfigüre edilebilir eşik.
- Uyarı: kampanya underpacing.
- Uyarı: **PoP ingestion durdu** (live kampanya varken belirli süre PoP gelmiyorsa).
- Uyarı: creative download hatası.
- Uyarı: connector sync hatası / deal status mismatch.
- Admin operasyon dashboard'u: online ekranlar, live kampanyalar, delivery riski, hatalar, missed playouts.
- Sentry entegrasyon noktası + `/health` + `/metrics`.

### Non-functional hedefler (MVP)

| Gereksinim | Hedef |
|---|---|
| Admin yanıt süresi | Normal CRUD < 2 sn |
| Player manifest yanıtı | Tipik < 500 ms (ağ hariç) |
| PoP ingestion | Pilot için en az 20 event/sn; ölçeklenebilir mimari |
| Availability | Pilot hedefi %99,5 |
| PoP dayanıklılığı | 2xx onayından sonra kayıp yok |
| Backup | Günlük otomatik + test edilmiş restore |
| Log retention | Konfigüre edilebilir; varsayılan 90 gün (app logları) |
| PoP/rapor retention | İş politikası değişmedikçe en az 24 ay |
| Tarayıcı | Güncel Chrome / Edge / Safari |
| Mobil admin | Responsive ama desktop-first |

Manifest yanıt süresi ve 20 event/sn PoP ingestion için basit bir yük testi script'i (`infra/loadtest/`) ekle ve sonucu `docs/PERFORMANCE.md` içine yaz.

---

## 21. Testler

### 21.1 Fonksiyonel senaryolar (hepsi otomatik test olmalı; test adında ID geçsin)

| ID | Senaryo | Beklenen |
|---|---|---|
| T01 | Screen + multiplier + campaign + creative oluştur | Kampanya READY'ye ulaşabilir |
| T02 | Impression kampanyasını multiplier'sız launch et | Engellenir |
| T03 | Player manifest çeker | Doğru kampanya item'ı döner |
| T04 | Player başarılı PoP gönderir | Playout + impression bir kez artar |
| T05 | Aynı event_id iki kez gönderilir | Çift sayım yok |
| T06 | Player offline, sonra batch PoP | Event'ler orijinal `played_at` ile alınır |
| T07 | Admin Pause | Kampanya manifest'ten çıkar; portal paused gösterir |
| T08 | Agency edit API dener | 403 Forbidden |
| T09 | Manuel external Deal ID girilir | Agency portalında görünür |
| T10 | Connector create deal başarılı | External ID saklanır + durum senkronlanır |
| T11 | Connector başarısız | İç kampanya konfigürasyona göre devam eder; uyarı gösterilir |
| T12 | Multiplier yarın değişir | Geçmiş PoP eski multiplier'da kalır |
| T13 | Kampanya tamamlanır | Read-only + final rapor mevcut |

### 21.2 Deterministik pilot senaryosu (seed + E2E; gerçek envanterden önce)

| Kalem | Pilot değeri |
|---|---|
| Venue | Demo Mall |
| Screens | 3 |
| Multiplier | Screen A = 50, B = 75, C = 100 |
| Creative | 10 sn MP4 |
| Campaign | Demo Brand - November |
| Flight | 7 gün |
| Pricing | PG, fixed CPM |
| Guaranteed Impressions | 100.000 |
| Deal | Başlangıçta manuel external Deal ID |
| Agency User | Read-only demo ajansı |

`pnpm seed:pilot` bu veriyi kurar; `pnpm pilot:run` üç simüle player ile senaryoyu koşturur ve şunları **doğrular**:
- Creative 3 test player'ın hepsine ulaşır.
- PoP'lar duplicate olmadan döner.
- Estimated impressions, multiplier bazlı beklenen toplamlara eşittir.
- Pause teslimatı durdurur.
- Agency portalı iç raporla eşleşir.
- CSV export veritabanı toplamlarıyla mutabıktır.

### 21.3 MVP kabul kriterleri (bitmeden önce tek tek kontrol et ve `docs/ACCEPTANCE.md` içinde kanıtıyla işaretle)
1. Admin en az **100 ekranı** sisteme ekleyebilir ve kampanyaya manuel seçebilir (100 ekranlık seed + test).
2. Her ekran için multiplier ve kaynak bilgisi versiyonlu tutulur.
3. Admin MP4 creative yükleyip belirli ekran/tarih/saat aralığına atayabilir.
4. Player manifest'i çekip creative'i oynatır ve PoP gönderir.
5. Offline player PoP'ları bağlantı geri geldiğinde kayıpsız gönderir.
6. Başarılı PoP otomatik estimated impression üretir.
7. Admin pause ettiğinde player sonraki manifest'te yayını durdurur.
8. Agency user kendi kampanyasında screen, playout, impression, pacing, Deal ID ve status görür.
9. Agency user hiçbir campaign control aksiyonuna erişemez.
10. Admin manuel external Deal ID girebilir.
11. Connector interface kod seviyesinde hazırdır; ilk partner sonradan takılabilir.
12. Tüm kritik değişiklikler audit log üretir.
13. Campaign ve screen bazında CSV export alınır.

---

## 22. Doküman teslimleri (`/docs`)

### 22.1 "Developer handoff complete" çıktıları
- `ARCHITECTURE.md` — teknik mimari diyagramı (Mermaid): Agency/Advertiser Browser → Read-Only Portal → API Gateway/Auth → Campaign Service / Reporting Service → Scheduler/Ad Server → Player Delivery API → Screen Player → PoP Service → Multiplier/Impression Engine → Core DB → Deal Service / Revenue Engine → Connector Layer → GAM / SSP / Other Exchange → Buyer DSP (DV360 vb.). Deployment topolojisi: CDN/WAF → Web App (Admin + Agency Portal) → API Service (PostgreSQL, Redis/Queue, Object Storage, Reporting Worker) → Player API → Screen Players → Connector Workers (GAM, SSP/Exchange, gelecekteki DSP/measurement API'leri).
- `ERD.md` — veritabanı ERD'si (Mermaid).
- `WIREFRAMES.md` — ekran listesi + gerçek uygulamanın ekran görüntüleri/akışları (tıklanabilir prototip yerine çalışan UI).
- `openapi.json` — API spesifikasyonu.
- `SPRINT_PLAN.md` — sprint/task tahmini (aşağıdaki 10 sprint'e göre, gerçekleşenle birlikte).
- `INFRASTRUCTURE.md` — altyapı önerisi, dev/staging/production ayrımı, tahmini aylık maliyet.
- `PLAYER_DESIGN.md` — referans player tasarımı + Player API entegrasyon rehberi (mevcut signage player'a SDK/API gömme senaryosu dahil).
- `CONNECTORS.md` — connector implementasyon planı (yeni connector nasıl eklenir; GAM ve pDOOH SSP planı; eligibility doğrulama adımları).
- `PILOT_DEPLOYMENT.md` — pilot yayın planı (gerçek ekranlarda).
- `RISKS.md` — risk ve bağımlılık listesi (aşağıdaki tablo + kod tarafındaki karşılığı).
- `OPENRTB_MAPPING.md`, `BACKUP_RESTORE.md`, `PERFORMANCE.md`, `ACCEPTANCE.md`, `ASSUMPTIONS.md`, kök `README.md` (kurulum, komutlar, demo hesapları).

Risk tablosu (her birinin mitigasyonu kodda uygulanmış olmalı):

| Risk | Mitigasyon |
|---|---|
| Ekran internet kesintisi | Local cache + offline PoP kuyruğu |
| Çift sayılan PoP | `event_id` idempotency unique constraint |
| Multiplier tartışması | Source + version + validity + audit trail |
| DSP discrepancy | İç PoP/impression ile dış rapor ayrı tutulur; discrepancy metriği |
| Connector bağımlılığı | Adapter pattern; core partner-agnostic |
| Player saat sapması | NTP + server timestamp doğrulaması |
| Creative uyumluluğu | Preflight validation + test playback |
| Under-delivery | Pacing uyarıları + admin redistribution |
| Agency veri sızıntısı | Sıkı organization scoping + authorization testleri |
| Vendor lock-in | GAM/SSP'ye özgü mantık connector dışında yok |

### 22.2 Geliştiricinin yanıtlaması gereken 12 soru
`docs/DEVELOPER_ANSWERS.md` içinde her birini bu projede yaptığın seçimle yanıtla:
1. Önerilen backend/frontend stack ve nedeni?
2. Referans player hangi OS/teknoloji ile?
3. Mevcut signage player varsa entegrasyon API/SDK mı, ayrı player mı?
4. Beklenen pilot ekran sayısı ve tepe PoP hacmi varsayımları?
5. Connector katmanı hangi design pattern ile?
6. Background queue/job teknolojisi?
7. Cloud hosting önerisi ve tahmini aylık altyapı maliyeti?
8. Authentication/MFA yaklaşımı?
9. Creative'ler için dosya/CDN yaklaşımı?
10. Development + staging + production ortamları nasıl ayrılacak?
11. Monitoring/alerting stack?
12. İlk connector için hangi dış API dokümantasyonu gerekiyor?

### 22.3 Açık iş kararları — kod yazmayı engellemez; ayar olarak uygula

| Karar | Sahibi | Bu görevdeki varsayılan |
|---|---|---|
| İlk pDOOH SSP/exchange connector'ı | Protarget | Manual + Mock; gerçek connector yok |
| GAM'in kesin rolü / eligibility | Protarget + partner | GAM iskelet connector, doğrulama bekliyor |
| Pilot player donanımı/OS | Protarget + Developer | Chromium kiosk / Electron (Android/Windows/Linux'a taşınabilir) |
| Multiplier veri kaynağı sözleşmesi | Protarget | `source_type` enum + serbest `source_reference` |
| Agency portal spend görünürlüğü | Protarget | Org bazında ayar, varsayılan kapalı |
| Revenue share görünürlüğü | Protarget | Org bazında ayar, varsayılan kapalı |
| Para birimi ve vergi gösterim kuralları | Protarget | TRY + USD; vergi hesabı yok |
| Media owner portalı zamanlaması | Protarget | MVP sonrası (yalnız `media_owner` org tipi ve `owner_org_id` alanı hazır) |

Kodlamadan önce Protarget'tan beklenen kararların önerilen varsayılanları (uygula): birincil para birimi TRY + USD · varsayılan timezone Europe/Istanbul · varsayılan creative süresi 10 sn (kampanya override edebilir) · multiplier granülerliği ekran seviyesi + opsiyonel daypart · pricing modelleri CPM, CPP, FIXED, PG · buyer portal kontrolü strict read-only · ekran seçimi Protarget tarafından manuel · media owner portalı V1 dışı · otomatik kamera audience ingestion V2+.

---

## 23. Uygulama sırası (fazlar, sırayla)

| Faz | Teslim | Definition of Done |
|---|---|---|
| **0 — Foundation** | Repo, environment, PostgreSQL + migration altyapısı, auth, organizations/users/roles/RBAC, audit log, i18n iskeleti, hata zarfı, docker-compose | Admin login olur; ajans izolasyonu çalışır (test) |
| **1 — Inventory** | Venue/screen/player/multiplier veri modeli + CRUD + admin inventory ekranları + Player Health | Admin ekran oluşturur ve health görür |
| **2 — Campaign** | Campaign + campaign_screens + creatives + schedules; 6 adımlı wizard; creative upload/validation/approval; launch validation | Admin eksiksiz bir kampanya kurar (T01, T02) |
| **3 — Player** | register/heartbeat/manifest API; manifest builder; referans player + simülatör; cache; PoP endpoint + idempotency; offline kuyruk; batch | Test player creative'i alır ve oynatır; PoP döner (T03–T06) |
| **4 — Impression** | Event-driven multiplier/impression engine; reporting aggregation tabloları/job'ları; raporlar | PoP denetlenebilir estimated impression üretir (T04, T12) |
| **5 — Agency Portal** | Read-only kampanya/deal/delivery görünümleri; pause/resume akışının manifest'e bağlanması | Agency yalnız atanmış kampanyaları görür (T07, T08) |
| **6 — Deal Layer** | Deal entity + connector interface + ManualConnector + manuel external Deal ID akışı; deal_sync_logs | External Deal ID saklanır/izlenir (T09) |
| **7 — First Connector** | MockConnector (sandbox) + GamConnector iskeleti + deal sync job + discrepancy | Create/sync deal sandbox'ta çalışır (T10, T11) |
| **8 — Production Hardening** | Pacing/alerts/notifications, monitoring, backup/restore, security testleri, MFA, rate limit, CSV/PDF export, yük testi, tüm dokümanlar | Pilot gerçek ekranlarda koşabilir; T13, pilot senaryosu ve 13 kabul kriteri geçer |

Sprint eşlemesi (`SPRINT_PLAN.md` için): S1 Foundation/Auth/Organizations → S2 Venues/Screens/Multiplier → S3 Campaign Wizard/Creative → S4 Player API + referans player → S5 PoP + Impression + Reporting → S6 Agency Portal → S7 Deals + Manual Connector → S8 First Real Connector → S9 Pacing/Alerts/Audit → S10 Pilot/QA/Deployment.

Geliştirme adımları sırası (ayrıntı): 1) Repo + environment + PostgreSQL + migration · 2) Organizations/users/roles/RBAC · 3) Venue, screen, player, multiplier modeli · 4) Admin inventory ekranları · 5) Campaign + campaign_screens + creatives + schedules · 6) Player register/heartbeat/manifest · 7) Referans player (en az MP4 cache/playback) · 8) PoP endpoint + idempotency · 9) Event-driven multiplier/impression engine · 10) Reporting aggregation · 11) Agency/advertiser read-only portal · 12) Pause/resume → player manifest · 13) Deal entity + connector interface + manuel external Deal ID · 14) İlk connector · 15) Security, monitoring, backup, error handling, production deployment.

---

## 24. Hedef deneyim (bitince bu cümle uçtan uca doğru olmalı)

Protarget Admin bir kampanya açar, ekranları manuel seçer, creative ve schedule tanımlar, multiplier/impression hedeflerini görür ve kampanyayı yayına alır. Ekran player'ları yayını Protarget platformundan alır; gerçekleşen her oynatma PoP olarak geri akar. Sistem PoP'ları multiplier ile impression'a çevirir. Aynı kampanyanın programmatic deal nesnesi, seçilen connector üzerinden buyer DSP tarafına iletilir. Ajans/marka kendi portalında kampanya, ekran, Deal ID, pacing, playout, impression ve spend'i takip eder ancak operasyona müdahale edemez. **Protarget tek kontrol noktası olarak kalır.**

---

## 25. Teslim raporu

İş bittiğinde şunları yaz: hangi fazlar tamamlandı; test sonuçları (geçen/kalan sayılar, T01–T13 ve 7 güvenlik testi tek tek); 13 kabul kriterinin durumu; pilot senaryosu çıktısı; yapılan varsayımlar; eksik ya da ertelenen her şey; sistemi ayağa kaldırma komutları ve demo hesapları.

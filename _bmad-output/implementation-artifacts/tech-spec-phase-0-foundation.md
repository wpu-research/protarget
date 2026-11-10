---
title: 'Phase 0 — Secure foundation'
type: 'feature'
created: '2026-11-10'
status: 'in-review'
baseline_commit: '9d15c72'
implementation_root: '/home/wpu/Desktop/Urunler/Protarget'
context:
  - 'docs/BUILD_PROMPT.md'
  - 'docs/ASSUMPTIONS.md'
  - 'docs/MVP_DECISIONS.md'
---

# Phase 0 — Secure foundation

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The workspace has no application. Administrators and tenant users need secure, isolated access before inventory or campaigns can exist.

**Approach:** Build the prompt's TypeScript foundation with NestJS, Next.js, Prisma/PostgreSQL, shared contracts, translations, and Docker Compose. Deliver authenticated admin and read-only tenant shells, not simulated campaign functionality.

## Boundaries & Constraints

**Always:** Tenant scope enforced in repositories; four roles (admin, agency, advertiser, support); UTC timestamps; Turkish/English dictionaries; transactional, redacted audit records; environment-only secrets; pinned dependencies and lockfile; real PostgreSQL integration tests.

**Ask First:** Changes to accepted scope, authentication model, or stack; destructive operations against existing data.

**Never:** Modify the parent repository; implement inventory, campaigns, player, billing, or connectors; claim unexecuted tests passed. Business writes require admin; authentication/session endpoints are explicitly exempt from the read-only business restriction.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Login | Active user, correct password | Protected role-specific page | Invalid/inactive user: generic 401 |
| Refresh | Unexpired unused refresh token | Rotate once atomically | Replay revokes session family; 401 |
| Logout | Active session | Revoke access and refresh session | Subsequent requests: 401 |
| Tenant read | Agency A requests own organization | Own safe fields only | Agency B identifier: 403 + security event |
| Business write | Agency, advertiser, or support | No mutation | 403, including direct API requests |
| Permission change | Admin disables user or changes role | Effective immediately | Old privilege rejected on next request |
| Invite | Admin assigns compatible organization/role | Single-use expiring invite | Invalid/expired/reused token rejected |
| Audit tampering | Application DB role updates/deletes/truncates audit | No change | Database rejects operation |

</frozen-after-approval>

## Code Map

- `apps/api/src/` — authentication, organizations, users, authorization, audit, health.
- `apps/api/prisma/` — schema, SQL migrations, environment-driven demo seed.
- `apps/web/src/app/` — login, invite acceptance, protected admin/portal/support layouts.
- `packages/shared/src/`, `packages/i18n/` — validated contracts and complete foundation dictionaries.
- `infra/`, `docs/` — runtime, verification, source material, and progress.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` — configure builds, tests, lint, and workspaces.
- [x] `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/` — organizations, users, sessions, invitations, audit, security events; constraints and restricted runtime DB role.
- [x] `packages/shared/src/index.ts`, `packages/i18n/{tr,en}.json` — role enums, validation, error envelopes, translated foundation UI.
- [x] `apps/api/src/auth/` — login/refresh/logout/me, bcrypt password hashes, hashed opaque refresh tokens, short-lived JWT access, session revocation, login limits.
- [x] `apps/api/src/{organizations,users,portal}/` — admin CRUD/invitations; scoped `/portal/organizations/:id`; validated organization-role assignments.
- [x] `apps/api/src/{common,audit}/` — fail-closed authorization, cookie-origin protection, strict DTO validation, pagination, request IDs, redaction, immutable audit writes.
- [x] `apps/web/src/app/` — functioning login/logout/invite forms, admin organization/user management, tenant identity page, support-only shell; explicit empty states.
- [x] `apps/api/src/{health,main}.ts`, `docs/openapi.json` — health/readiness and generated API contracts.
- [ ] `docker-compose.yml`, `infra/Dockerfile.{api,web}`, `.env.example`, `infra/setup-env.mjs` — API/web/PostgreSQL/Redis/Mailpit; optional MinIO/ClamAV profiles; random local credentials; migrations before readiness.
- [x] `apps/api/test/`, `apps/web/e2e/` — matrix tests, real DB authorization/immutability tests, browser flows, translation parity, secret-redaction checks.
- [x] `README.md`, `docs/{ARCHITECTURE,ASSUMPTIONS,SPRINT_PLAN,ACCEPTANCE}.md` — exact commands, setup, evidence, unfinished phases.

**Acceptance Criteria:**
- Given an initialized local environment, when Compose starts on an empty project volume, then migrations succeed and web/API health checks become ready.
- Given seeded admin and two tenant organizations, when users sign in through the browser, then each receives the correct layout and no other tenant's data.
- Given a business mutation and its audit entry, when either persistence operation fails, then neither commits.
- Given the migration role and restricted application role, when migrations and runtime tests execute, then setup succeeds but audit tampering is rejected.
- Given every implemented business-write route, when tested with all non-admin roles, then every request returns 403 without changing business data.
- Given the completed foundation, when build, typecheck, lint, unit, integration, and browser suites run, then results are recorded; failed or blocked verification prevents phase completion.

## Spec Change Log

- 2026-11-10: Kullanıcı Railway'e yayını ve geliştirmeye devamı istedi.
  Ek teslimat: `docs/RAILWAY_DEPLOYMENT.md`. Mevcut Compose kabul maddesi
  değiştirilmedi: Railway pilotunun çalışması, yerel Compose'un test edildiği
  anlamına gelmez. CR-1 düzeltmeleri ve kullanıcı logosu mevcut story üzerinde.

## Design Notes

Access and refresh cookies are HttpOnly; production requires Secure. Same-origin web/API routing plus Origin validation protects cookie-authenticated writes. A database session check makes logout and permission changes immediately effective. Invitations use Mailpit locally; no raw invitation or refresh secrets enter logs.

Tenant isolation is demonstrated on real organization records. Campaign-specific visibility tests belong to Phase 2/5; no fake campaigns are introduced here. MFA belongs to Phase 8.

## Verification

- `pnpm install --frozen-lockfile` — reproducible install after lockfile creation.
- `pnpm build && pnpm typecheck && pnpm lint` — all implemented packages pass.
- `pnpm test && pnpm test:integration && pnpm test:e2e` — foundation assertions pass.
- `docker compose up --build -d --wait` — healthy services on project-owned volumes.
- `docker compose exec api pnpm prisma migrate status` — migrations applied.
- Commit only verified Phase 0 delivery as `feat(phase-0): secure foundation`.

## Approved workspace reuse

The user selected the existing Protarget scaffold for Phase 0 on 2026-11-10. Preserve its schema and modules; extend `apps/api/src/modules/` rather than starting a duplicate application. Existing models for later phases remain inert. No other phase is included.

## Implementation checkpoint — 2026-11-10

UI/API and local tests are implemented. Build/typecheck/lint passed; 14 unit,
36 real PostgreSQL integration and 10 browser tests passed. Docker Compose
configuration validates, but daemon permission denies actual startup. See
`docs/ACCEPTANCE.md`. Save implementation for CR; do not mark the phase accepted
or fast-forward main until the required runtime verification is completed.

### Code Review Findings — Tur 1 (2026-11-10) → Sonradan Uygulanacak

Implementation commit: `eec3342`. Üç reviewer paralel ve bağımsız çalıştırıldı.
Bulgu türü: `patch`. Ayrıntılı triage ve düzeltme önerileri:
`deferred-work.md`.

| ID | Severity | Lokasyon | Düzeltme önerisi |
|---|---|---|---|
| F0-001 | High | `auth.service.ts:23–24`, web API proxy `route.ts:35–40` | Ortak proxy IP bucket yerine güvenilir ingress/istemci bazlı limit; forwarding başlıklarını körlemesine kabul etme. |
| F0-002 | Medium | `Management.tsx:112–113`, `users.service.ts:59–62` | Yalnız değişen PATCH alanlarını gönder; isim düzenlemesi pending daveti iptal etmesin. |
| F0-003 | Medium | `users.service.ts:44–45` | Pasif kurumda kullanıcı pasifleştirmesine izin ver; aktivasyon/taşımayı ayrı doğrula. |
| F0-004 | Medium | `Locale.tsx:18–19`, `AuthForms.tsx:39–45` | Dil değişiminde davet token'ı ve form state'ini koru; E2E ekle. |
| F0-005 | Medium | `package.json:10`, `infra/run-local.mjs:9–15` | Watch-mode dev komutlarını env loader üzerinden yalnız API/web için başlat. |
| F0-006 | Medium | `apps/web/src/lib/client.ts:21–22` | Web Locks olmayan durumda çapraz-sekme refresh koordinasyonu / destek sınırı. |
| F0-007 | Medium | `auth.service.ts:123–131`, `users.service.ts:106–116` | SMTP ACK timeout ile davet kabulü yarışını tutarlı bir state transition olarak ele al. |
| F0-008 | Medium | `Management.tsx:83–85` | Yeni organization props ile picker state ve has-more bilgisini senkronize et. |
| F0-009 | Medium | `docs/openapi.json:98–143`, `pagination.dto.ts:6–12` | Response/error DTO ve integer pagination schema ekle; contract testi. |
| F0-010 | Medium | `foundation.integration-spec.ts:242–258` | Mutation route keşfi ve 403 sonrası değişmeyen veri assertion'ları. |
| F0-011 | Medium | `phase0-security.unit-spec.ts:21–27` | Browser bundle/auth log sentinel-secret testleri. Gerçek sızıntı kanıtı yok. |
| F0-012 | Medium | Bu spec'teki migration status komutu, `runtime-grants.sql:6` | Migration sahibi serviste doğru workspace ile status doğrulaması. Runtime yetkisini genişletme. |
| F0-013 | Low | `apps/web/e2e/foundation.spec.ts:62–66,145–176` | Davetli E2E kullanıcısını cleanup'ta pasifleştir ve sonucu doğrula. |

Deferred bulguların kaydedilmesi, bağımsız Docker kabul engelini kaldırmaz.
Story `review` durumundadır; phase acceptance ve `main` merge yapılmadı.

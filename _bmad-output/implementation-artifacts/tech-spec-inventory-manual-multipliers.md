---
title: 'Inventory — ships, screens and manual multiplier versions'
type: 'feature'
created: '2026-11-10'
status: 'done'
acceptance_status: 'review'
target_file: 'tech-spec-inventory-manual-multipliers.md'
baseline_commit: 'dea05dcc2f039d1a573d889642c1d0dc2f77ff8b'
context:
  - 'docs/MVP_DECISIONS.md'
  - 'docs/SPRINT_PLAN.md'
  - 'docs/SESSION_HANDOFF_2026-11-10.md'
---

# Inventory — manual CMS foundation

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Administrators cannot register ships/screens or maintain audience assumptions; inventory navigation is a placeholder.

**Approach:** Deliver admin-only inventory and auditable manual multiplier history, preparing screen selection for a later booking story.

## Boundaries & Constraints

**Always:** Reuse Venue (`ferry` for ships), Screen and MultiplierProfile. Enforce admin reads/writes, transactional authorization and audit, decimal strings, UTC storage, TR/EN, pagination and soft deactivation. Unknown specifications remain null, never fabricated defaults.

**Ask First:** Destructive migration, broader business scope, production deployment or authentication changes.

**Never:** Implement campaigns, delivery, player provisioning, commercial fields or CMS/DSP connections. Manual input/admin approval does not verify audience or playback. Keep Phase 0 review and deferred findings open.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Register | Ship then screen | Persist linked records and audit | Invalid fields: 400 |
| Unknown equipment | Missing CMS/OS/dimensions/timing | Null; UI “Unknown”, health “Not connected” | Reject supplied nonpositive integers |
| Identity | Duplicate code; locked code edit | Canonical trimmed uppercase code, uniqueness retained | 409; no partial audit |
| Inactive parent | Assign/activate screen under inactive venue | Refuse; deactivation always allowed | 409; venue deactivation with active screens also refused |
| Multiplier | Positive decimal, source reference, reason | New draft version; separate admin approval | Reject zero, exponent, >4 decimals or >99999999.9999 |
| Replacement | Explicit predecessor, approval now/future | Atomically close open predecessor at new start | Reject overlap, backdating or stale predecessor: 409 |
| Concurrency | Simultaneous creates/approvals | Unique versions, at most one applicable approved profile | Retry serialization; conflict leaves no partial writes |
| Unauthorized | Anonymous / tenant / support, every route | No inventory payload or mutation | 401 / 403 |

</frozen-after-approval>

## Code Map

- `apps/api/src/modules/{venues,screens,multipliers}/` — currently empty modules; existing organization service supplies transaction patterns.
- `apps/api/prisma/schema.prisma` — existing relations and version uniqueness; SQL already excludes overlapping approved ranges.
- `apps/web/src/app/admin/[[...slug]]/page.tsx` — admin dispatcher; management components supply form conventions.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261110000300_manual_inventory/migration.sql` — add nullable CMS name/version/reference and notes; make unknown screen dimensions/orientation/loop/slot/hours nullable, removing invented defaults. Add `MANUAL` without relabeling legacy `MANUAL_VERIFIED`. Preserve rows/constraints; supplied slot cannot exceed loop. New screens use external signage and disable deal eligibility.
- [x] `packages/shared/src/inventory.ts`, `packages/shared/src/enums.ts`, `packages/shared/src/index.ts` — export safe response contracts and manual source; no financial/credential fields.
- [x] `apps/api/src/modules/venues/venues.{module,controller,service,dto}.ts` — paginated list/detail/create/update routes. Ship form: name, city, country, type (default ferry), timezone, notes, active. Validate trimmed text, known timezone and empty patches.
- [x] `apps/api/src/modules/screens/screens.{module,controller,service,dto}.ts` — same routes, venue/active filters; code/name/venue/timezone and nullable hardware/CMS metadata. Validate UUIDs, lengths, paired HH:mm hours (overnight allowed; equal rejected), dimensions and identity lock. Do not accept credentials.
- [x] `apps/api/src/modules/multipliers/multipliers.{module,controller,service,dto}.ts` — paginated screen history, draft creation and explicit approval. Server assigns actor/version/source; approval chooses server-now or future UTC start and optional later end. Require source reference and change reason. Whole-screen profiles only; reject dayparts and nonmanual source inputs.
- [x] `apps/api/src/modules/multipliers/multipliers.service.ts` — serialize per-screen version allocation and approval. Explicit `supersedesId` may close only the matching earlier open profile; reject other overlaps, including legacy dayparts. Approved value/source/creator remain immutable; no update/delete endpoint. Return current-by-time separately from latest-created; missing means null. Normalize decimal audit snapshots.
- [x] `apps/web/src/components/Inventory.tsx`, `apps/web/src/app/admin/[[...slug]]/page.tsx`, `apps/web/src/lib/nav.ts`, `apps/web/src/app/globals.css` — register list/detail routes; implement forms, filter-preserving pagination, edit/deactivation and multiplier approval/history. Paginate venue choices, preserving inactive selections. Show manual/estimated labels, explicit supersession confirmation, localized times, pending/error/empty states.
- [x] `apps/web/src/components/Shell.tsx` — update inventory availability without changing planned campaign/report navigation.
- [x] `packages/i18n/src/{tr,en}.json` — matching keys, validation messages and updated capability text without claiming later modules work.
- [x] `apps/api/test/inventory.unit-spec.ts`, `apps/api/test/inventory.integration-spec.ts`, `apps/web/e2e/inventory.spec.ts` — cover matrix, transaction rollback, all-role persisted-before/after checks, approval races, effective-time boundaries, immutable historical values, nullable migrations and mobile/TR/EN flows. Use isolated test DB and cleanup only owned fixtures.
- [x] `docs/openapi.json`, `README.md`, `docs/ACCEPTANCE.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml` — document typed new operations and actual verification; retain prior acceptance blockers.

**Acceptance Criteria:**
- Given an admin, when a ship/screen is saved and reopened, then persisted metadata and audit are visible in both languages without mobile overflow.
- Given an approved profile, when a future replacement is approved, then current selection changes only at the boundary and prior values/calculation references remain intact.
- Given existing Phase 0 data, when migration and regression suites run, then identity/audit behavior survives and unexecuted checks remain explicitly unverified.

## Spec Change Log

## Verification

- `rtk pnpm build`, `rtk pnpm typecheck`, `rtk pnpm lint`, `rtk pnpm test` — all pass.
- `rtk pnpm local integration`, `rtk pnpm local e2e` — isolated database and browser acceptance pass after owner migration; never run against production.
- `rtk pnpm local openapi` — regenerate documentation from implemented routes.

Baseline: Node 20.20.1 ran 7 tests; two suites failed loading Nest ESM. Recheck using pinned Node 24.22.2.


## Implementation record — 2026-11-10

- Approved by the user; developed on `story/inventory-manual-multipliers`. No remote operations or deployment.
- An implementation self-check reproduced legacy timing preventing deactivation. Follow-up migration `apps/api/prisma/migrations/20261110000400_inventory_timing_edits/migration.sql` replaces only the new timing checks with INSERT/changed-group triggers. The original constraints and stored legacy values remain intact. API validation mirrors independent changed groups.
- Full build: 8 packages; typecheck: 8 packages; lint: passed after the final code fix. Final API checks: 98 unit and 70 integration tests passed, including foundation regression. OpenAPI regenerated.
- Final rebuilt-server browser regression: 30/30 Chromium cases (11 foundation, 19 inventory) passed in 50.4s; total automated tests 198. The earlier 17-case/184-test run preceded the review regressions and is superseded by this result.
- Owner-created PostgreSQL 14 loopback databases only; six migrations applied. Both normal historical rows and genuinely pre-migration inconsistent timing fixtures survived upgrade; deactivation/metadata/multiplier locking and independent repairs succeeded without disabling triggers.
- Browser tests label HTTP presentation fixtures where used. Separate genuine old-schema → all-six-migrations → API → Chromium verification passed without intercepted HTTP for raw locked/unlocked codes, malformed hours, deactivation, independent repairs and explicit clearing; this additional check is not counted in the 198.
- Desktop 1440 px and mobile 375 px screenshots inspected with no overflow. Five generated local credentials scanned across repository files and 16 public browser assets: zero matches. Evidence: `docs/verification/2026-11-10-inventory/verification.json` and desktop/mobile screenshots.
- Docs: `docs/INVENTORY.md`, `docs/ACCEPTANCE.md`. Technical implementation/review is done; acceptance and sprint status remain `review` until Phase 0 prerequisites are satisfied. Prior deferred findings remain open. No production-ready claim or deployment.

## Review results

CR-1: independent blind hunter, edge-case hunter and acceptance auditor completed. Six unique medium-severity findings; all are implementation patches with already-defined intended behavior, not intent/spec gaps. No frozen text changes or scope expansion are needed.

| ID | Finding | Category | Disposition |
|---|---|---|---|
| I1-01 | Browser validates unchanged legacy timing and blocks deactivation/independent repair | patch | Fixed: changed-group validation; hours-first/slot-first regressions passed |
| I1-02 | Native time controls blank malformed legacy times, causing silent clearing on unrelated save | patch | Fixed: raw malformed text retained with explicit clear/repair; regressions passed |
| I1-03 | Locked lowercase legacy identity blocks unrelated edits; unlocked identity is silently normalized | patch | Fixed: dirty-only code normalization; locked/unlocked/noncanonical regressions passed |
| I1-04 | Successful save updates baseline but not selected venue; later save can restore stale assignment | patch | Fixed: server-returned venue synchronized; concurrent-move regression passed |
| I1-05 | History refresh/conflict leaves stale predecessor choices in approval panel | patch | Fixed: refresh/409 reload options and reset confirmations; both regressions passed |
| I1-06 | SQL btrim and JavaScript trim disagree on legacy edge whitespace | patch | Fixed: transactional index rebuild with ECMAScript trim character set; real DB regression passed |
| I2-01 | Editing then reverting a space-padded legacy code still normalizes its stored spelling | patch | Fixed: compare original input value before normalization; browser regression passed |
| I2-02 | Inline venue creation races with the parent screen PATCH and loses the new selection | patch | Fixed: mutually exclusive mutations; browser regression passed |
| I3-01 | Native text-input CR/LF sanitization defeats the legacy edit/revert comparison | patch | Fixed: initial DOM-value snapshot per form reset; space/CR-LF notes-only PATCH regressions passed |

CR-2 added I2-01/02; CR-3 added I3-01. All nine findings were medium-severity
implementation patches. No frozen text changes, intent re-derivation or scope
expansion occurred. Independent focused re-review closed the final CR/LF
snapshot fix, including genuine edits and post-save snapshot renewal.
Reviewers used source/in-memory handler checks, not full-suite reruns; the
parent executed the final build/typecheck/lint, 98 unit, 70 integration and
30 browser tests. No unresolved inventory review finding remains; Phase 0
deferred work is separate and remains open.

## Deployment record — 2026-11-11

The user explicitly authorized live deployment. Source `247aa02` was uploaded
as a secret-scanned clean commit archive to the existing Railway pilot.
Pre-migration custom backup and duplicate checks passed; all six migration
checksums match. Migration → API → web succeeded in order. Live inventory
create/edit/approval/supersession, protected routes, cookies, TR/EN/mobile,
audit and logout passed; smoke-owned inventory was deactivated.
Two harness-only assertion mistakes were corrected during verification;
no application changes were needed. Evidence and precise deployment IDs:
`docs/RAILWAY_DEPLOYMENT.md` and
`docs/verification/2026-11-11-railway-inventory/`.
No remote Git push, database reset or automatic rollback occurred.
Phase 0/deferred acceptance remains open; acceptance/sprint stays `review`.

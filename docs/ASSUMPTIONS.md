# Phase 0 assumptions

- User approved continuing Phase 0 on the existing Protarget scaffold, not duplicating ReklamAi.
- Existing later-phase models remain; their APIs are not implemented in this phase.
- Authentication operations are exempt from read-only business mutation restrictions.
- MFA is Phase 8; a user with MFA enabled must fail closed until implemented.
- Docker daemon was inaccessible in the original session. Real PostgreSQL tests can run on an isolated local instance; this does not substitute for Compose acceptance.
- No seeded password, JWT key, or refresh/invitation token is committed.

## Deferred

Later business features remain out of Phase 0 scope. The user's answers on
2026-11-10 supersede the original mandatory CMS/player/programmatic roadmap;
see `docs/MVP_DECISIONS.md`. Manual CMS operation is sufficient for the MVP.

## Runtime compatibility

The existing scaffold pins NestJS 12 and Jest 30. Running real Nest integration tests on the host Node 20.20.1 failed before executing tests because Jest could not load Nest ESM utilities. Phase 0 standardizes on Node 24.22.2 (engines >=24.9 <25), verified in an isolated /tmp runtime. The system Node installation is unchanged.

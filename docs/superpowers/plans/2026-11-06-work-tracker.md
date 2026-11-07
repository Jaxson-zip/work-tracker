# Work Tracker Implementation Plan

> **For agentic workers:** Use subagent-driven-development for bounded database implementation and review; controller integrates the retained personal app and team UI in this session. User approved design and continuous implementation.

**Goal:** Record affairs, create owned tasks and advance them through a logged, authorized workflow with Feishu input/notifications.
**Architecture:** Retain personal React/Vite app and Supabase Auth; separate team tables and a transactional wt_command RPC. Feishu server adapters use service-only ingestion and leased outbox.
**Tech Stack:** Existing React 19, TypeScript, Vite, Supabase JS/Postgres; Vitest and PGlite for executable SQL tests.

## Task 1 — Isolated reuse and account cache
- [ ] Copy tracked source/config/docs without credentials, dependencies or deployment identity.
- [ ] Namespace local storage by authenticated account; gate initialization and discard stale user sync responses.
- [ ] Test account A/B/guest cache separation before implementing storage changes; run `npm test -- src/storage.test.ts`.

## Task 2 — Transactional team domain
- [ ] Create src/team/types.ts contract and SQL migration, tests/team-db.test.ts.
- [ ] RED then GREEN: create workspace, invite/join, role updates, owner protection, real record->task, workflow permissions/history/version conflict, cross-workspace denial.
- [ ] Enforce direct-table write denial and authenticated RPC grants in database, not browser.
- [ ] Service-only Feishu binding/ingestion and notification claiming/finishing; repeat delivery idempotency and due-event deduplication.

## Task 3 — Team workbench
- [ ] Retain personal app in separate workspace entry, add team mode as default and reusable auth.
- [ ] Connect team snapshot/commands through actual Supabase client; do not simulate successful persistence when unconfigured.
- [ ] Implement owned task list/detail/flow/transfer/comments, daily records conversion, key matters, members/invites and profile/recovery.
- [ ] Preserve draft after errors; version conflict requires reloading; prevent stale responses after account/team switch.

## Task 4 — Feishu integration
- [ ] Check current official docs; adapter test RED/GREEN for signature, invalid/stale callbacks, binding/input parsing and bot API failure.
- [ ] Add server callback and environment-only webhook configuration, service outbox worker, bounded retries and setup guide.

## Task 5 — Delivery
- [ ] Independent spec compliance and code review, fix concrete findings.
- [ ] Run npm test, npm run build, database scenario tests and browser checks at desktop/mobile.
- [ ] Record retained file hashes, local startup, fresh Supabase migration and Feishu credential requirements.

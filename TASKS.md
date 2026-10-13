# Tasks

_Last updated: 2026-10-13_

## Completed
- [x] Repo inspection (empty); stack chosen; Next.js 16 scaffold; strict TypeScript; ESLint
- [x] Design system tokens (light/dark), primitives, app shell, collapsible sidebar, mobile nav, ⌘K command palette, `g`-key shortcuts, create menu, notifications page
- [x] Postgres schema (28 tables) + 5 migrations; RLS enabled on all 28 tables under a non-owner app role; append-only audit log
- [x] Session auth (scrypt, hashed tokens, sliding expiry, throttling), signup/login/logout/logout-everywhere, workspace selection, password change, session management
- [x] RBAC: 10 default roles, editable permissions + own/team/all scope; enforced in services and tested
- [x] Leads: CRUD, configurable statuses, deterministic explainable scoring (admin-editable, re-score), round-robin assignment, duplicate detection (email/phone/domain), merge with field-level choice, bulk status/assign/archive, conversion to account + contact + opportunity with history carry-over
- [x] Accounts: CRUD, hierarchy with cycle prevention, domain uniqueness, Account 360 (FX-aware rollups, committee coverage, timeline, history)
- [x] Contacts: CRUD, buying roles, consent/DNC, duplicate email guard
- [x] Opportunities: 3 default pipelines, stage probabilities/required fields, accessible drag-and-drop Kanban with requirement prompts, table view, stage path, stage history, TCV/ARR definitions, forecast categories, buying committee, rule-based deal inspection
- [x] Activities: notes, calls, meetings, logged emails, tasks with due/priority/completion; last-contacted tracking; tasks page (mine/team, overdue/today/upcoming/completed)
- [x] Global search (pg_trgm), recently viewed
- [x] Import engine: CSV/XLSX streaming parse, auto-mapping, dry-run validation, duplicate strategies, background chunked processing, error report CSV, rollback; tested end to end
- [x] Export: CSV/XLSX per entity, scope-aware, audited, formula-injection safe
- [x] Executive dashboard, reports (forecast by category, source conversion, loss reasons), metric definitions
- [x] Administration: users/teams, roles, general settings (FX, thresholds, round-robin), scoring rules, audit log viewer, system health
- [x] Integration framework + registry; website-form webhook connector (HMAC, replay window, idempotency, rate limit, encrypted secrets, rotation)
- [x] Postgres job queue with retries/dead-letter + Vercel Cron worker; transactional outbox
- [x] Tests: 76 unit/integration (real Postgres) + 5 Playwright E2E; CI workflow
- [x] Docs: README, ARCHITECTURE, SECURITY, INTEGRATIONS, PROJECT_PLAN, METRICS; `.env.example`; `vercel.json`; dev-only demo seed

## In progress
- [ ] Phase 3 revenue modules (campaigns, partners, products, proposals, renewals)

## Blocked (external dependency)
- [ ] Microsoft 365 / Google Workspace / Meta / LinkedIn / Google Ads connectors: need app registrations, OAuth clients and vendor approvals (see INTEGRATIONS.md)
- [ ] Production deployment: needs a Vercel project, a Supabase project and secrets; not available in this session
- [ ] Email invitations and password reset: need an email provider and a verified sending domain

## Pending
- [ ] MFA (TOTP), SSO (OIDC/SAML), SCIM
- [ ] Custom fields UI (table exists), saved views, inline editing, column visibility
- [ ] Outbox dispatcher + outbound webhooks + versioned public REST API with OpenAPI
- [ ] Workflow automation engine
- [ ] AI layer (provider adapters, allow-listed tools, permission-aware retrieval)
- [ ] Presales, projects, managed services, customer success
- [ ] Documents (Supabase Storage with signed URLs)
- [ ] Retention/erasure jobs, field-level security, distributed rate limiting
- [ ] Load testing to establish real capacity limits
- [ ] Pipeline/stage/lead-status editor UI (configurable in DB; admin UI pending)

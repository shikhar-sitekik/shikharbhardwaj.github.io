# Architecture

## Shape: a modular monolith

One Next.js application holds the UI, the server actions, the route handlers and the domain services. Long-running work goes through a durable Postgres job queue that is drained by Vercel Cron and opportunistically after requests. Nothing is split into microservices until load or team boundaries justify it.

```
Browser ──► proxy.ts (request id, CSP nonce, coarse auth redirect, cookie renewal)
        ──► Server Components / Server Actions / Route Handlers
              │  thin: parse input, call a service
              ▼
        server/services/*   ← authorisation (permission + data scope), validation, audit, events
              │
        server/domain/*     ← pure logic: scoring, pipeline math, inspection, normalisation
              │
        withScope(tx)       ← every tenant query runs in a transaction with
              │               set_config('app.tenant_id' / 'app.user_id')
              ▼
        PostgreSQL (RLS FORCE'd on tenant tables, app connects as exato_app)
              ▲
        jobs table ◄── runJobs() via /api/cron/jobs and next/server after()
```

### Layer rules

- **UI components never touch the database.** Pages call services. Client components call server actions.
- **Services own authorisation.** Every exported service function checks a permission (`need(ctx, "lead:write")`) and applies the caller's data scope (`ownerScope`, `assertOwnerAccess`). Hiding a button is never the control.
- **The database is the second line of defence.** Even if a service forgot a tenant filter, RLS policies bound to `app.tenant_id` return no rows from other tenants. Integration tests prove this with raw SQL.
- **The domain layer is pure.** It has no I/O and is unit-tested exhaustively.

## Key decisions

| Decision | Choice | Why | Revisit when |
| --- | --- | --- | --- |
| Next.js caching | `cacheComponents: false`; every page is dynamic | All views are tenant- and user-specific. Server-side component caching of tenant data is a cross-tenant leak risk with no real benefit at this scale. | Public or marketing pages are added |
| ORM | Drizzle and SQL migrations in git | Typed queries, SQL stays visible, RLS and functions live in reviewable migrations | n/a |
| Tenancy | Shared schema, `tenant_id` on every tenant row, RLS under a non-owner role | Cheapest correct multi-tenancy, and it works on Supabase. RLS is `FORCE`d so it holds even for the table owner. | A tenant needs data residency, which means database-per-tenant |
| Auth | Built-in: scrypt password hashing, opaque DB-backed sessions (SHA-256 of token stored), sliding expiry, login throttling | Works with any Postgres, including RLS. Fully testable offline. No third-party session model to reconcile with tenant context. | Enterprise SSO is needed (Phase 6): add an OIDC/SAML provider behind `server/auth` |
| Background jobs | Postgres queue (`FOR UPDATE SKIP LOCKED`, retries with backoff, dead-letter, idempotency keys) plus Vercel Cron | No extra vendor, transactional with the data, and enough for imports and sync at current scale | Throughput or workflow complexity grows (Phase 5 automation): move behind the same `enqueueJob` interface to Inngest |
| Events | Transactional outbox (`outbox_events`), written in the same transaction as the change | Reliable event publication without dual writes | Consumers (webhooks, automation) are built in Phase 5 |
| Search | `ILIKE` with `pg_trgm` GIN indexes, ranked by `similarity()` | Good enough to roughly 1M rows per entity, no extra infrastructure | Search latency exceeds 300 ms p95 |
| Money | `numeric(18,2)` with an explicit ISO currency on every amount; FX conversion only at report time, with admin-maintained rates | Original values are never mutated. Deals with unconverted currencies are excluded and counted, never mixed. | Finance needs dated FX: add a rates table and source |
| Activities | One `activities` table (note, task, call, email, meeting) | Simplifies the timeline and roll-ups. Email and meeting sync will add `email_messages` and `meetings` tables that link to activities. | Phase 4 email/calendar sync |

## Data model (implemented)

```
tenants ─┬─ tenant_memberships ── users ── sessions
         ├─ roles (permissions[], data_scope)   teams   territories
         ├─ lead_statuses
         ├─ leads ──(convert)──► accounts ◄── contacts
         │                         ▲  ▲          ▲
         │                         │  └── parent_account_id (hierarchy, cycle-checked)
         ├─ pipelines ── pipeline_stages (probability, category, required_fields)
         ├─ opportunities ── opportunity_stage_history
         │        └── opportunity_contacts (buying-committee role)
         ├─ activities (lead|account|contact|opportunity links)
         ├─ import_jobs ── import_rows (raw, status, errors, record_id, previous)
         ├─ integration_connections ── webhook_events
         ├─ email_capture_tokens (per user)   email_messages (links → lead/contact/account/deal)
         ├─ audit_logs (append-only for the app role)   outbox_events   notifications
         └─ recent_views   custom_field_definitions
jobs (global queue; tenant_id per job)   login_attempts (global)
```

Every exposed identifier is a random UUID. Core entities are soft-deleted with `archived_at`. Hard deletes are reserved for future retention jobs.

**Lifecycle links.** A lead keeps `converted_account_id`, `converted_contact_id` and `converted_opportunity_id`. Contacts and opportunities keep `source_lead_id`. On conversion, the lead's activities are re-linked to the new records, so the timeline is continuous. `campaign_id` and `partner_id` columns exist on leads and opportunities, ready for the Phase 3 campaigns and partners modules; they carry no foreign key until those tables exist.

**Entities from the brief not yet built.** These are campaigns and attribution, partners, products and price books, proposals, contracts and renewals, projects, documents, meeting tables, automations, and AI tables. They are planned per phase in PROJECT_PLAN.md. They are deliberately absent rather than created empty.

## Request lifecycle and security headers

`src/proxy.ts` sets a per-request `x-request-id` and a nonce-based CSP: `script-src` uses the nonce with `'strict-dynamic'`, and `frame-ancestors 'none'`. It also redirects cookie-less page requests to `/login` and renews the session cookie. It does **not** decide authorisation; `requireContext()` and services do. `next.config.ts` adds HSTS, nosniff, X-Frame-Options and Permissions-Policy.

## Background processing

- `enqueueJob(type, payload, idempotencyKey)` writes to `jobs`.
- `runJobs()` claims jobs with `SKIP LOCKED`, runs the registered handler and reschedules chunked jobs (`"continue"`). Failures back off exponentially from 15 s up to 1 h. After `max_attempts` a job is marked `dead` and shown on System health. Jobs stuck in `running` for over 10 minutes are reclaimed.
- Imports are processed in chunks of 250 rows. Each row runs in its own savepoint, so one bad row never aborts the chunk. The importing user's permissions are re-checked on every chunk.

## Performance notes

- Server-side pagination everywhere (default 50, max 200). List queries are indexed on `(tenant_id, …)`.
- The Kanban board loads up to 2,000 open (and recently closed) deals per pipeline. Beyond that, add per-column paging.
- Executive metrics aggregate in SQL grouped by stage and currency, then convert currency in memory. No pre-aggregation yet. Add snapshot tables when dashboards exceed roughly 500 ms.
- No load test has been run yet, so no capacity number is claimed.

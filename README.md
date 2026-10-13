# Exato One

A multi-tenant CRM and revenue operating system for Exato's sales, marketing, partnerships, delivery and leadership teams. The product name can be changed with `NEXT_PUBLIC_APP_NAME`.

**Status:** Phases 1–2 are complete: foundation and core CRM, lead to closed-won. Phase 3 is partly done (dashboard, reports, forecasting). Phase 4 has the connector framework and one live connector (signed website-form webhooks). Everything else is shown in the app as "Soon" and is not simulated. See [TASKS.md](TASKS.md) for the exact state, and [PROJECT_PLAN.md](PROJECT_PLAN.md) for the roadmap.

| Doc | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data model, decisions and trade-offs |
| [SECURITY.md](SECURITY.md) | Implemented controls, gaps, and what still needs independent validation |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Connector framework, the website-form webhook spec, planned connectors and their prerequisites |
| [docs/METRICS.md](docs/METRICS.md) | Business definitions for every metric shown |
| [TASKS.md](TASKS.md) | Completed / in-progress / blocked / pending work |

## Stack

Next.js 16 (App Router, React 19, TypeScript strict) · Tailwind CSS 4 · Radix UI · Drizzle ORM · PostgreSQL 16 (Supabase-compatible) with row-level security · Zod · Recharts · dnd-kit · ExcelJS/Papa Parse · Vitest · Playwright.

## Local development

Prerequisites: Node 20.11+ (22 recommended) and PostgreSQL 16 running locally.

```bash
npm install

# 1. Databases (owner role runs migrations; exato_app is the runtime role)
psql -U postgres -c "CREATE ROLE exato_owner LOGIN SUPERUSER PASSWORD 'exato_dev';"
psql -U postgres -c "CREATE DATABASE exato_dev OWNER exato_owner;"
psql -U postgres -c "CREATE DATABASE exato_test OWNER exato_owner;"
psql -U postgres -c "CREATE DATABASE exato_e2e OWNER exato_owner;"

# 2. Environment
cp .env.example .env    # then fill in (see below)

# 3. Migrate (creates the exato_app role NOLOGIN), then enable its login locally
npm run db:migrate
psql -U postgres -c "ALTER ROLE exato_app WITH LOGIN PASSWORD 'exato_app_dev';"

# 4. Optional: fictional demo workspace (refuses to run in production)
npm run db:seed         # demo.admin@exato.local / demo-password-change-me

npm run dev             # http://localhost:3000, or sign up at /signup
```

Minimal local `.env`:

```bash
DATABASE_URL=postgres://exato_app:exato_app_dev@localhost:5432/exato_dev
DATABASE_MIGRATION_URL=postgres://exato_owner:exato_dev@localhost:5432/exato_dev
APP_URL=http://localhost:3000
CRON_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -base64 32>
ALLOW_SIGNUP=true
```

## Quality gates

```bash
npm run lint          # ESLint (Next + React hooks rules)
npm run typecheck     # tsc --noEmit, strict
npm test              # Vitest: unit + integration against real Postgres (exato_test, reset per run)
npm run build         # production build
npm run test:e2e      # Playwright against `next start` on :3100 with exato_e2e (run build first)
npm run check         # lint + typecheck + test + build
```

CI (`.github/workflows/ci.yml`) runs all of the above against a Postgres 16 service container.

## Schema changes

1. Edit `src/server/db/schema.ts`.
2. `npm run db:generate` creates a SQL migration in `drizzle/`. Review it.
3. For RLS policies, functions or grants, add a custom migration with `npx drizzle-kit generate --custom --name=<name>`.
4. Every new tenant-owned table **must** get an RLS policy; see `drizzle/0001_rls.sql` and `drizzle/0004_integrations_rls.sql`.
5. `npm run db:migrate`.

Never edit the database by hand.

## Quick deploy (Vercel + Neon free tier, no terminal)

1. Vercel → **Add New → Project** → import this GitHub repo (branch `claude/exato-one-crm-build-dcs1or` or `main`). Framework: Next.js (auto).
2. In the new project: **Storage → Create Database → Neon** (free plan) → connect it to the project. This sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
3. **Settings → Environment Variables** (Production + Preview):
   - `EXATO_APP_DB_PASSWORD`: random, 24+ characters (the app's restricted database login)
   - `ENCRYPTION_KEY`: `openssl rand -base64 32`
   - `CRON_SECRET`: `openssl rand -base64 32`
   - `ALLOW_SIGNUP` = `true` (set to `false` after you've created your account)
4. **Deployments → Redeploy.** The build (`npm run vercel-build`) applies migrations and creates the `exato_app` login automatically.
5. Open the `.vercel.app` URL, go to `/signup` and create your workspace.

Notes: `APP_URL` defaults to the production domain. Preview deployments migrate the same database. Hobby plans allow only daily crons, so the cron runs daily; imports still process immediately after you confirm them.

## Deployment (Vercel + Supabase) (manual)

Nothing has been deployed from this repository yet. The steps:

1. **Supabase project:** note the direct connection string (owner, port 5432) and the transaction-pooler string (port 6543).
2. **Migrate:** `DATABASE_MIGRATION_URL=<direct owner URL> npm run db:migrate`.
3. **App role:** in the Supabase SQL editor run `ALTER ROLE exato_app WITH LOGIN PASSWORD '<strong secret>';`. Build `DATABASE_URL` from the **pooler** host with user `exato_app` (Supavisor typically expects `exato_app.<project-ref>` as the username; confirm in the Supabase connection settings).
4. **Vercel project:** import the repo with framework preset Next.js, and set the environment variables from `.env.example`. `ALLOW_SIGNUP=true` is only needed until the first administrator has signed up; then set it to `false` and redeploy.
5. **Cron:** `vercel.json` schedules `/api/cron/jobs` every 5 minutes, and Vercel sends `Authorization: Bearer $CRON_SECRET`. Check your plan's cron frequency limits; on plans that allow only daily crons, background imports still run immediately after the user confirms them.
6. **Domain/TLS:** add the domain in Vercel and set `APP_URL` to it.
7. **Smoke test:** `GET /api/health` returns `{"status":"ok"}`. Then sign in, create a lead, convert it and check the dashboard. Create a website-form endpoint and post a signed test submission (see INTEGRATIONS.md).
8. **Rollback:** use Vercel's "Instant Rollback" to the previous deployment. Migrations are forward-only, so write additive migrations and avoid destructive column drops in the same release as code changes.
9. **Backups:** enable Supabase PITR (paid tiers) or scheduled `pg_dump`, and test a restore into a scratch project before go-live.

## Project layout

```
src/
  app/(auth)/          login, signup, workspace selection
  app/(app)/           authenticated application (shell, CRM modules, admin)
  app/api/             route handlers: search, exports, import error reports,
                       cron worker, health, v1 inbound webhooks
  components/ui/       design-system primitives
  components/crm/      domain UI (forms, board, timeline, tables)
  components/shell/    sidebar, top bar, command palette
  lib/                 client-safe helpers (formatting, navigation, options)
  server/auth/         sessions, passwords, RBAC, request context
  server/db/           Drizzle schema + client with RLS scope
  server/domain/       pure business logic (scoring, pipeline math, inspection, normalisation)
  server/services/     application services (all authorisation happens here)
  server/actions/      server actions (thin: parse form → call service)
  server/imports/      file parsing, field catalogue, row transformation
  server/integrations/ connector registry and connectors
  server/jobs/         Postgres-backed job queue
drizzle/               SQL migrations (schema + RLS)
tests/unit|integration|e2e
scripts/               migrate, demo seed
```

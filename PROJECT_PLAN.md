# Project plan

## Principles
1. Security and data integrity first, core CRM workflows second, reliable integrations third, automation and AI fourth.
2. Nothing is shown as working unless it is. Unbuilt modules appear in navigation labelled "Soon" with no mock data.
3. Every phase leaves `npm run check` and the E2E suite green.

## Phases and exit criteria

| Phase | Scope | Exit condition | Status |
| --- | --- | --- | --- |
| 1 Foundation | Next.js app, design system, Postgres + migrations, auth, tenant isolation (RLS), RBAC, shell, error handling, tests, CI, deployment config | Builds, authenticates, enforces tenant boundaries (tested) | **Done** |
| 2 Core CRM | Leads (scoring, routing, dedupe, merge, convert), accounts (hierarchy, Account 360), contacts, opportunities (pipelines, stage rules, Kanban, history), activities and tasks, global search, audit history, import/export engine | Lead → opportunity → won works on persisted data (E2E) | **Done** |
| 3 Revenue operations | Executive dashboard, forecasting, reports **(done)**; campaigns and attribution, partners, products and price books, proposals with approvals, customer handover, renewals | Managers inspect pipeline, forecast, attribution and commercial progress | **Partly done** |
| 4 Integrations | Connector framework and signed website forms **(done)**; Microsoft 365 mail and calendar, Google Workspace, Meta Lead Ads, LinkedIn Lead Gen, Google Ads, email provider | At least one priority OAuth connector syncs for real with retries and health | **Framework done; OAuth connectors blocked on credentials** |
| 5 Automation & AI | Outbox consumers, workflow builder (trigger → condition → action, versioning, dry run, loop prevention), notifications, provider-agnostic AI layer (allow-listed tools, permission-aware retrieval, structured outputs, cost limits), account briefs, deal summaries, NL search, email drafting with approval | One automation and one AI workflow run end to end with validation | Not started |
| 6 Lifecycle & enterprise | Presales/PoC, projects and delivery, managed services, customer success, MFA, SSO/SCIM, field-level security, retention, observability, hardening, backup runbook | Commercial lifecycle covered; security tests pass | Not started |
| 7 Production | Environments, migrations, OAuth callbacks, webhooks, cron, storage, domain/TLS, smoke tests, monitoring, rollback | Deployed and smoke-tested | Not started (no deployment credentials in this session) |

## Next implementation steps (in order)
1. **Email provider plus password reset and invitations.** Removes manual password distribution, a security gap.
2. **MFA (TOTP).** Required before external use.
3. **Campaigns and attribution** (campaign, members, touchpoints, first/last-touch on lead and opportunity). Unlocks marketing reporting.
4. **Microsoft 365 connector** (OAuth PKCE, Graph mail and calendar delta sync, activity association), once Exato provides an Entra app registration.
5. **Products, proposals and renewals**, completing the post-sale lifecycle.
6. **Outbox dispatcher, then the workflow engine, then the AI layer.**

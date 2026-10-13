# Security

Implementing these controls does **not** make Exato One compliant with GDPR, ISO 27001, SOC 2 or any other framework. Certification requires organisational processes and independent assessment. This document lists what the software actually does, and what is still open.

## Implemented controls

### Tenant isolation (defence in depth)
- Every tenant-owned table has `tenant_id NOT NULL` and a `FORCE`d RLS policy: `tenant_id = app_tenant_id()`.
- The application connects as `exato_app`. That role is not the owner, has no `BYPASSRLS`, and has no `UPDATE`/`DELETE` on `audit_logs`.
- All tenant queries run inside `withScope()`, which sets `app.tenant_id` and `app.user_id` with `set_config(..., true)`. These are transaction-local, so they are safe with transaction-mode poolers.
- Global tables (`users`, `sessions`, `login_attempts`, `jobs`) have RLS enabled with an allow-policy for `exato_app` only. Any other role, such as Supabase `anon` or `authenticated` through the Data API, sees nothing.
- Inbound webhooks resolve their tenant through one narrow `SECURITY DEFINER` function that returns only a tenant id.
- Tests: `tests/integration/crm-flow.test.ts` ("isolates tenants…") runs raw SQL across tenants. The E2E test checks that tenant B gets a 404 on tenant A's lead URL and empty search results.

### Authentication
- scrypt hashing (N=2¹⁷, r=8, p=1) with a minimum 12-character passphrase policy (NIST 800-63B style: no composition rules).
- Opaque 256-bit session tokens. Only their SHA-256 is stored. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Expiry is 30 days with a sliding window.
- Login throttling: 10 failures per 15 minutes per email and per IP. Unknown users get a constant-time comparison against a dummy hash.
- Sign out of one session, all sessions, or "all others". Password change revokes other sessions. Suspending a member revokes all of their sessions.

### Authorisation
- RBAC with configurable roles. Each role holds a permission list plus a record scope (own, team or all).
- Enforced in services on every read and write. Out-of-scope records render 404 so their existence is not disclosed.
- Owner reassignment needs `lead:assign`. Admins cannot demote or suspend themselves, or remove the last administrator.

### Input and output handling
- Zod validation on every write. Emails, phones, domains, dates and currencies are normalised.
- Drizzle uses parameterised queries. User text in `LIKE` patterns is escaped.
- CSV and XLSX exports neutralise formula injection (`=`, `+`, `-`, `@` prefixes). XLSX import reads cached values only and never evaluates formulas. `.xlsm` is rejected, and the file signature must match the extension.
- Import limits: 10 MB, 20,000 rows, 100 columns, 5,000 characters per cell. The XLSX reader is streaming.
- Server actions inherit Next.js origin checking (CSRF). State-changing route handlers are either signature-authenticated (webhooks) or bearer-authenticated (cron).
- Redirect targets after login are restricted to same-origin relative paths.

### Secrets and integrations
- Integration secrets are encrypted with AES-256-GCM using `ENCRYPTION_KEY`, with rotation support via `ENCRYPTION_KEY_PREVIOUS`. They are shown once at creation or rotation and never returned to the client again.
- Webhooks: `HMAC-SHA256(secret, t + "." + body)` with a 5-minute timestamp tolerance (replay protection), idempotency on event id or body hash, a rate limit of 120 per minute per endpoint, a 64 KB body cap, and a JSON-only content type.
- The cron endpoint requires `Authorization: Bearer $CRON_SECRET`, compared in constant time.

### Headers
- Nonce-based CSP: no `unsafe-inline` or `unsafe-eval` for scripts in production, `frame-ancestors 'none'`, and `object-src 'none'`.
- HSTS (2 years with preload), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- Style attributes require `style-src 'unsafe-inline'`. Radix and Recharts set inline styles. This is an accepted, low-risk exception.

### Auditing and logging
- `audit_logs` records creates, updates (with field diffs and sensitive keys redacted), status changes, assignments, merges, conversions, imports, exports, settings, role and member changes, and integration changes. It is append-only for the app role.
- Logs are structured JSON. Message bodies, passwords and secrets are never logged. Request IDs are propagated.

## Known gaps (not yet implemented)

| Gap | Risk | Plan |
| --- | --- | --- |
| MFA (TOTP/WebAuthn) | Account takeover via phished passwords | Phase 6. Required before external-facing production use. |
| SSO (OIDC/SAML) and SCIM | Manual joiner/leaver management | Phase 6 via an identity provider adapter in `server/auth` |
| Email verification and password-reset email | Admin must reset passwords out of band | Needs an email provider (Resend/SMTP) |
| Malware scanning of uploads | Malicious files stored temporarily as rows | Uploaded files are parsed in memory and never stored as files. Add scanning when document storage arrives. |
| Field-level sensitive-data restrictions | Roles see all fields of records in scope | Phase 6 |
| Distributed rate limiting for search and API | Login is throttled in the DB; search is not | Add Upstash/Redis or a Postgres token bucket before the public API |
| Data retention and deletion workflows (GDPR erasure) | Soft deletes only | Phase 6 retention jobs |
| Dependency and secret scanning in CI | n/a | Add `npm audit --omit=dev` gate and GitHub secret scanning |
| Penetration test and threat model review | Unknown unknowns | Before production go-live |

## Operational requirements before production
1. Rotate every value in `.env.example` and set them only in Vercel or Supabase secret stores.
2. Set `ALLOW_SIGNUP=false` after the first administrator exists.
3. Enable Supabase PITR or backups, and test a restore.
4. Disable the Supabase Data API for the `public` schema, or confirm that RLS blocks `anon` and `authenticated`. Migrations already enable RLS on every table.
5. Configure log drains and error alerting (Sentry or Vercel Observability).

## Reporting a vulnerability
Email the security owner listed in the Exato internal runbook. Do not open public issues for security reports.

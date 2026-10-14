# Integrations

## Status vocabulary

A connection moves through distinct states. The UI never collapses them into a single "Connected" label.

| State | Meaning |
| --- | --- |
| Available | Connector code exists in the registry (`src/server/integrations/registry.ts`) |
| Configured | Credentials or secret stored (encrypted) |
| Authenticated | A credential test against the provider passed (OAuth connectors) |
| Synced | First full sync completed |
| Healthy / Degraded | Ongoing deliveries or syncs succeeding / failing |
| Disabled | Stopped by an administrator |

## Connector contract

Every connector implements `Connector<Config, Payload>`: `parseConfig`, and optionally `verifyInbound`, `mapInbound`, `authorizeUrl` (OAuth 2.0 with PKCE and server-side state), `syncPage` (cursor pagination, idempotent upserts) and `testConnection`.

Shared infrastructure:
- `integration_connections` holds status, non-secret config, the encrypted secret, counters and last success/error.
- `webhook_events` stores a dedupe key per connection plus the outcome.
- Job queue: retries, backoff and dead-letter.
- Audit log entries for create, rotate, enable and disable.

Planned additions for sync connectors: `integration_external_ids` (external id ↔ CRM id), `integration_sync_checkpoints` (per-tenant cursor), and `integration_sync_runs` (counts and errors). Field-level source-of-truth rules will never overwrite a CRM value with a blank. Loop prevention will tag writes by origin and ignore echoes.

## Implemented: website forms (signed webhook)

Administration → Integrations → Website forms → **Create endpoint**. You get:

- Endpoint: `POST {APP_URL}/api/v1/inbound/forms/{connectionId}`
- Signing secret `whsec_…`, shown once. Rotate it at any time; old signatures stop working immediately.

**Request**

```
Content-Type: application/json
X-Exato-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
X-Exato-Event-Id: <optional idempotency key; or include event_id in the body>
```

Body (snake_case or camelCase, flat or under `lead`):

```json
{
  "event_id": "form-2026-10-13-001",
  "first_name": "Ana", "last_name": "Lopez", "email": "ana@example.com",
  "phone": "+44 20 7946 0958", "company": "Acme", "website": "acme.com",
  "job_title": "Head of CX", "country": "UK",
  "message": "We need help with IVR", "product_interest": "Conversational AI",
  "consent_email": true,
  "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "q4-cx", "page_url": "https://exato.ai/contact"
}
```

**Responses:** `201 {status:"created", leadId}` · `200 {status:"duplicate"|"matched_existing", leadId}` · `401 invalid_signature` (also returned for unknown or disabled endpoints) · `413` · `415` · `422` (validation) · `429 rate_limited` (120/min) · `409 connection_owner_lacks_permission`.

**Signing example (Node)**

```js
import { createHmac } from "node:crypto";
const body = JSON.stringify(payload);
const t = Math.floor(Date.now() / 1000);
const sig = createHmac("sha256", process.env.EXATO_FORM_SECRET).update(`${t}.${body}`).digest("hex");
await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Exato-Signature": `t=${t},v1=${sig}` }, body });
```

Never sign from browser JavaScript; the secret would leak. Use your site's backend, a serverless function, or the form tool's server-side webhook feature.

**Behaviour:**
- Leads are created as the administrator who created the endpoint, and that person's current permissions are re-checked on every delivery.
- An email matching an open lead links to it instead of creating a duplicate.
- The first verified delivery moves the connection to Healthy.

**Tests:** `tests/integration/integrations.test.ts` covers creation, deduplication, forged signatures, unknown endpoints, rotation, disabling and tenant isolation. `tests/unit/crypto.test.ts` covers the cryptography.

## Implemented: email capture (BCC / forward, via Postmark inbound)

Each user gets a personal logging address on the **Email log** page, for example `abc123+<24-hex token>@inbound.postmarkapp.com`. BCC it on emails you send to clients, or forward client emails to it. Exato One then:

1. Authenticates Postmark's POST to `/api/v1/inbound/email` with HTTP basic auth (password = `INBOUND_EMAIL_SECRET`, compared in constant time).
2. Resolves the token (stored as SHA-256 plus an AES-GCM copy so the address can be re-displayed) to its tenant and user through the `resolve_email_capture` SECURITY DEFINER function. The user must still be an active member. Unknown or regenerated addresses are acknowledged with 200 and nothing is stored.
3. Unwraps forwards from workspace members (Gmail, Outlook and Apple Mail formats) into the original message. Direction is "sent" when the original sender is a member, otherwise "received".
4. Matches every external person on the thread to a contact, then an open lead, then a company by business domain. Only records **within the capturing user's data scope** are touched. A contact on exactly one open deal also links that deal.
5. Logs one email activity per matched record (body capped at 8,000 characters; attachments counted, not stored), updates last-contacted dates, and stores the message (idempotent on `Message-ID`).
6. Puts emails with no match into **Needs review**, where the user can create a lead from the sender, re-check after adding a contact, or dismiss.

Captured mail is visible only to the user who captured it, plus the activity on the linked records.

**Setup (about 10 minutes, free up to 100 inbound emails a month):**
1. Create a Postmark account → **Servers → Create server** → open the **Default Inbound Stream** → copy the inbound address (`…@inbound.postmarkapp.com`).
2. In Vercel set `POSTMARK_INBOUND_ADDRESS` (that address) and `INBOUND_EMAIL_SECRET` (`openssl rand -hex 24`), then redeploy.
3. In Postmark → Inbound stream → **Settings → Webhook URL**:
   `https://postmark:<INBOUND_EMAIL_SECRET>@<your-domain>/api/v1/inbound/email`
   If Vercel Deployment Protection is on, append `?x-vercel-protection-bypass=<automation bypass secret>`.
   Postmark's **Check** button sends a test payload without a token; it should return 200 `ignored`.

Limits: Vercel caps request bodies at 4.5 MB, so emails with large attachments are rejected (413) and Postmark retries, then gives up. Use "Include raw email content" = off.

**Tests:** `tests/unit/email-inbound.test.ts` covers parsing, forwards, direction and address handling. `tests/integration/email-capture.test.ts` covers auth, matching, deal linking, scope limits, idempotency, rotated addresses, the review queue and RLS.

## Planned connectors and what blocks them

None of these is connected. Each needs credentials or vendor approval that only Exato can obtain.

| Connector | Phase | External prerequisites (owner: Exato) |
| --- | --- | --- |
| Microsoft 365 / Outlook / Graph | 4 | Entra app registration; admin consent for `Mail.ReadWrite`, `Mail.Send`, `Calendars.ReadWrite`, `offline_access`; HTTPS endpoint for change notifications |
| Google Workspace (Gmail, Calendar, Drive) | 4 | Google Cloud OAuth client; Google OAuth verification for restricted Gmail scopes, including a CASA security assessment if used beyond Exato's own domain |
| Meta Lead Ads | 4 | Meta app with `leads_retrieval`, `pages_manage_ads` and `ads_read` via App Review; Business Verification |
| LinkedIn Lead Gen Forms | 4 | LinkedIn Marketing Developer Platform or Lead Sync API approval. Scraping is out of scope. |
| Google Ads | 4 | Developer token (Basic access) and OAuth client |
| WhatsApp Business Platform | 4 | WABA, verified number, approved templates |
| Salesforce / HubSpot / Dynamics 365 / Zoho | 4 | Connected app or API credentials in the source org |
| ServiceNow / Zendesk / Freshdesk / Jira SM | 6 | Instance OAuth apps |
| DocuSign | 6 | Integration key and go-live review |
| Stripe / Razorpay / ERP | 6 | Restricted read keys |
| Email sending (Resend or SMTP) | 4 | Verified sending domain (SPF/DKIM/DMARC) |

Priority order once credentials exist: Microsoft 365 (mail and calendar), then Meta Lead Ads, then LinkedIn Lead Gen, then Google Workspace, then Google Ads. The first four reuse the OAuth and sync infrastructure built for Microsoft 365.

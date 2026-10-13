/**
 * Connector registry. Every connector implements the same contract
 * (see `Connector` below); the registry also lists planned connectors with
 * the external approvals they need, so the UI never implies a connection
 * that does not exist.
 */

export type AuthType = "webhook_secret" | "oauth2_pkce" | "oauth2" | "api_key" | "service_account";
export type Capability = "inbound_leads" | "contacts_sync" | "email_sync" | "email_send" | "calendar_sync" | "ads_reporting" | "lead_ads" | "crm_sync" | "files" | "messaging" | "esign" | "tickets" | "billing";

export interface ProviderInfo {
  key: string;
  name: string;
  category: "Website & forms" | "Productivity" | "Advertising" | "Communication" | "CRM & support" | "Documents" | "Finance";
  description: string;
  auth: AuthType;
  capabilities: Capability[];
  /** implemented = usable now; planned = interface designed, not built. */
  availability: "implemented" | "planned";
  phase?: number;
  /** External prerequisites the customer or vendor must provide. */
  prerequisites: string[];
}

export const PROVIDERS: ProviderInfo[] = [
  {
    key: "website_forms",
    name: "Website forms (signed webhook)",
    category: "Website & forms",
    description: "Receive enquiries from any website or form tool as leads, via an HMAC-signed HTTPS webhook.",
    auth: "webhook_secret",
    capabilities: ["inbound_leads"],
    availability: "implemented",
    prerequisites: ["Ability to send a server-side POST from your website or form tool"],
  },
  {
    key: "microsoft_365",
    name: "Microsoft 365 / Outlook",
    category: "Productivity",
    description: "Mailbox and calendar sync, email sending and Teams meeting metadata via Microsoft Graph.",
    auth: "oauth2_pkce",
    capabilities: ["email_sync", "email_send", "calendar_sync", "contacts_sync", "files"],
    availability: "planned",
    phase: 4,
    prerequisites: ["Microsoft Entra app registration (client ID/secret)", "Admin consent for Mail.ReadWrite, Calendars.ReadWrite, offline_access", "Graph change-notification endpoint reachable over HTTPS"],
  },
  {
    key: "google_workspace",
    name: "Google Workspace",
    category: "Productivity",
    description: "Gmail and Google Calendar sync and sending; Drive file references.",
    auth: "oauth2_pkce",
    capabilities: ["email_sync", "email_send", "calendar_sync", "files"],
    availability: "planned",
    phase: 4,
    prerequisites: ["Google Cloud OAuth client", "OAuth verification for restricted Gmail scopes (CASA assessment for external use)"],
  },
  {
    key: "meta_lead_ads",
    name: "Meta Lead Ads",
    category: "Advertising",
    description: "Ingest Facebook/Instagram lead-form submissions; campaign spend reporting.",
    auth: "oauth2",
    capabilities: ["lead_ads", "ads_reporting"],
    availability: "planned",
    phase: 4,
    prerequisites: ["Meta app with leads_retrieval and ads_read (App Review)", "Business verification", "Page access token for each page"],
  },
  {
    key: "linkedin",
    name: "LinkedIn Lead Gen Forms",
    category: "Advertising",
    description: "Lead Gen Form responses and campaign reporting via the LinkedIn Marketing APIs.",
    auth: "oauth2",
    capabilities: ["lead_ads", "ads_reporting"],
    availability: "planned",
    phase: 4,
    prerequisites: ["Approved access to LinkedIn Marketing Developer Platform / Lead Sync API", "Ad account admin authorisation"],
  },
  {
    key: "google_ads",
    name: "Google Ads",
    category: "Advertising",
    description: "Campaign, spend, click and conversion reporting; lead form extensions.",
    auth: "oauth2",
    capabilities: ["ads_reporting", "lead_ads"],
    availability: "planned",
    phase: 4,
    prerequisites: ["Google Ads API developer token (Basic access or higher)", "OAuth client"],
  },
  {
    key: "whatsapp",
    name: "WhatsApp Business Platform",
    category: "Communication",
    description: "Approved-template messaging and inbound conversations linked to contacts.",
    auth: "api_key",
    capabilities: ["messaging"],
    availability: "planned",
    phase: 4,
    prerequisites: ["WhatsApp Business Account and verified phone number", "Approved message templates"],
  },
  {
    key: "salesforce",
    name: "Salesforce",
    category: "CRM & support",
    description: "Bidirectional account, contact and opportunity sync with field-level source-of-truth rules.",
    auth: "oauth2_pkce",
    capabilities: ["crm_sync"],
    availability: "planned",
    phase: 4,
    prerequisites: ["Connected App in the customer's Salesforce org", "API-enabled edition"],
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "CRM & support",
    description: "Contact, company and deal sync.",
    auth: "oauth2",
    capabilities: ["crm_sync"],
    availability: "planned",
    phase: 4,
    prerequisites: ["HubSpot public or private app"],
  },
  {
    key: "dynamics_365",
    name: "Microsoft Dynamics 365",
    category: "CRM & support",
    description: "Account, contact and opportunity sync via Dataverse Web API.",
    auth: "oauth2",
    capabilities: ["crm_sync"],
    availability: "planned",
    phase: 4,
    prerequisites: ["Entra app registration with Dataverse permissions"],
  },
  {
    key: "servicenow",
    name: "ServiceNow",
    category: "CRM & support",
    description: "Support ticket references on accounts for managed-services customers.",
    auth: "oauth2",
    capabilities: ["tickets"],
    availability: "planned",
    phase: 6,
    prerequisites: ["ServiceNow instance OAuth application"],
  },
  {
    key: "docusign",
    name: "DocuSign",
    category: "Documents",
    description: "Send approved proposals for e-signature and track envelope status.",
    auth: "oauth2",
    capabilities: ["esign"],
    availability: "planned",
    phase: 6,
    prerequisites: ["DocuSign integration key and go-live review"],
  },
  {
    key: "stripe",
    name: "Stripe / Razorpay",
    category: "Finance",
    description: "Invoice and payment status references for won deals.",
    auth: "api_key",
    capabilities: ["billing"],
    availability: "planned",
    phase: 6,
    prerequisites: ["Restricted API key with read access"],
  },
];

export function provider(key: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

/**
 * Contract every connector implements. Only `website_forms` is implemented;
 * OAuth/sync connectors will implement the optional members.
 */
export interface Connector<Config, Payload> {
  info: ProviderInfo;
  parseConfig(raw: unknown): Config;
  /** Verifies authenticity of an inbound request (webhook connectors). */
  verifyInbound?(rawBody: string, headers: Headers, secret: string): { ok: true } | { ok: false; reason: string };
  /** Validates and maps an inbound payload into CRM input. */
  mapInbound?(payload: unknown, config: Config): { ok: true; value: Payload; externalId: string | null } | { ok: false; reason: string };
  /** OAuth connectors: build the authorisation URL (state + PKCE verifier stored server-side). */
  authorizeUrl?(state: string, codeChallenge: string): string;
  /** Pull connectors: fetch the next page after `cursor`; must be idempotent. */
  syncPage?(cursor: string | null): Promise<{ records: unknown[]; nextCursor: string | null }>;
  testConnection?(): Promise<{ ok: boolean; detail: string }>;
}

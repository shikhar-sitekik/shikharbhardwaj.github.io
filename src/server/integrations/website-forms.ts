import { z } from "zod";
import { verifyWebhookSignature } from "@/server/lib/crypto";
import { provider, type Connector } from "./registry";

export const websiteFormConfigSchema = z.object({
  defaultSource: z.string().max(50).default("website"),
  defaultOwnerId: z.string().uuid().nullable().default(null),
});
export type WebsiteFormConfig = z.infer<typeof websiteFormConfigSchema>;

const str = (max: number) => z.string().trim().max(max).optional().nullable();

/** Accepted payload (snake_case or camelCase). Unknown keys are ignored. */
export const websiteFormPayloadSchema = z
  .object({
    event_id: str(200),
    first_name: str(100),
    last_name: str(100),
    name: str(200),
    email: str(254),
    phone: str(50),
    company: str(200),
    website: str(300),
    job_title: str(200),
    country: str(100),
    message: str(4000),
    product_interest: str(300),
    consent_email: z.union([z.boolean(), z.string()]).optional().nullable(),
    utm_source: str(200),
    utm_medium: str(200),
    utm_campaign: str(200),
    page_url: str(1000),
  })
  .passthrough();

export interface MappedFormLead {
  firstName: string | null;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  jobTitle: string | null;
  country: string | null;
  businessProblem: string | null;
  productInterest: string | null;
  consentEmail: boolean;
  source: string;
  sourceDetail: string | null;
}

function camelToSnake(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  return out;
}

export const websiteFormsConnector: Connector<WebsiteFormConfig, MappedFormLead> = {
  info: provider("website_forms")!,
  parseConfig: (raw) => websiteFormConfigSchema.parse(raw ?? {}),
  verifyInbound(rawBody, headers, secret) {
    const r = verifyWebhookSignature(headers.get("x-exato-signature"), rawBody, secret);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  mapInbound(payload, config) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "Body must be a JSON object" };
    const flat = camelToSnake((payload as { lead?: unknown }).lead && typeof (payload as { lead?: unknown }).lead === "object" ? { ...(payload as Record<string, unknown>), ...((payload as { lead: Record<string, unknown> }).lead) } : (payload as Record<string, unknown>));
    const parsed = websiteFormPayloadSchema.safeParse(flat);
    if (!parsed.success) return { ok: false, reason: `Invalid payload: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}` };
    const p = parsed.data;
    let first = p.first_name ?? null;
    let last = p.last_name ?? null;
    if (!last && p.name) {
      const parts = p.name.split(/\s+/);
      last = parts.pop() ?? null;
      first = first ?? (parts.join(" ") || null);
    }
    if (!last && p.email) last = p.email.split("@")[0] ?? null;
    if (!last) return { ok: false, reason: "A name or email is required" };
    const consent = p.consent_email === true || (typeof p.consent_email === "string" && ["true", "yes", "on", "1"].includes(p.consent_email.toLowerCase()));
    const detail = [p.utm_source, p.utm_medium, p.utm_campaign].filter(Boolean).join(" / ") || p.page_url || null;
    return {
      ok: true,
      externalId: p.event_id ?? null,
      value: {
        firstName: first,
        lastName: last,
        email: p.email ?? null,
        phone: p.phone ?? null,
        company: p.company ?? null,
        website: p.website ?? null,
        jobTitle: p.job_title ?? null,
        country: p.country ?? null,
        businessProblem: p.message ?? null,
        productInterest: p.product_interest ?? null,
        consentEmail: consent,
        source: config.defaultSource,
        sourceDetail: detail ? detail.slice(0, 300) : null,
      },
    };
  },
};

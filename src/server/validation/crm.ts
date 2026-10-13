import { z } from "zod";
import { CURRENCIES, normalizeDomain, normalizeEmail, normalizePhone } from "@/server/domain/normalize";

/** Empty strings from forms become null. */
const opt = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null),
    z.string().max(max).nullable(),
  );
const optUuid = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable());
const optEmail = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v ?? null),
  z
    .string()
    .nullable()
    .transform((v, c) => {
      if (v === null) return null;
      const e = normalizeEmail(v);
      if (!e) c.addIssue({ code: "custom", message: "Enter a valid email address." });
      return e;
    }),
);
const optPhone = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v ?? null),
  z
    .string()
    .nullable()
    .transform((v, c) => {
      if (v === null) return null;
      const p = normalizePhone(v);
      if (!p) c.addIssue({ code: "custom", message: "Enter a valid phone number with country code." });
      return p;
    }),
);
const optWebsite = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v ?? null),
  z
    .string()
    .nullable()
    .transform((v, c) => {
      if (v === null) return null;
      const d = normalizeDomain(v);
      if (!d) c.addIssue({ code: "custom", message: "Enter a valid website or domain." });
      return d;
    }),
);
const optMoney = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : typeof v === "string" ? v.replace(/,/g, "") : v),
  z.coerce.number().min(0).max(1e13).nullable(),
);
const optDate = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
);
const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());
export const currencySchema = z.enum(CURRENCIES);

export const leadInputSchema = z.object({
  firstName: opt(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  email: optEmail,
  personalEmail: optEmail,
  phone: optPhone,
  jobTitle: opt(200),
  department: opt(200),
  company: opt(200),
  website: optWebsite,
  industry: opt(100),
  subIndustry: opt(100),
  country: opt(100),
  region: opt(100),
  employeeRange: opt(50),
  source: opt(100),
  sourceDetail: opt(300),
  productInterest: opt(300),
  businessProblem: opt(4000),
  statusId: optUuid,
  ownerId: optUuid,
  estimatedValue: optMoney,
  currency: z.preprocess((v) => (v === "" ? null : v ?? null), currencySchema.nullable()),
  consentEmail: checkbox,
  doNotContact: checkbox,
});
export type LeadInput = z.infer<typeof leadInputSchema>;

export const accountInputSchema = z.object({
  name: z.string().trim().min(1, "Account name is required.").max(200),
  website: optWebsite,
  industry: opt(100),
  country: opt(100),
  region: opt(100),
  headquarters: opt(200),
  employeeRange: opt(50),
  ownerId: optUuid,
  parentAccountId: optUuid,
  tier: opt(50),
  status: z.enum(["prospect", "customer", "former_customer", "partner", "other"]).default("prospect"),
  isStrategic: checkbox,
  businessChallenges: opt(4000),
  description: opt(4000),
});
export type AccountInput = z.infer<typeof accountInputSchema>;

export const BUYING_ROLES = [
  "decision_maker",
  "economic_buyer",
  "champion",
  "influencer",
  "evaluator",
  "procurement",
  "blocker",
  "user",
  "other",
] as const;

export const contactInputSchema = z.object({
  firstName: opt(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  email: optEmail,
  phone: optPhone,
  jobTitle: opt(200),
  department: opt(200),
  seniority: opt(50),
  buyingRole: z.preprocess((v) => (v === "" ? null : v ?? null), z.enum(BUYING_ROLES).nullable()),
  accountId: optUuid,
  ownerId: optUuid,
  country: opt(100),
  preferredChannel: opt(50),
  linkedinUrl: z.preprocess(
    (v) => (v === "" ? null : v ?? null),
    z.string().url().max(500).refine((u) => u.startsWith("https://"), "Use an https URL.").nullable(),
  ),
  consentEmail: checkbox,
  doNotContact: checkbox,
});
export type ContactInput = z.infer<typeof contactInputSchema>;

export const opportunityInputSchema = z.object({
  name: z.string().trim().min(1, "Opportunity name is required.").max(200),
  accountId: z.string().uuid("Select an account."),
  primaryContactId: optUuid,
  ownerId: optUuid,
  pipelineId: z.string().uuid(),
  stageId: optUuid,
  amount: optMoney,
  currency: currencySchema,
  probabilityOverride: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().min(0).max(100).nullable(),
  ),
  revenueType: z.enum(["one_time", "recurring"]).default("one_time"),
  contractMonths: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().min(1).max(240).nullable(),
  ),
  expectedCloseDate: optDate,
  estimatedStartDate: optDate,
  source: opt(100),
  nextStep: opt(500),
  decisionCriteria: opt(4000),
  risks: opt(4000),
  technicalRequirements: opt(4000),
  procurementRequirements: opt(4000),
  competitors: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : v ?? [],
    z.array(z.string().max(100)).max(20),
  ),
  forecastCategory: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["pipeline", "best_case", "commit", "closed", "omitted"]).optional(),
  ),
});
export type OpportunityInput = z.infer<typeof opportunityInputSchema>;

export const activityInputSchema = z.object({
  type: z.enum(["note", "task", "call", "email", "meeting"]),
  subject: z.string().trim().min(1, "Subject is required.").max(300),
  body: opt(10000),
  dueAt: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable()),
  occurredAt: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable()),
  durationMinutes: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().min(0).max(1440).nullable(),
  ),
  outcome: opt(200),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  ownerId: optUuid,
  leadId: optUuid,
  accountId: optUuid,
  contactId: optUuid,
  opportunityId: optUuid,
});
export type ActivityInput = z.infer<typeof activityInputSchema>;

export function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

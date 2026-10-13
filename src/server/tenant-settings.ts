import { z } from "zod";

export const scoringRuleSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.enum(["fit", "intent", "engagement", "company", "product", "source", "recency"]),
  field: z.string().min(1),
  operator: z.enum(["equals", "in", "contains", "present", "gte", "lte", "within_days"]),
  value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
  points: z.number().int().min(-100).max(100),
});
export type ScoringRule = z.infer<typeof scoringRuleSchema>;

export const tenantSettingsSchema = z.object({
  baseCurrency: z.string().length(3).default("USD"),
  timezone: z.string().default("UTC"),
  locale: z.string().default("en-US"),
  dateFormat: z.enum(["yyyy-MM-dd", "dd/MM/yyyy", "MM/dd/yyyy", "d MMM yyyy"]).default("d MMM yyyy"),
  staleLeadDays: z.number().int().min(1).max(365).default(7),
  staleOpportunityDays: z.number().int().min(1).max(365).default(14),
  /** Lead score thresholds: >= hot is "hot", >= warm is "warm". */
  scoreThresholds: z.object({ warm: z.number().int(), hot: z.number().int() }).default({ warm: 40, hot: 70 }),
  scoringRules: z.array(scoringRuleSchema).default([]),
  /**
   * Static FX rates to the base currency (1 unit of key = value base units).
   * Used for reporting conversion only; original deal values are preserved.
   * Replace with an approved rate source integration for production finance use.
   */
  fxRates: z.record(z.string().length(3), z.number().positive()).default({}),
  /** Round-robin cursor for lead assignment. */
  assignment: z
    .object({
      mode: z.enum(["none", "round_robin"]).default("none"),
      userIds: z.array(z.string().uuid()).default([]),
      cursor: z.number().int().min(0).default(0),
    })
    .default({ mode: "none", userIds: [], cursor: 0 }),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export function parseTenantSettings(raw: unknown): TenantSettings {
  const parsed = tenantSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : tenantSettingsSchema.parse({});
}

export const DEFAULT_SCORING_RULES: ScoringRule[] = [
  { id: "fit-title", label: "Senior title", category: "fit", field: "jobTitle", operator: "contains", value: ["chief", "head", "director", "vp", "vice president", "cxo", "cto", "cio", "ceo"], points: 20 },
  { id: "company-size", label: "Mid/large enterprise", category: "company", field: "employeeRange", operator: "in", value: ["201-500", "501-1000", "1001-5000", "5001-10000", "10000+"], points: 15 },
  { id: "business-email", label: "Business email provided", category: "fit", field: "email", operator: "present", points: 10 },
  { id: "intent-problem", label: "Business problem described", category: "intent", field: "businessProblem", operator: "present", points: 15 },
  { id: "product-interest", label: "Product interest stated", category: "product", field: "productInterest", operator: "present", points: 10 },
  { id: "source-referral", label: "Referral or partner source", category: "source", field: "source", operator: "in", value: ["referral", "partner"], points: 15 },
  { id: "source-inbound", label: "Inbound website enquiry", category: "source", field: "source", operator: "in", value: ["website", "webinar", "event"], points: 10 },
  { id: "recent-contact", label: "Contacted in last 14 days", category: "recency", field: "lastContactedAt", operator: "within_days", value: 14, points: 5 },
];

/** Shared option lists (importable from server and client components). */
export const LEAD_SOURCES = ["website", "referral", "partner", "event", "webinar", "linkedin", "paid_search", "paid_social", "email", "outbound", "other"] as const;
export const EMPLOYEE_RANGES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5001-10000", "10000+"] as const;
export const ACCOUNT_STATUSES = [
  { value: "prospect", label: "Prospect" },
  { value: "customer", label: "Customer" },
  { value: "former_customer", label: "Former customer" },
  { value: "partner", label: "Partner" },
  { value: "other", label: "Other" },
] as const;
export const BUYING_ROLE_LABELS: Record<string, string> = {
  decision_maker: "Decision maker",
  economic_buyer: "Economic buyer",
  champion: "Champion",
  influencer: "Influencer",
  evaluator: "Evaluator",
  procurement: "Procurement",
  blocker: "Blocker",
  user: "User",
  other: "Other",
};

/**
 * Pipeline and revenue definitions. These are the single source of truth for
 * metric formulas; see docs/METRICS.md for the business definitions.
 */

export interface DealMoney {
  amount: string | number;
  currency: string;
  revenueType: "one_time" | "recurring";
  contractMonths: number | null;
}

const toNumber = (v: string | number): number => (typeof v === "number" ? v : Number(v));

/** Effective probability (0-100): explicit override, else the stage default. */
export function effectiveProbability(stageProbability: number, override: number | null | undefined): number {
  const p = override ?? stageProbability;
  return Math.max(0, Math.min(100, p));
}

/**
 * Total contract value: `amount` is always recorded as the full contract value
 * for the deal, regardless of revenue type.
 */
export function totalContractValue(deal: DealMoney): number {
  return toNumber(deal.amount);
}

/**
 * Annual recurring revenue: for recurring deals with a known term,
 * TCV / months × 12. One-time deals have ARR 0. Recurring deals without a
 * term return null ("unknown"), never a guess.
 */
export function annualRecurringRevenue(deal: DealMoney): number | null {
  if (deal.revenueType !== "recurring") return 0;
  if (!deal.contractMonths || deal.contractMonths <= 0) return null;
  return (toNumber(deal.amount) / deal.contractMonths) * 12;
}

/** Weighted value = amount × probability. */
export function weightedAmount(amount: string | number, probability: number): number {
  return (toNumber(amount) * effectiveProbability(probability, null)) / 100;
}

/**
 * Converts an amount to the base currency using rates expressed as
 * "1 unit of currency = rate base units". Returns null when no rate is known
 * so reports can flag unconverted deals instead of silently mixing currencies.
 */
export function convertToBase(
  amount: string | number,
  currency: string,
  baseCurrency: string,
  rates: Record<string, number>,
): number | null {
  const n = toNumber(amount);
  if (currency === baseCurrency) return n;
  const rate = rates[currency];
  return rate && rate > 0 ? n * rate : null;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 864e5);
}

/** Fields an opportunity must have before entering a stage. Returns the missing keys. */
export function missingRequiredFields(
  required: readonly string[],
  opp: Record<string, unknown>,
): string[] {
  return required.filter((key) => {
    const v = opp[key];
    if (v === null || v === undefined || v === "") return true;
    if (key === "amount" && Number(v) <= 0) return true;
    return false;
  });
}

export const OPPORTUNITY_FIELD_LABELS: Record<string, string> = {
  amount: "Deal value",
  expectedCloseDate: "Expected close date",
  primaryContactId: "Primary contact",
  lossReason: "Loss reason",
  contractMonths: "Contract duration",
  nextStep: "Next step",
  decisionCriteria: "Decision criteria",
};

/** Default forecast category implied by stage category and probability. */
export function impliedForecastCategory(
  stageCategory: "open" | "won" | "lost",
  probability: number,
): "pipeline" | "best_case" | "commit" | "closed" | "omitted" {
  if (stageCategory === "won") return "closed";
  if (stageCategory === "lost") return "omitted";
  if (probability >= 75) return "commit";
  if (probability >= 40) return "best_case";
  return "pipeline";
}

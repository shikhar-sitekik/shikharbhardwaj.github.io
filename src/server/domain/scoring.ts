import type { ScoringRule } from "@/server/tenant-settings";

/** The subset of lead fields scoring rules can reference. */
export type ScorableLead = Partial<Record<string, string | number | boolean | Date | null>>;

export interface ScoreResult {
  score: number;
  /** rule id → points awarded (only matched rules). */
  breakdown: Record<string, number>;
}

function matches(rule: ScoringRule, raw: unknown, now: Date): boolean {
  const present = raw !== null && raw !== undefined && raw !== "";
  switch (rule.operator) {
    case "present":
      return present;
    case "equals":
      return present && String(raw).toLowerCase() === String(rule.value ?? "").toLowerCase();
    case "in": {
      const list = Array.isArray(rule.value) ? rule.value : [String(rule.value ?? "")];
      return present && list.some((v) => v.toLowerCase() === String(raw).toLowerCase());
    }
    case "contains": {
      if (!present) return false;
      const hay = String(raw).toLowerCase();
      const needles = Array.isArray(rule.value) ? rule.value : [String(rule.value ?? "")];
      return needles.some((n) => n && new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay));
    }
    case "gte":
      return present && Number(raw) >= Number(rule.value);
    case "lte":
      return present && Number(raw) <= Number(rule.value);
    case "within_days": {
      if (!present) return false;
      const d = raw instanceof Date ? raw : new Date(String(raw));
      if (Number.isNaN(d.getTime())) return false;
      return now.getTime() - d.getTime() <= Number(rule.value) * 864e5 && d.getTime() <= now.getTime();
    }
  }
}

/**
 * Deterministic, explainable lead score: the sum of points from matching
 * rules, clamped to 0..100. Each rule's contribution is recorded so users can
 * see why a lead scored what it did.
 */
export function scoreLead(lead: ScorableLead, rules: ScoringRule[], now: Date = new Date()): ScoreResult {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const rule of rules) {
    if (matches(rule, lead[rule.field], now)) {
      breakdown[rule.id] = rule.points;
      total += rule.points;
    }
  }
  return { score: Math.max(0, Math.min(100, total)), breakdown };
}

export function scoreBand(score: number, thresholds: { warm: number; hot: number }): "hot" | "warm" | "cold" {
  if (score >= thresholds.hot) return "hot";
  if (score >= thresholds.warm) return "warm";
  return "cold";
}

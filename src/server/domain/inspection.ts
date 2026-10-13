/**
 * Deterministic deal-inspection signals. Rule-based (not AI): every flag is
 * explainable from stored data. AI summaries are a planned, separate layer.
 */
export type Severity = "risk" | "warning" | "ok";

export interface Signal {
  key: string;
  severity: Severity;
  label: string;
  detail: string;
}

export interface InspectionInput {
  now: Date;
  stageCategory: "open" | "won" | "lost";
  daysInStage: number;
  staleDays: number;
  lastActivityAt: Date | null;
  expectedCloseDate: string | null;
  nextStep: string | null;
  openTasks: number;
  committeeRoles: string[];
  committeeSize: number;
  nextStageMissing: string[];
  closeDateChanges: number;
  amount: number;
}

export function inspectDeal(i: InspectionInput): Signal[] {
  if (i.stageCategory !== "open") return [];
  const out: Signal[] = [];
  const today = i.now.toISOString().slice(0, 10);
  if (i.expectedCloseDate && i.expectedCloseDate < today)
    out.push({ key: "close-past", severity: "risk", label: "Close date has passed", detail: `Expected ${i.expectedCloseDate}. Update the date or the stage.` });
  if (!i.expectedCloseDate) out.push({ key: "close-missing", severity: "warning", label: "No expected close date", detail: "Forecasts exclude undated deals from period views." });
  const sinceActivity = i.lastActivityAt ? Math.floor((i.now.getTime() - i.lastActivityAt.getTime()) / 864e5) : null;
  if (sinceActivity === null) out.push({ key: "no-activity", severity: "warning", label: "No logged activity", detail: "No calls, meetings, emails or notes recorded." });
  else if (sinceActivity > i.staleDays) out.push({ key: "stale", severity: "risk", label: `No activity for ${sinceActivity} days`, detail: `Threshold is ${i.staleDays} days.` });
  if (i.daysInStage > i.staleDays * 3) out.push({ key: "stuck", severity: "warning", label: `${i.daysInStage} days in current stage`, detail: "Consider whether the stage still reflects reality." });
  if (!i.nextStep) out.push({ key: "next-step", severity: "warning", label: "No next step recorded", detail: "Agree and record a dated next step with the customer." });
  if (i.openTasks === 0) out.push({ key: "no-tasks", severity: "warning", label: "No open follow-up tasks", detail: "Nothing is scheduled to move this deal forward." });
  const roles = new Set(i.committeeRoles);
  const missing = (["decision_maker", "economic_buyer", "champion"] as const).filter((r) => !roles.has(r));
  if (missing.length)
    out.push({ key: "committee", severity: i.committeeSize <= 1 ? "risk" : "warning", label: "Buying committee gaps", detail: `Not identified: ${missing.map((r) => r.replace("_", " ")).join(", ")}.` });
  if (i.closeDateChanges >= 2) out.push({ key: "slipping", severity: "risk", label: `Close date moved ${i.closeDateChanges} times`, detail: "Repeated slippage lowers forecast confidence." });
  if (i.amount <= 0) out.push({ key: "amount", severity: "warning", label: "No deal value", detail: "Pipeline and forecast exclude zero-value deals." });
  if (i.nextStageMissing.length) out.push({ key: "next-stage", severity: "ok", label: "Next stage needs", detail: i.nextStageMissing.join(", ") });
  return out;
}

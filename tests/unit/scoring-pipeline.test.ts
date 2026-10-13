import { describe, expect, it } from "vitest";
import { scoreBand, scoreLead } from "@/server/domain/scoring";
import {
  annualRecurringRevenue,
  convertToBase,
  effectiveProbability,
  impliedForecastCategory,
  missingRequiredFields,
  totalContractValue,
  weightedAmount,
} from "@/server/domain/pipeline";
import { DEFAULT_SCORING_RULES } from "@/server/tenant-settings";

describe("scoreLead", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("sums matched rules and explains them", () => {
    const r = scoreLead(
      {
        jobTitle: "Head of Customer Experience",
        employeeRange: "1001-5000",
        email: "a@acme.com",
        businessProblem: "Contact centre AHT too high",
        source: "referral",
        lastContactedAt: new Date("2026-09-25T00:00:00Z"),
      },
      DEFAULT_SCORING_RULES,
      now,
    );
    expect(r.breakdown).toEqual({
      "fit-title": 20,
      "company-size": 15,
      "business-email": 10,
      "intent-problem": 15,
      "source-referral": 15,
      "recent-contact": 5,
    });
    expect(r.score).toBe(80);
  });
  it("does not match title keywords inside other words", () => {
    // "vp" must not match "mvp"; "head" must not match "headless".
    const r = scoreLead({ jobTitle: "MVP headless engineer" }, DEFAULT_SCORING_RULES, now);
    expect(r.breakdown["fit-title"]).toBeUndefined();
  });
  it("clamps to 0..100", () => {
    const r = scoreLead({ x: "1" }, [{ id: "a", label: "a", category: "fit", field: "x", operator: "present", points: 100 }, { id: "b", label: "b", category: "fit", field: "x", operator: "present", points: 100 }]);
    expect(r.score).toBe(100);
  });
  it("bands by thresholds", () => {
    expect(scoreBand(75, { warm: 40, hot: 70 })).toBe("hot");
    expect(scoreBand(40, { warm: 40, hot: 70 })).toBe("warm");
    expect(scoreBand(10, { warm: 40, hot: 70 })).toBe("cold");
  });
});

describe("pipeline math", () => {
  it("probability override wins and is clamped", () => {
    expect(effectiveProbability(30, null)).toBe(30);
    expect(effectiveProbability(30, 55)).toBe(55);
    expect(effectiveProbability(30, 150)).toBe(100);
  });
  it("weighted amount", () => {
    expect(weightedAmount("200000", 25)).toBe(50000);
  });
  it("TCV and ARR definitions", () => {
    const recurring = { amount: "360000", currency: "USD", revenueType: "recurring" as const, contractMonths: 36 };
    expect(totalContractValue(recurring)).toBe(360000);
    expect(annualRecurringRevenue(recurring)).toBe(120000);
    expect(annualRecurringRevenue({ ...recurring, contractMonths: null })).toBeNull();
    expect(annualRecurringRevenue({ ...recurring, revenueType: "one_time" })).toBe(0);
  });
  it("FX conversion returns null for unknown rates instead of mixing currencies", () => {
    expect(convertToBase("100", "USD", "USD", {})).toBe(100);
    expect(convertToBase("100", "EUR", "USD", { EUR: 1.1 })).toBeCloseTo(110);
    expect(convertToBase("100", "INR", "USD", {})).toBeNull();
  });
  it("finds missing stage requirements", () => {
    expect(missingRequiredFields(["amount", "expectedCloseDate"], { amount: "0", expectedCloseDate: null })).toEqual([
      "amount",
      "expectedCloseDate",
    ]);
    expect(missingRequiredFields(["amount"], { amount: "10" })).toEqual([]);
  });
  it("implied forecast category", () => {
    expect(impliedForecastCategory("won", 100)).toBe("closed");
    expect(impliedForecastCategory("lost", 0)).toBe("omitted");
    expect(impliedForecastCategory("open", 80)).toBe("commit");
    expect(impliedForecastCategory("open", 50)).toBe("best_case");
    expect(impliedForecastCategory("open", 10)).toBe("pipeline");
  });
});

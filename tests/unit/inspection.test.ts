import { describe, expect, it } from "vitest";
import { inspectDeal, type InspectionInput } from "@/server/domain/inspection";

const base: InspectionInput = {
  now: new Date("2026-10-13T00:00:00Z"),
  stageCategory: "open",
  daysInStage: 3,
  staleDays: 14,
  lastActivityAt: new Date("2026-10-10T00:00:00Z"),
  expectedCloseDate: "2026-12-01",
  nextStep: "Workshop on 20 Oct",
  openTasks: 1,
  committeeRoles: ["decision_maker", "economic_buyer", "champion"],
  committeeSize: 3,
  nextStageMissing: [],
  closeDateChanges: 0,
  amount: 100000,
};

describe("inspectDeal", () => {
  it("returns no flags for a healthy deal", () => {
    expect(inspectDeal(base)).toEqual([]);
  });
  it("flags past close dates, staleness, committee gaps and slippage", () => {
    const keys = inspectDeal({
      ...base,
      expectedCloseDate: "2026-09-30",
      lastActivityAt: new Date("2026-09-01T00:00:00Z"),
      committeeRoles: ["influencer"],
      committeeSize: 1,
      closeDateChanges: 3,
      nextStep: null,
      openTasks: 0,
    }).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["close-past", "stale", "committee", "slipping", "next-step", "no-tasks"]));
  });
  it("ignores closed deals", () => {
    expect(inspectDeal({ ...base, stageCategory: "won", nextStep: null })).toEqual([]);
  });
});

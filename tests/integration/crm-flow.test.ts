import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, withScope } from "@/server/db/client";
import { leads } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/permissions";
import {
  assignLeads,
  convertLead,
  createLead,
  findDuplicates,
  getLead,
  listLeads,
  listLeadStatuses,
  mergeLeads,
  setLeadStatus,
  updateLead,
} from "@/server/services/leads";
import { createAccount, getAccount, listAccounts, updateAccount } from "@/server/services/accounts";
import {
  createOpportunity,
  getOpportunity,
  listPipelines,
  moveOpportunityStage,
  pipelineBoard,
} from "@/server/services/opportunities";
import { createActivity, listTasks, setTaskCompleted, timelineFor } from "@/server/services/activities";
import { executiveMetrics, workspaceSummary } from "@/server/services/metrics";
import { globalSearch } from "@/server/services/search";
import { queryAudit, updateTenantSettings } from "@/server/services/admin";
import { makeMember, makeTenant, refresh, resetDatabase } from "./helpers";

beforeAll(async () => {
  await resetDatabase();
});

describe("lead → opportunity → won lifecycle", () => {
  it("runs end to end with audit, history and metrics", async () => {
    const { admin } = await makeTenant("Lifecycle");
    const lead = await createLead(admin, {
      firstName: "Priya",
      lastName: "Shah",
      email: "Priya.Shah@Globex.com",
      company: "Globex",
      jobTitle: "Head of Customer Experience",
      source: "referral",
      businessProblem: "High contact-centre AHT",
      employeeRange: "1001-5000",
    });
    expect(lead.email).toBe("priya.shah@globex.com");
    expect(lead.domain).toBe("globex.com");
    expect(lead.score).toBeGreaterThanOrEqual(70);
    expect(lead.ownerId).toBe(admin.userId);

    const statuses = await listLeadStatuses(admin);
    const qualified = statuses.find((s) => s.key === "qualified")!;
    await setLeadStatus(admin, [lead.id], qualified.id);

    await createActivity(admin, { type: "call", subject: "Discovery call", leadId: lead.id, outcome: "connected" });
    const afterCall = await getLead(admin, lead.id);
    expect(afterCall.lead.lastContactedAt).not.toBeNull();

    const pipelines = await listPipelines(admin);
    const enterprise = pipelines.find((p) => p.isDefault)!;
    const result = await convertLead(admin, lead.id, {
      accountId: null,
      contactId: null,
      createOpportunity: true,
      opportunity: { name: "Globex – CX transformation", pipelineId: enterprise.id, amount: 250000, currency: "USD", expectedCloseDate: "2026-12-15" },
    });
    expect(result.opportunityId).not.toBeNull();

    // Converting twice must fail.
    await expect(convertLead(admin, lead.id, { accountId: null, contactId: null, createOpportunity: false })).rejects.toBeInstanceOf(ValidationError);

    // Lead history follows the converted records.
    const accountTimeline = await timelineFor(admin, { type: "account", id: result.accountId });
    expect(accountTimeline.map((t) => t.subject)).toContain("Discovery call");

    const account = await getAccount(admin, result.accountId);
    expect(account.account.domain).toBe("globex.com");
    expect(account.contacts).toHaveLength(1);

    const oppId = result.opportunityId!;
    const negotiation = enterprise.stages.find((s) => s.name === "Negotiation")!;
    await moveOpportunityStage(admin, oppId, { stageId: negotiation.id });
    const lost = enterprise.stages.find((s) => s.category === "lost")!;
    // Closed Lost requires a loss reason.
    await expect(moveOpportunityStage(admin, oppId, { stageId: lost.id })).rejects.toThrow(/Loss reason/);
    const won = enterprise.stages.find((s) => s.category === "won")!;
    const wonOpp = await moveOpportunityStage(admin, oppId, { stageId: won.id });
    expect(wonOpp.closedAt).not.toBeNull();
    expect(wonOpp.forecastCategory).toBe("closed");

    const detail = await getOpportunity(admin, oppId);
    expect(detail.history.map((h) => h.toStageId)).toEqual([won.id, negotiation.id, enterprise.stages[0]!.id]);
    expect(detail.committee).toHaveLength(1);

    const m = await executiveMetrics(admin, enterprise.id);
    expect(m.closedWon).toBe(250000);
    expect(m.wonCount).toBe(1);
    expect(m.winRate).toBe(1);
    expect(m.newLeads).toBe(1);
    expect(m.convertedLeads).toBe(1);

    const audit = await queryAudit(admin, { entityType: "lead", entityId: lead.id });
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["lead.created", "lead.status_changed", "lead.converted"]));

    // Outbox is tenant-isolated too: an unscoped read sees nothing.
    expect(await db().execute(sql`select type from outbox_events`)).toHaveLength(0);
    const events = await withScope(admin, (tx) => tx.execute<{ type: string }>(sql`select type from outbox_events order by occurred_at`));
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["lead.qualified", "lead.converted", "opportunity.won"]));
  });

  it("enforces stage requirements on create and update", async () => {
    const { admin } = await makeTenant("Stages");
    const acc = await createAccount(admin, { name: "Initech", website: "initech.example.com" });
    const [enterprise] = await listPipelines(admin);
    const proposal = enterprise!.stages.find((s) => s.name === "Commercial Proposal")!;
    await expect(
      createOpportunity(admin, { name: "Deal", accountId: acc.id, pipelineId: enterprise!.id, stageId: proposal.id, currency: "USD" }),
    ).rejects.toThrow(/Deal value/);
    const ok = await createOpportunity(admin, {
      name: "Deal",
      accountId: acc.id,
      pipelineId: enterprise!.id,
      stageId: proposal.id,
      currency: "USD",
      amount: "120000",
      expectedCloseDate: "2026-11-30",
    });
    expect(ok.forecastCategory).toBe("best_case");
    const board = await pipelineBoard(admin, enterprise!.id);
    expect(board.rows.map((r) => r.id)).toContain(ok.id);
  });

  it("detects duplicates and merges leads", async () => {
    const { admin } = await makeTenant("Dupes");
    const a = await createLead(admin, { lastName: "Rao", email: "arun@umbrella.com", company: "Umbrella" });
    const b = await createLead(admin, { firstName: "Arun", lastName: "Rao", email: "ARUN@umbrella.com", phone: "+91 98765 43210" });
    const dupes = await findDuplicates(admin, { email: "arun@umbrella.com" });
    expect(dupes.filter((d) => d.entityType === "lead").map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
    await createActivity(admin, { type: "note", subject: "Met at event", leadId: b.id });
    const merged = await mergeLeads(admin, a.id, b.id, { firstName: "source" });
    expect(merged.firstName).toBe("Arun");
    expect(merged.phone).toBe("+919876543210");
    const tl = await timelineFor(admin, { type: "lead", id: a.id });
    expect(tl.map((t) => t.subject)).toContain("Met at event");
    await expect(getLead(admin, b.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects duplicate account domains and hierarchy cycles", async () => {
    const { admin } = await makeTenant("Accounts");
    const parent = await createAccount(admin, { name: "Parent Co", website: "https://www.parent.example" });
    await expect(createAccount(admin, { name: "Clone", website: "parent.example" })).rejects.toBeInstanceOf(ValidationError);
    const child = await createAccount(admin, { name: "Child Co", parentAccountId: parent.id });
    await expect(updateAccount(admin, parent.id, { name: "Parent Co", website: "parent.example", parentAccountId: child.id })).rejects.toThrow(/cycle/);
  });

  it("tasks, workspace summary and search", async () => {
    const { admin } = await makeTenant("Tasks");
    const lead = await createLead(admin, { firstName: "Mei", lastName: "Chen", company: "Wayne Enterprises" });
    const t = await createActivity(admin, { type: "task", subject: "Send deck", leadId: lead.id, dueAt: new Date(Date.now() - 3600_000).toISOString() });
    let summary = await workspaceSummary(admin);
    expect(summary.overdueTasks).toBe(1);
    expect((await listTasks(admin, { status: "overdue" })).map((x) => x.id)).toEqual([t.id]);
    await setTaskCompleted(admin, t.id, true);
    summary = await workspaceSummary(admin);
    expect(summary.overdueTasks).toBe(0);
    const hits = await globalSearch(admin, "wayne");
    expect(hits[0]?.id).toBe(lead.id);
    await expect(createActivity(admin, { type: "task", subject: "No due", leadId: lead.id })).rejects.toThrow(/due date/);
  });

  it("round-robin assignment rotates owners", async () => {
    const { admin } = await makeTenant("RR");
    const r1 = await makeMember(admin, "sales_rep");
    const r2 = await makeMember(admin, "sales_rep");
    await updateTenantSettings(admin, { assignment: { mode: "round_robin", userIds: [r1.userId, r2.userId], cursor: 0 } });
    const ctx = await refresh(admin);
    const owners = [];
    for (let i = 0; i < 4; i += 1) owners.push((await createLead(ctx, { lastName: `L${i}` })).ownerId);
    expect(owners).toEqual([r1.userId, r2.userId, r1.userId, r2.userId]);
  });
});

describe("authorisation and tenant isolation", () => {
  it("isolates tenants at the service layer and in Postgres RLS", async () => {
    const t1 = await makeTenant("Tenant One");
    const t2 = await makeTenant("Tenant Two");
    const lead = await createLead(t1.admin, { lastName: "Secret", company: "Hidden Corp" });
    await expect(getLead(t2.admin, lead.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listLeads(t2.admin)).total).toBe(0);
    expect(await globalSearch(t2.admin, "hidden")).toEqual([]);
    // Even raw SQL under tenant two's scope cannot see tenant one's rows.
    const raw = await withScope(t2.admin, (tx) => tx.select().from(leads));
    expect(raw).toHaveLength(0);
    // And cannot write into another tenant.
    await expect(
      withScope(t2.admin, (tx) => tx.update(leads).set({ lastName: "pwned" }).where(sql`id = ${lead.id}`).returning()),
    ).resolves.toEqual([]);
    const err = await withScope(t2.admin, (tx) =>
      tx.insert(leads).values({ tenantId: t1.tenantId, lastName: "x", statusId: lead.statusId }),
    ).catch((e: unknown) => e);
    expect(String((err as { cause?: Error }).cause?.message)).toMatch(/row-level security/);
    // No tenant context at all → nothing visible.
    expect(await withScope({ tenantId: null, userId: null }, (tx) => tx.select().from(leads))).toHaveLength(0);
  });

  it("enforces permissions and data scope", async () => {
    const { admin } = await makeTenant("Scopes");
    const repA = await makeMember(admin, "sales_rep", { teamName: "North" });
    const repB = await makeMember(admin, "sales_rep", { teamName: "North" });
    const repC = await makeMember(admin, "sales_rep", { teamName: "South" });
    const ro = await makeMember(admin, "read_only");
    const lead = await createLead(repA, { lastName: "Owned by A" });
    // Same team can see; other team cannot.
    expect((await getLead(repB, lead.id)).lead.id).toBe(lead.id);
    await expect(getLead(repC, lead.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listLeads(repC)).rows.find((r) => r.id === lead.id)).toBeUndefined();
    // Read-only users cannot write.
    await expect(createLead(ro, { lastName: "nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateLead(ro, lead.id, { lastName: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    // Reps cannot bulk assign.
    await expect(assignLeads(repA, [lead.id], repB.userId)).rejects.toBeInstanceOf(ForbiddenError);
    // Reps cannot read the audit log or change settings.
    await expect(queryAudit(repA, {})).rejects.toBeInstanceOf(ForbiddenError);
    // A rep setting another owner on create without lead:assign keeps themselves as owner.
    const own = await createLead(repA, { lastName: "Try reassign", ownerId: repC.userId });
    expect(own.ownerId).toBe(repA.userId);
    // Accounts in another team's scope are not convertible targets.
    const accC = await createAccount(repC, { name: "South Account" });
    await expect(getAccount(repA, accC.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listAccounts(repA)).rows.find((r) => r.id === accC.id)).toBeUndefined();
  });
});

import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { withScope, type Tx } from "@/server/db/client";
import {
  accounts,
  contacts,
  opportunities,
  opportunityContacts,
  opportunityStageHistory,
  pipelineStages,
  pipelines,
  tenantMemberships,
  users,
  type Opportunity,
  type PipelineStage,
} from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/permissions";
import { diffRecords, emitEvent, writeAudit } from "@/server/lib/audit";
import {
  OPPORTUNITY_FIELD_LABELS,
  effectiveProbability,
  impliedForecastCategory,
  missingRequiredFields,
} from "@/server/domain/pipeline";
import { BUYING_ROLES, fieldErrors, opportunityInputSchema, type OpportunityInput } from "@/server/validation/crm";
import { actor, assertOwnerAccess, assertValidOwner, likeTerm, need, ownerScope, pageArgs, type Page } from "./_shared";

export async function listPipelines(ctx: TenantContext) {
  return withScope(ctx, async (tx) => {
    const ps = await tx
      .select()
      .from(pipelines)
      .where(isNull(pipelines.archivedAt))
      .orderBy(desc(pipelines.isDefault), asc(pipelines.position));
    const stages = await tx.select().from(pipelineStages).orderBy(asc(pipelineStages.position));
    return ps.map((p) => ({ ...p, stages: stages.filter((s) => s.pipelineId === p.id) }));
  });
}

export interface OpportunityFilters {
  q?: string;
  pipelineId?: string;
  stageId?: string;
  ownerId?: string | "me";
  accountId?: string;
  status?: "open" | "won" | "lost";
  closingFrom?: string;
  closingTo?: string;
  page?: number;
  pageSize?: number;
  sort?: "close_asc" | "amount_desc" | "created_desc" | "updated_desc";
}

export interface OpportunityRow {
  id: string;
  name: string;
  accountId: string;
  accountName: string;
  ownerId: string | null;
  ownerName: string | null;
  pipelineId: string;
  stageId: string;
  stageName: string;
  stageCategory: "open" | "won" | "lost";
  stagePosition: number;
  probability: number;
  amount: string;
  currency: string;
  expectedCloseDate: string | null;
  forecastCategory: string;
  stageEnteredAt: Date;
  nextStep: string | null;
  updatedAt: Date;
  lastActivityAt: Date | null;
}

function oppWhere(ctx: TenantContext, f: OpportunityFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [isNull(opportunities.archivedAt), ownerScope(ctx, opportunities.ownerId)];
  if (f.q) conds.push(ilike(opportunities.name, likeTerm(f.q.trim())));
  if (f.pipelineId) conds.push(eq(opportunities.pipelineId, f.pipelineId));
  if (f.stageId) conds.push(eq(opportunities.stageId, f.stageId));
  if (f.ownerId === "me") conds.push(eq(opportunities.ownerId, ctx.userId));
  else if (f.ownerId) conds.push(eq(opportunities.ownerId, f.ownerId));
  if (f.accountId) conds.push(eq(opportunities.accountId, f.accountId));
  if (f.status) conds.push(eq(pipelineStages.category, f.status));
  if (f.closingFrom) conds.push(sql`${opportunities.expectedCloseDate} >= ${f.closingFrom}`);
  if (f.closingTo) conds.push(sql`${opportunities.expectedCloseDate} <= ${f.closingTo}`);
  return and(...conds);
}

const lastActivity = sql<Date | null>`(select max(coalesce(a.occurred_at, a.completed_at, a.created_at)) from activities a where a.opportunity_id = ${opportunities.id})`;

function rowSelect() {
  return {
    id: opportunities.id,
    name: opportunities.name,
    accountId: opportunities.accountId,
    accountName: accounts.name,
    ownerId: opportunities.ownerId,
    ownerName: users.name,
    pipelineId: opportunities.pipelineId,
    stageId: opportunities.stageId,
    stageName: pipelineStages.name,
    stageCategory: pipelineStages.category,
    stagePosition: pipelineStages.position,
    probability: sql<number>`coalesce(${opportunities.probabilityOverride}, ${pipelineStages.probability})`,
    amount: opportunities.amount,
    currency: opportunities.currency,
    expectedCloseDate: opportunities.expectedCloseDate,
    forecastCategory: opportunities.forecastCategory,
    stageEnteredAt: opportunities.stageEnteredAt,
    nextStep: opportunities.nextStep,
    updatedAt: opportunities.updatedAt,
    lastActivityAt: lastActivity,
  };
}

export async function listOpportunities(ctx: TenantContext, f: OpportunityFilters = {}): Promise<Page<OpportunityRow>> {
  need(ctx, "opportunity:read");
  const { page, pageSize, offset } = pageArgs(f.page, f.pageSize);
  const order = {
    close_asc: [sql`${opportunities.expectedCloseDate} asc nulls last`],
    amount_desc: [desc(opportunities.amount)],
    created_desc: [desc(opportunities.createdAt)],
    updated_desc: [desc(opportunities.updatedAt)],
  }[f.sort ?? "close_asc"];
  return withScope(ctx, async (tx) => {
    const where = oppWhere(ctx, f);
    const rows = await tx
      .select(rowSelect())
      .from(opportunities)
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset(offset);
    const [c] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(where);
    return { rows, total: c?.n ?? 0, page, pageSize };
  });
}

/** Kanban data: all non-archived opportunities in a pipeline (open stages + recently closed). */
export async function pipelineBoard(ctx: TenantContext, pipelineId: string, f: Pick<OpportunityFilters, "ownerId" | "q"> = {}) {
  need(ctx, "opportunity:read");
  return withScope(ctx, async (tx) => {
    const [pipeline] = await tx.select().from(pipelines).where(eq(pipelines.id, pipelineId));
    if (!pipeline) throw new NotFoundError("Pipeline not found.");
    const stages = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, pipelineId))
      .orderBy(asc(pipelineStages.position));
    const rows = await tx
      .select(rowSelect())
      .from(opportunities)
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .where(
        and(
          oppWhere(ctx, { ...f, pipelineId }),
          // Closed deals only show for 90 days to keep the board focused.
          sql`(${pipelineStages.category} = 'open' or ${opportunities.closedAt} > now() - interval '90 days')`,
        ),
      )
      .orderBy(sql`${opportunities.expectedCloseDate} asc nulls last`)
      .limit(2000);
    return { pipeline, stages, rows };
  });
}

async function loadOpp(tx: Tx, ctx: TenantContext, id: string): Promise<Opportunity> {
  const [o] = await tx.select().from(opportunities).where(and(eq(opportunities.id, id), isNull(opportunities.archivedAt))).limit(1);
  if (!o) throw new NotFoundError("Opportunity not found.");
  await assertOwnerAccess(tx, ctx, o.ownerId);
  return o;
}

export async function getOpportunity(ctx: TenantContext, id: string) {
  need(ctx, "opportunity:read");
  return withScope(ctx, async (tx) => {
    const opp = await loadOpp(tx, ctx, id);
    const [account] = await tx.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, opp.accountId));
    const [owner] = opp.ownerId ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, opp.ownerId)) : [];
    const [pipeline] = await tx.select().from(pipelines).where(eq(pipelines.id, opp.pipelineId));
    const stages = await tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, opp.pipelineId)).orderBy(asc(pipelineStages.position));
    const stage = stages.find((s) => s.id === opp.stageId) ?? null;
    const committee = await tx
      .select({
        contactId: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        jobTitle: contacts.jobTitle,
        email: contacts.email,
        role: opportunityContacts.role,
        isPrimary: opportunityContacts.isPrimary,
      })
      .from(opportunityContacts)
      .innerJoin(contacts, eq(contacts.id, opportunityContacts.contactId))
      .where(eq(opportunityContacts.opportunityId, id))
      .orderBy(desc(opportunityContacts.isPrimary), asc(contacts.lastName));
    const history = await tx
      .select({
        id: opportunityStageHistory.id,
        fromStageId: opportunityStageHistory.fromStageId,
        toStageId: opportunityStageHistory.toStageId,
        amount: opportunityStageHistory.amount,
        currency: opportunityStageHistory.currency,
        expectedCloseDate: opportunityStageHistory.expectedCloseDate,
        changedAt: opportunityStageHistory.changedAt,
        changedBy: users.name,
      })
      .from(opportunityStageHistory)
      .leftJoin(users, eq(users.id, opportunityStageHistory.changedById))
      .where(eq(opportunityStageHistory.opportunityId, id))
      .orderBy(desc(opportunityStageHistory.changedAt));
    return { opportunity: opp, account: account ?? null, owner: owner ?? null, pipeline: pipeline ?? null, stages, stage, committee, history };
  });
}

export function parseOpportunityInput(raw: unknown): OpportunityInput {
  const parsed = opportunityInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", fieldErrors(parsed.error));
  return parsed.data;
}

function requirementError(stage: PipelineStage, missing: string[]): ValidationError {
  const labels = missing.map((m) => OPPORTUNITY_FIELD_LABELS[m] ?? m);
  return new ValidationError(
    `“${stage.name}” requires: ${labels.join(", ")}.`,
    Object.fromEntries(missing.map((m) => [m, ["Required for this stage."]])),
  );
}

async function resolveStage(tx: Tx, pipelineId: string, stageId: string | null): Promise<PipelineStage> {
  const [stage] = stageId
    ? await tx.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.pipelineId, pipelineId)))
    : await tx
        .select()
        .from(pipelineStages)
        .where(and(eq(pipelineStages.pipelineId, pipelineId), eq(pipelineStages.category, "open")))
        .orderBy(asc(pipelineStages.position))
        .limit(1);
  if (!stage) throw new ValidationError("Select a valid stage for this pipeline.", { stageId: ["Invalid stage."] });
  return stage;
}

async function assertContactOnAccount(tx: Tx, contactId: string | null, accountId: string): Promise<void> {
  if (!contactId) return;
  const [c] = await tx.select({ accountId: contacts.accountId }).from(contacts).where(and(eq(contacts.id, contactId), isNull(contacts.archivedAt)));
  if (!c) throw new ValidationError("Primary contact not found.", { primaryContactId: ["Not found."] });
  if (c.accountId && c.accountId !== accountId)
    throw new ValidationError("The primary contact belongs to a different account.", { primaryContactId: ["Belongs to another account."] });
}

export async function createOpportunityInTx(tx: Tx, ctx: TenantContext, input: OpportunityInput): Promise<Opportunity> {
  const [account] = await tx.select({ id: accounts.id, ownerId: accounts.ownerId }).from(accounts).where(and(eq(accounts.id, input.accountId), isNull(accounts.archivedAt)));
  if (!account) throw new ValidationError("Select a valid account.", { accountId: ["Not found."] });
  const stage = await resolveStage(tx, input.pipelineId, input.stageId);
  await assertContactOnAccount(tx, input.primaryContactId, input.accountId);
  const ownerId = input.ownerId ?? ctx.userId;
  await assertValidOwner(tx, ctx, ownerId);
  const amount = (input.amount ?? 0).toFixed(2);
  const missing = missingRequiredFields(stage.requiredFields, { ...input, amount });
  if (missing.length) throw requirementError(stage, missing);
  const closed = stage.category !== "open";
  const [opp] = await tx
    .insert(opportunities)
    .values({
      ...input,
      tenantId: ctx.tenantId,
      ownerId,
      stageId: stage.id,
      amount,
      forecastCategory:
        input.forecastCategory ?? impliedForecastCategory(stage.category, effectiveProbability(stage.probability, input.probabilityOverride)),
      closedAt: closed ? new Date() : null,
      createdById: ctx.userId,
    })
    .returning();
  if (!opp) throw new Error("Failed to create opportunity");
  if (input.primaryContactId) {
    const [pc] = await tx.select({ role: contacts.buyingRole }).from(contacts).where(eq(contacts.id, input.primaryContactId));
    await tx
      .insert(opportunityContacts)
      .values({ tenantId: ctx.tenantId, opportunityId: opp.id, contactId: input.primaryContactId, isPrimary: true, role: pc?.role ?? "other" });
  }
  await tx.insert(opportunityStageHistory).values({
    tenantId: ctx.tenantId,
    opportunityId: opp.id,
    toStageId: stage.id,
    amount,
    currency: opp.currency,
    expectedCloseDate: opp.expectedCloseDate,
    changedById: ctx.userId,
  });
  await writeAudit(tx, actor(ctx), { action: "opportunity.created", entityType: "opportunity", entityId: opp.id });
  await emitEvent(tx, actor(ctx), { type: "opportunity.created", entityType: "opportunity", entityId: opp.id, payload: { amount, currency: opp.currency } });
  return opp;
}

export async function createOpportunity(ctx: TenantContext, raw: unknown): Promise<Opportunity> {
  need(ctx, "opportunity:write");
  const input = parseOpportunityInput(raw);
  return withScope(ctx, (tx) => createOpportunityInTx(tx, ctx, input));
}

async function recordStageChange(
  tx: Tx,
  ctx: TenantContext,
  before: Opportunity,
  after: Opportunity,
  toStage: PipelineStage,
): Promise<void> {
  await tx.insert(opportunityStageHistory).values({
    tenantId: ctx.tenantId,
    opportunityId: after.id,
    fromStageId: before.stageId,
    toStageId: toStage.id,
    amount: after.amount,
    currency: after.currency,
    expectedCloseDate: after.expectedCloseDate,
    changedById: ctx.userId,
  });
  const payload = { fromStageId: before.stageId, toStageId: toStage.id, amount: after.amount, currency: after.currency };
  await emitEvent(tx, actor(ctx), { type: "opportunity.stage_changed", entityType: "opportunity", entityId: after.id, payload });
  if (toStage.category === "won")
    await emitEvent(tx, actor(ctx), { type: "opportunity.won", entityType: "opportunity", entityId: after.id, payload });
  if (toStage.category === "lost")
    await emitEvent(tx, actor(ctx), { type: "opportunity.lost", entityType: "opportunity", entityId: after.id, payload: { ...payload, lossReason: after.lossReason } });
}

export async function updateOpportunity(ctx: TenantContext, id: string, raw: unknown): Promise<Opportunity> {
  need(ctx, "opportunity:write");
  const input = parseOpportunityInput(raw);
  return withScope(ctx, async (tx) => {
    const before = await loadOpp(tx, ctx, id);
    if (input.pipelineId !== before.pipelineId && !input.stageId)
      throw new ValidationError("Select a stage in the new pipeline.", { stageId: ["Required when changing pipeline."] });
    const stage = await resolveStage(tx, input.pipelineId, input.stageId ?? before.stageId);
    await assertContactOnAccount(tx, input.primaryContactId, input.accountId);
    const ownerId = input.ownerId ?? before.ownerId;
    await assertValidOwner(tx, ctx, ownerId);
    const amount = (input.amount ?? 0).toFixed(2);
    const stageChanged = stage.id !== before.stageId;
    if (stageChanged) {
      const missing = missingRequiredFields(stage.requiredFields, { ...before, ...input, amount });
      if (missing.length) throw requirementError(stage, missing);
    }
    const [after] = await tx
      .update(opportunities)
      .set({
        ...input,
        ownerId,
        stageId: stage.id,
        amount,
        forecastCategory:
          input.forecastCategory ??
          (stageChanged ? impliedForecastCategory(stage.category, effectiveProbability(stage.probability, input.probabilityOverride)) : before.forecastCategory),
        ...(stageChanged ? { stageEnteredAt: new Date(), closedAt: stage.category === "open" ? null : new Date() } : {}),
      })
      .where(eq(opportunities.id, id))
      .returning();
    if (!after) throw new NotFoundError();
    if (input.primaryContactId && input.primaryContactId !== before.primaryContactId) {
      await tx.update(opportunityContacts).set({ isPrimary: false }).where(eq(opportunityContacts.opportunityId, id));
      await tx
        .insert(opportunityContacts)
        .values({ tenantId: ctx.tenantId, opportunityId: id, contactId: input.primaryContactId, isPrimary: true })
        .onConflictDoUpdate({ target: [opportunityContacts.opportunityId, opportunityContacts.contactId], set: { isPrimary: true } });
    }
    if (stageChanged) await recordStageChange(tx, ctx, before, after, stage);
    await writeAudit(tx, actor(ctx), { action: "opportunity.updated", entityType: "opportunity", entityId: id, changes: diffRecords(before, after) });
    return after;
  });
}

export interface MoveStageInput {
  stageId: string;
  lossReason?: string | null;
  amount?: number | null;
  expectedCloseDate?: string | null;
}

/** Moves an opportunity to another stage of the same pipeline, enforcing stage requirements. */
export async function moveOpportunityStage(ctx: TenantContext, id: string, input: MoveStageInput): Promise<Opportunity> {
  need(ctx, "opportunity:write");
  return withScope(ctx, async (tx) => {
    const before = await loadOpp(tx, ctx, id);
    const stage = await resolveStage(tx, before.pipelineId, input.stageId);
    if (stage.id === before.stageId) return before;
    const patch: Partial<Opportunity> = {};
    if (input.lossReason !== undefined) patch.lossReason = input.lossReason?.trim() || null;
    if (input.amount !== undefined && input.amount !== null) patch.amount = input.amount.toFixed(2);
    if (input.expectedCloseDate !== undefined) patch.expectedCloseDate = input.expectedCloseDate;
    const candidate = { ...before, ...patch };
    const missing = missingRequiredFields(stage.requiredFields, candidate);
    if (missing.length) throw requirementError(stage, missing);
    const [after] = await tx
      .update(opportunities)
      .set({
        ...patch,
        stageId: stage.id,
        stageEnteredAt: new Date(),
        closedAt: stage.category === "open" ? null : new Date(),
        forecastCategory: impliedForecastCategory(stage.category, effectiveProbability(stage.probability, before.probabilityOverride)),
        ...(stage.category === "won" ? { lossReason: null } : {}),
      })
      .where(eq(opportunities.id, id))
      .returning();
    if (!after) throw new NotFoundError();
    await recordStageChange(tx, ctx, before, after, stage);
    await writeAudit(tx, actor(ctx), {
      action: "opportunity.stage_changed",
      entityType: "opportunity",
      entityId: id,
      changes: diffRecords(before, after),
    });
    return after;
  });
}

export async function setOpportunityContact(
  ctx: TenantContext,
  opportunityId: string,
  contactId: string,
  role: (typeof BUYING_ROLES)[number] | null,
): Promise<void> {
  need(ctx, "opportunity:write");
  await withScope(ctx, async (tx) => {
    const opp = await loadOpp(tx, ctx, opportunityId);
    await assertContactOnAccount(tx, contactId, opp.accountId);
    if (role === null) {
      await tx
        .delete(opportunityContacts)
        .where(and(eq(opportunityContacts.opportunityId, opportunityId), eq(opportunityContacts.contactId, contactId)));
    } else {
      await tx
        .insert(opportunityContacts)
        .values({ tenantId: ctx.tenantId, opportunityId, contactId, role })
        .onConflictDoUpdate({ target: [opportunityContacts.opportunityId, opportunityContacts.contactId], set: { role } });
    }
    await writeAudit(tx, actor(ctx), {
      action: role ? "opportunity.contact_set" : "opportunity.contact_removed",
      entityType: "opportunity",
      entityId: opportunityId,
      changes: { contactId, role },
    });
  });
}

export async function archiveOpportunities(ctx: TenantContext, ids: string[]): Promise<number> {
  need(ctx, "opportunity:delete");
  if (ids.length === 0) return 0;
  return withScope(ctx, async (tx) => {
    const rows = await tx
      .update(opportunities)
      .set({ archivedAt: new Date() })
      .where(and(inArray(opportunities.id, ids), isNull(opportunities.archivedAt), ownerScope(ctx, opportunities.ownerId)))
      .returning({ id: opportunities.id });
    for (const r of rows) await writeAudit(tx, actor(ctx), { action: "opportunity.archived", entityType: "opportunity", entityId: r.id });
    return rows.length;
  });
}

export async function memberOptions(ctx: TenantContext): Promise<{ id: string; name: string }[]> {
  return withScope(ctx, (tx) =>
    tx
      .select({ id: users.id, name: users.name })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(and(eq(tenantMemberships.status, "active"), isNull(users.disabledAt)))
      .orderBy(asc(users.name)),
  );
}

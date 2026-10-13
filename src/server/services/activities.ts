import "server-only";
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { withScope, type Tx } from "@/server/db/client";
import { accounts, activities, contacts, leads, opportunities, users, type Activity } from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/permissions";
import { writeAudit } from "@/server/lib/audit";
import { activityInputSchema, fieldErrors } from "@/server/validation/crm";
import { actor, assertOwnerAccess, assertValidOwner, need } from "./_shared";

export type RelatedRef =
  | { type: "lead"; id: string }
  | { type: "account"; id: string }
  | { type: "contact"; id: string }
  | { type: "opportunity"; id: string };

/** Confirms each linked record exists and is within the caller's scope. */
async function assertRelatedAccess(
  tx: Tx,
  ctx: TenantContext,
  refs: { leadId: string | null; accountId: string | null; contactId: string | null; opportunityId: string | null },
): Promise<void> {
  const checks: [string | null, () => Promise<{ ownerId: string | null } | undefined>][] = [
    [refs.leadId, async () => (await tx.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.id, refs.leadId!)))[0]],
    [refs.accountId, async () => (await tx.select({ ownerId: accounts.ownerId }).from(accounts).where(eq(accounts.id, refs.accountId!)))[0]],
    [refs.contactId, async () => (await tx.select({ ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, refs.contactId!)))[0]],
    [
      refs.opportunityId,
      async () => (await tx.select({ ownerId: opportunities.ownerId }).from(opportunities).where(eq(opportunities.id, refs.opportunityId!)))[0],
    ],
  ];
  let any = false;
  for (const [id, load] of checks) {
    if (!id) continue;
    any = true;
    const rec = await load();
    if (!rec) throw new ValidationError("A linked record was not found.");
    await assertOwnerAccess(tx, ctx, rec.ownerId);
  }
  if (!any) throw new ValidationError("Activities must be linked to a lead, account, contact or opportunity.");
}

/** Fills in parent links (opportunity → account, contact → account) so timelines roll up. */
async function inferParents(
  tx: Tx,
  refs: { leadId: string | null; accountId: string | null; contactId: string | null; opportunityId: string | null },
) {
  const out = { ...refs };
  if (out.opportunityId && !out.accountId) {
    const [o] = await tx.select({ accountId: opportunities.accountId }).from(opportunities).where(eq(opportunities.id, out.opportunityId));
    out.accountId = o?.accountId ?? null;
  }
  if (out.contactId && !out.accountId) {
    const [c] = await tx.select({ accountId: contacts.accountId }).from(contacts).where(eq(contacts.id, out.contactId));
    out.accountId = c?.accountId ?? null;
  }
  return out;
}

export async function createActivity(ctx: TenantContext, raw: unknown): Promise<Activity> {
  need(ctx, "activity:write");
  const parsed = activityInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", fieldErrors(parsed.error));
  const input = parsed.data;
  if (input.type === "task" && !input.dueAt) throw new ValidationError("Tasks need a due date.", { dueAt: ["Required for tasks."] });
  return withScope(ctx, async (tx) => {
    await assertRelatedAccess(tx, ctx, input);
    const refs = await inferParents(tx, input);
    const ownerId = input.ownerId ?? ctx.userId;
    await assertValidOwner(tx, ctx, ownerId);
    const isLogged = input.type !== "task";
    const occurredAt = isLogged ? input.occurredAt ?? new Date() : null;
    const [a] = await tx
      .insert(activities)
      .values({
        ...input,
        ...refs,
        tenantId: ctx.tenantId,
        ownerId,
        occurredAt,
        completedAt: isLogged ? occurredAt : null,
        createdById: ctx.userId,
      })
      .returning();
    if (!a) throw new Error("Failed to create activity");
    // Calls, emails and meetings count as contact touches.
    if (input.type === "call" || input.type === "email" || input.type === "meeting") {
      const at = occurredAt ?? new Date();
      if (refs.leadId) await tx.update(leads).set({ lastContactedAt: at }).where(and(eq(leads.id, refs.leadId), or(isNull(leads.lastContactedAt), lt(leads.lastContactedAt, at))));
      if (refs.contactId)
        await tx.update(contacts).set({ lastContactedAt: at }).where(and(eq(contacts.id, refs.contactId), or(isNull(contacts.lastContactedAt), lt(contacts.lastContactedAt, at))));
    }
    await writeAudit(tx, actor(ctx), { action: `activity.${input.type}_created`, entityType: "activity", entityId: a.id });
    return a;
  });
}

export async function setTaskCompleted(ctx: TenantContext, id: string, completed: boolean): Promise<void> {
  need(ctx, "activity:write");
  await withScope(ctx, async (tx) => {
    const [a] = await tx.select().from(activities).where(eq(activities.id, id));
    if (!a) throw new NotFoundError("Task not found.");
    if (a.type !== "task") throw new ValidationError("Only tasks can be completed.");
    if (a.ownerId !== ctx.userId && ctx.dataScope === "own") throw new ForbiddenError();
    await assertOwnerAccess(tx, ctx, a.ownerId);
    await tx.update(activities).set({ completedAt: completed ? new Date() : null }).where(eq(activities.id, id));
    await writeAudit(tx, actor(ctx), { action: completed ? "task.completed" : "task.reopened", entityType: "activity", entityId: id });
  });
}

export interface TimelineItem {
  id: string;
  type: Activity["type"];
  subject: string;
  body: string | null;
  dueAt: Date | null;
  occurredAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  ownerName: string | null;
  outcome: string | null;
  durationMinutes: number | null;
  priority: string;
}

/** Timeline for a record; enforces access to the parent record. */
export async function timelineFor(ctx: TenantContext, ref: RelatedRef, limit = 100): Promise<TimelineItem[]> {
  need(ctx, "activity:read");
  const col = {
    lead: activities.leadId,
    account: activities.accountId,
    contact: activities.contactId,
    opportunity: activities.opportunityId,
  }[ref.type];
  return withScope(ctx, async (tx) => {
    await assertRelatedAccess(tx, ctx, {
      leadId: ref.type === "lead" ? ref.id : null,
      accountId: ref.type === "account" ? ref.id : null,
      contactId: ref.type === "contact" ? ref.id : null,
      opportunityId: ref.type === "opportunity" ? ref.id : null,
    });
    return tx
      .select({
        id: activities.id,
        type: activities.type,
        subject: activities.subject,
        body: activities.body,
        dueAt: activities.dueAt,
        occurredAt: activities.occurredAt,
        completedAt: activities.completedAt,
        createdAt: activities.createdAt,
        ownerName: users.name,
        outcome: activities.outcome,
        durationMinutes: activities.durationMinutes,
        priority: activities.priority,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.ownerId))
      .where(eq(col, ref.id))
      .orderBy(desc(sql`coalesce(${activities.occurredAt}, ${activities.dueAt}, ${activities.createdAt})`))
      .limit(Math.min(limit, 500));
  });
}

export interface TaskRow {
  id: string;
  subject: string;
  dueAt: Date | null;
  completedAt: Date | null;
  priority: string;
  ownerName: string | null;
  leadId: string | null;
  accountId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  relatedLabel: string | null;
}

export async function listTasks(
  ctx: TenantContext,
  f: { scope?: "mine" | "team"; status?: "open" | "overdue" | "today" | "completed" | "upcoming"; limit?: number } = {},
): Promise<TaskRow[]> {
  need(ctx, "activity:read");
  const conds: (SQL | undefined)[] = [eq(activities.type, "task")];
  if (f.scope !== "team" || ctx.dataScope === "own") conds.push(eq(activities.ownerId, ctx.userId));
  const startOfDay = sql`date_trunc('day', now())`;
  switch (f.status ?? "open") {
    case "open":
      conds.push(isNull(activities.completedAt));
      break;
    case "overdue":
      conds.push(isNull(activities.completedAt), lt(activities.dueAt, sql`now()`));
      break;
    case "today":
      conds.push(isNull(activities.completedAt), gte(activities.dueAt, startOfDay), lt(activities.dueAt, sql`${startOfDay} + interval '1 day'`));
      break;
    case "upcoming":
      conds.push(isNull(activities.completedAt), gte(activities.dueAt, sql`now()`));
      break;
    case "completed":
      conds.push(isNotNull(activities.completedAt));
      break;
  }
  const label = sql<string | null>`coalesce(
    (select o.name from opportunities o where o.id = ${activities.opportunityId}),
    (select coalesce(c.first_name || ' ', '') || c.last_name from contacts c where c.id = ${activities.contactId}),
    (select a.name from accounts a where a.id = ${activities.accountId}),
    (select coalesce(l.first_name || ' ', '') || l.last_name from leads l where l.id = ${activities.leadId})
  )`;
  return withScope(ctx, (tx) =>
    tx
      .select({
        id: activities.id,
        subject: activities.subject,
        dueAt: activities.dueAt,
        completedAt: activities.completedAt,
        priority: activities.priority,
        ownerName: users.name,
        leadId: activities.leadId,
        accountId: activities.accountId,
        contactId: activities.contactId,
        opportunityId: activities.opportunityId,
        relatedLabel: label,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.ownerId))
      .where(and(...conds))
      .orderBy(f.status === "completed" ? desc(activities.completedAt) : asc(activities.dueAt))
      .limit(Math.min(f.limit ?? 100, 500)),
  );
}

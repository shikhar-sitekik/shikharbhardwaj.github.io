import "server-only";
import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { withScope } from "@/server/db/client";
import { accounts, activities, leadStatuses, leads, opportunities, pipelineStages, pipelines, users } from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { convertToBase } from "@/server/domain/pipeline";
import { need, ownerScope } from "./_shared";

/*
 * Metric definitions (see docs/METRICS.md):
 * - Open pipeline: sum of `amount` of non-archived opportunities in open stages.
 * - Weighted pipeline: Σ amount × effective probability / 100 over open opportunities.
 * - Closed-won (bookings): Σ amount of opportunities whose stage is "won" and closedAt in period.
 * - Win rate: won / (won + lost) by count, for opportunities closed in period.
 * - Sales cycle: mean days from createdAt to closedAt for opportunities won in period.
 * All amounts are converted to the tenant base currency using configured FX rates;
 * amounts without a rate are excluded and counted in `unconverted`.
 */

export interface Period {
  from: Date;
  to: Date;
  label: string;
}

export function currentQuarter(now = new Date()): Period {
  const q = Math.floor(now.getUTCMonth() / 3);
  const from = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1));
  return { from, to, label: `Q${q + 1} ${now.getUTCFullYear()}` };
}

export function resolvePeriod(key: string | undefined, now = new Date()): Period {
  const y = now.getUTCFullYear();
  if (key === "last_quarter") {
    const q = currentQuarter(now);
    return currentQuarter(new Date(q.from.getTime() - 864e5));
  }
  if (key === "ytd") return { from: new Date(Date.UTC(y, 0, 1)), to: new Date(Date.UTC(y + 1, 0, 1)), label: `${y} year to date` };
  if (key === "last_year") return { from: new Date(Date.UTC(y - 1, 0, 1)), to: new Date(Date.UTC(y, 0, 1)), label: `${y - 1}` };
  return currentQuarter(now);
}

interface MoneyAgg {
  currency: string;
  total: string;
  weighted: string;
  n: number;
}

function sumToBase(ctx: TenantContext, rows: MoneyAgg[], key: "total" | "weighted") {
  const { baseCurrency, fxRates } = ctx.tenant.settings;
  let value = 0;
  let unconverted = 0;
  for (const r of rows) {
    const v = convertToBase(r[key], r.currency, baseCurrency, fxRates);
    if (v === null) unconverted += r.n;
    else value += v;
  }
  return { value, unconverted };
}

export interface ExecutiveMetrics {
  baseCurrency: string;
  period: Period;
  openPipeline: number;
  weightedPipeline: number;
  openCount: number;
  closedWon: number;
  wonCount: number;
  lostCount: number;
  winRate: number | null;
  avgSalesCycleDays: number | null;
  avgDealSize: number | null;
  newLeads: number;
  convertedLeads: number;
  unconverted: number;
  byStage: { stageId: string; stageName: string; position: number; count: number; value: number; weighted: number }[];
  bySource: { source: string; leads: number; converted: number }[];
  byOwner: { ownerName: string; open: number; weighted: number; won: number }[];
}

export async function executiveMetrics(ctx: TenantContext, pipelineId?: string, period: Period = currentQuarter()): Promise<ExecutiveMetrics> {
  need(ctx, "report:read");
  return withScope(ctx, async (tx) => {
    const scope = ownerScope(ctx, opportunities.ownerId);
    const base = and(isNull(opportunities.archivedAt), scope, pipelineId ? eq(opportunities.pipelineId, pipelineId) : undefined);
    const prob = sql`coalesce(${opportunities.probabilityOverride}, ${pipelineStages.probability})`;

    const stageRows = await tx
      .select({
        stageId: pipelineStages.id,
        stageName: pipelineStages.name,
        position: pipelineStages.position,
        currency: opportunities.currency,
        n: sql<number>`count(*)::int`,
        total: sql<string>`sum(${opportunities.amount})::text`,
        weighted: sql<string>`sum(${opportunities.amount} * ${prob} / 100.0)::text`,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(and(base, eq(pipelineStages.category, "open")))
      .groupBy(pipelineStages.id, pipelineStages.name, pipelineStages.position, opportunities.currency)
      .orderBy(asc(pipelineStages.position));

    const byStageMap = new Map<string, ExecutiveMetrics["byStage"][number]>();
    let unconverted = 0;
    for (const r of stageRows) {
      const t = sumToBase(ctx, [r], "total");
      const w = sumToBase(ctx, [r], "weighted");
      unconverted += t.unconverted;
      const cur = byStageMap.get(r.stageId) ?? { stageId: r.stageId, stageName: r.stageName, position: r.position, count: 0, value: 0, weighted: 0 };
      cur.count += r.n;
      cur.value += t.value;
      cur.weighted += w.value;
      byStageMap.set(r.stageId, cur);
    }
    const byStage = [...byStageMap.values()].sort((a, b) => a.position - b.position);

    const closedRows = await tx
      .select({
        category: pipelineStages.category,
        currency: opportunities.currency,
        n: sql<number>`count(*)::int`,
        total: sql<string>`sum(${opportunities.amount})::text`,
        weighted: sql<string>`'0'`,
        cycleDays: sql<string | null>`avg(extract(epoch from (${opportunities.closedAt} - ${opportunities.createdAt})) / 86400)::text`,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(and(base, gte(opportunities.closedAt, period.from), lt(opportunities.closedAt, period.to), sql`${pipelineStages.category} in ('won','lost')`))
      .groupBy(pipelineStages.category, opportunities.currency);
    const won = closedRows.filter((r) => r.category === "won");
    const lost = closedRows.filter((r) => r.category === "lost");
    const closedWon = sumToBase(ctx, won, "total");
    unconverted += closedWon.unconverted;
    const wonCount = won.reduce((s, r) => s + r.n, 0);
    const lostCount = lost.reduce((s, r) => s + r.n, 0);
    const cycleWeighted = won.reduce((s, r) => s + Number(r.cycleDays ?? 0) * r.n, 0);

    const leadScope = ownerScope(ctx, leads.ownerId);
    const sourceRows = await tx
      .select({
        source: sql<string>`coalesce(${leads.source}, 'unknown')`,
        n: sql<number>`count(*)::int`,
        converted: sql<number>`count(${leads.convertedAt})::int`,
      })
      .from(leads)
      .where(and(isNull(leads.archivedAt), leadScope, gte(leads.createdAt, period.from), lt(leads.createdAt, period.to)))
      .groupBy(sql`coalesce(${leads.source}, 'unknown')`)
      .orderBy(sql`count(*) desc`);

    const ownerRows = await tx
      .select({
        ownerName: sql<string>`coalesce(${users.name}, 'Unassigned')`,
        category: pipelineStages.category,
        currency: opportunities.currency,
        n: sql<number>`count(*)::int`,
        total: sql<string>`sum(${opportunities.amount})::text`,
        weighted: sql<string>`sum(${opportunities.amount} * ${prob} / 100.0)::text`,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .where(
        and(
          base,
          sql`(${pipelineStages.category} = 'open' or (${pipelineStages.category} = 'won' and ${opportunities.closedAt} >= ${period.from.toISOString()} and ${opportunities.closedAt} < ${period.to.toISOString()}))`,
        ),
      )
      .groupBy(sql`coalesce(${users.name}, 'Unassigned')`, pipelineStages.category, opportunities.currency);
    const ownerMap = new Map<string, { ownerName: string; open: number; weighted: number; won: number }>();
    for (const r of ownerRows) {
      const cur = ownerMap.get(r.ownerName) ?? { ownerName: r.ownerName, open: 0, weighted: 0, won: 0 };
      if (r.category === "open") {
        cur.open += sumToBase(ctx, [r], "total").value;
        cur.weighted += sumToBase(ctx, [r], "weighted").value;
      } else cur.won += sumToBase(ctx, [r], "total").value;
      ownerMap.set(r.ownerName, cur);
    }

    return {
      baseCurrency: ctx.tenant.settings.baseCurrency,
      period,
      openPipeline: byStage.reduce((s, r) => s + r.value, 0),
      weightedPipeline: byStage.reduce((s, r) => s + r.weighted, 0),
      openCount: byStage.reduce((s, r) => s + r.count, 0),
      closedWon: closedWon.value,
      wonCount,
      lostCount,
      winRate: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : null,
      avgSalesCycleDays: wonCount > 0 ? cycleWeighted / wonCount : null,
      avgDealSize: wonCount > 0 && closedWon.unconverted === 0 ? closedWon.value / wonCount : null,
      newLeads: sourceRows.reduce((s, r) => s + r.n, 0),
      convertedLeads: sourceRows.reduce((s, r) => s + r.converted, 0),
      unconverted,
      byStage,
      bySource: sourceRows.map((r) => ({ source: r.source, leads: r.n, converted: r.converted })),
      byOwner: [...ownerMap.values()].sort((a, b) => b.weighted - a.weighted),
    };
  });
}

export interface WorkspaceSummary {
  openTasks: number;
  overdueTasks: number;
  dueToday: number;
  staleLeads: { id: string; name: string; company: string | null; lastTouch: Date }[];
  stalledDeals: { id: string; name: string; accountName: string; lastTouch: Date; stageName: string }[];
  closingSoon: { id: string; name: string; accountName: string; amount: string; currency: string; expectedCloseDate: string | null; stageName: string }[];
  newLeadsAssigned: number;
}

/** Personal workspace: everything is "mine" (owner = current user). */
export async function workspaceSummary(ctx: TenantContext): Promise<WorkspaceSummary> {
  const s = ctx.tenant.settings;
  return withScope(ctx, async (tx) => {
    const [taskCounts] = await tx
      .select({
        open: sql<number>`count(*) filter (where ${activities.completedAt} is null)::int`,
        overdue: sql<number>`count(*) filter (where ${activities.completedAt} is null and ${activities.dueAt} < now())::int`,
        today: sql<number>`count(*) filter (where ${activities.completedAt} is null and ${activities.dueAt} >= date_trunc('day', now()) and ${activities.dueAt} < date_trunc('day', now()) + interval '1 day')::int`,
      })
      .from(activities)
      .where(and(eq(activities.type, "task"), eq(activities.ownerId, ctx.userId)));

    const lastLeadTouch = sql<Date>`coalesce(${leads.lastContactedAt}, ${leads.createdAt})`;
    const staleLeads = ctx.permissions.has("lead:read")
      ? await tx
          .select({ id: leads.id, first: leads.firstName, last: leads.lastName, company: leads.company, lastTouch: lastLeadTouch })
          .from(leads)
          .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
          .where(
            and(
              eq(leads.ownerId, ctx.userId),
              isNull(leads.archivedAt),
              eq(leadStatuses.category, "open"),
              sql`${lastLeadTouch} < now() - make_interval(days => ${s.staleLeadDays})`,
            ),
          )
          .orderBy(asc(lastLeadTouch))
          .limit(8)
      : [];

    const lastOppTouch = sql<Date>`greatest(${opportunities.stageEnteredAt}, coalesce((select max(coalesce(a.occurred_at, a.created_at)) from activities a where a.opportunity_id = ${opportunities.id}), ${opportunities.createdAt}))`;
    const stalledDeals = ctx.permissions.has("opportunity:read")
      ? await tx
          .select({ id: opportunities.id, name: opportunities.name, accountName: accounts.name, lastTouch: lastOppTouch, stageName: pipelineStages.name })
          .from(opportunities)
          .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
          .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
          .where(
            and(
              eq(opportunities.ownerId, ctx.userId),
              isNull(opportunities.archivedAt),
              eq(pipelineStages.category, "open"),
              sql`${lastOppTouch} < now() - make_interval(days => ${s.staleOpportunityDays})`,
            ),
          )
          .orderBy(asc(lastOppTouch))
          .limit(8)
      : [];

    const closingSoon = ctx.permissions.has("opportunity:read")
      ? await tx
          .select({
            id: opportunities.id,
            name: opportunities.name,
            accountName: accounts.name,
            amount: opportunities.amount,
            currency: opportunities.currency,
            expectedCloseDate: opportunities.expectedCloseDate,
            stageName: pipelineStages.name,
          })
          .from(opportunities)
          .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
          .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
          .where(
            and(
              eq(opportunities.ownerId, ctx.userId),
              isNull(opportunities.archivedAt),
              eq(pipelineStages.category, "open"),
              sql`${opportunities.expectedCloseDate} <= (current_date + 30)`,
            ),
          )
          .orderBy(asc(opportunities.expectedCloseDate))
          .limit(8)
      : [];

    const [assigned] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .where(and(eq(leads.ownerId, ctx.userId), isNull(leads.archivedAt), eq(leadStatuses.key, "new")));

    return {
      openTasks: taskCounts?.open ?? 0,
      overdueTasks: taskCounts?.overdue ?? 0,
      dueToday: taskCounts?.today ?? 0,
      staleLeads: staleLeads.map((l) => ({ id: l.id, name: [l.first, l.last].filter(Boolean).join(" "), company: l.company, lastTouch: l.lastTouch })),
      stalledDeals,
      closingSoon,
      newLeadsAssigned: assigned?.n ?? 0,
    };
  });
}

export async function defaultPipelineId(ctx: TenantContext): Promise<string | null> {
  return withScope(ctx, async (tx) => {
    const [p] = await tx
      .select({ id: pipelines.id })
      .from(pipelines)
      .where(isNull(pipelines.archivedAt))
      .orderBy(sql`${pipelines.isDefault} desc`, asc(pipelines.position))
      .limit(1);
    return p?.id ?? null;
  });
}

export interface ForecastRow {
  category: string;
  count: number;
  value: number;
  weighted: number;
}

/** Open + closed-won deals with expected close (or close) date inside the period, by forecast category. */
export async function forecastReport(ctx: TenantContext, period: Period) {
  need(ctx, "report:read");
  return withScope(ctx, async (tx) => {
    const prob = sql`coalesce(${opportunities.probabilityOverride}, ${pipelineStages.probability})`;
    const rows = await tx
      .select({
        category: opportunities.forecastCategory,
        currency: opportunities.currency,
        n: sql<number>`count(*)::int`,
        total: sql<string>`sum(${opportunities.amount})::text`,
        weighted: sql<string>`sum(${opportunities.amount} * ${prob} / 100.0)::text`,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(
        and(
          isNull(opportunities.archivedAt),
          ownerScope(ctx, opportunities.ownerId),
          sql`${pipelineStages.category} <> 'lost'`,
          sql`coalesce(${opportunities.closedAt}::date, ${opportunities.expectedCloseDate}) >= ${period.from.toISOString().slice(0, 10)}::date`,
          sql`coalesce(${opportunities.closedAt}::date, ${opportunities.expectedCloseDate}) < ${period.to.toISOString().slice(0, 10)}::date`,
        ),
      )
      .groupBy(opportunities.forecastCategory, opportunities.currency);
    const map = new Map<string, ForecastRow>();
    let unconverted = 0;
    for (const r of rows) {
      const t = sumToBase(ctx, [r], "total");
      const w = sumToBase(ctx, [r], "weighted");
      unconverted += t.unconverted;
      const cur = map.get(r.category) ?? { category: r.category, count: 0, value: 0, weighted: 0 };
      cur.count += r.n;
      cur.value += t.value;
      cur.weighted += w.value;
      map.set(r.category, cur);
    }
    const order = ["closed", "commit", "best_case", "pipeline", "omitted"];
    return { rows: order.map((c) => map.get(c) ?? { category: c, count: 0, value: 0, weighted: 0 }), unconverted };
  });
}

/** Lost deals in the period grouped by recorded loss reason (free text, normalised to lower case). */
export async function lossReasonReport(ctx: TenantContext, period: Period) {
  need(ctx, "report:read");
  return withScope(ctx, (tx) =>
    tx
      .select({ reason: sql<string>`lower(coalesce(nullif(trim(${opportunities.lossReason}), ''), 'not recorded'))`, n: sql<number>`count(*)::int` })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(
        and(
          isNull(opportunities.archivedAt),
          ownerScope(ctx, opportunities.ownerId),
          eq(pipelineStages.category, "lost"),
          gte(opportunities.closedAt, period.from),
          lt(opportunities.closedAt, period.to),
        ),
      )
      .groupBy(sql`1`)
      .orderBy(sql`2 desc`)
      .limit(20),
  );
}

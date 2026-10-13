import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { withScope, type Tx } from "@/server/db/client";
import {
  accounts,
  activities,
  contacts,
  leadStatuses,
  leads,
  opportunities,
  opportunityContacts,
  opportunityStageHistory,
  pipelineStages,
  pipelines,
  tenants,
  users,
  type Lead,
} from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/permissions";
import { diffRecords, emitEvent, writeAudit } from "@/server/lib/audit";
import { emailDomain, isBusinessEmail, normalizeDomain, normalizeEmail } from "@/server/domain/normalize";
import { scoreLead } from "@/server/domain/scoring";
import { impliedForecastCategory } from "@/server/domain/pipeline";
import { parseTenantSettings } from "@/server/tenant-settings";
import { fieldErrors, leadInputSchema, type LeadInput } from "@/server/validation/crm";
import { actor, assertOwnerAccess, assertValidOwner, likeTerm, need, ownerScope, pageArgs, type Page } from "./_shared";

export interface LeadFilters {
  q?: string;
  statusId?: string;
  ownerId?: string | "unassigned" | "me";
  source?: string;
  band?: "hot" | "warm" | "cold";
  sort?: "created_desc" | "created_asc" | "score_desc" | "name_asc" | "last_contacted_asc";
  page?: number;
  pageSize?: number;
  stale?: boolean;
}

export type LeadRow = Pick<
  Lead,
  | "id"
  | "firstName"
  | "lastName"
  | "email"
  | "company"
  | "jobTitle"
  | "source"
  | "score"
  | "country"
  | "createdAt"
  | "lastContactedAt"
  | "ownerId"
  | "statusId"
> & { statusLabel: string; statusCategory: string; ownerName: string | null };

function leadWhere(ctx: TenantContext, f: LeadFilters): SQL | undefined {
  const s = parseTenantSettings(ctx.tenant.settings);
  const conds: (SQL | undefined)[] = [isNull(leads.archivedAt), ownerScope(ctx, leads.ownerId)];
  if (f.q) {
    const t = likeTerm(f.q.trim());
    conds.push(
      or(
        ilike(sql`coalesce(${leads.firstName},'') || ' ' || ${leads.lastName}`, t),
        ilike(leads.company, t),
        ilike(leads.email, t),
      ),
    );
  }
  if (f.statusId) conds.push(eq(leads.statusId, f.statusId));
  if (f.ownerId === "unassigned") conds.push(isNull(leads.ownerId));
  else if (f.ownerId === "me") conds.push(eq(leads.ownerId, ctx.userId));
  else if (f.ownerId) conds.push(eq(leads.ownerId, f.ownerId));
  if (f.source) conds.push(eq(leads.source, f.source));
  if (f.band === "hot") conds.push(sql`${leads.score} >= ${s.scoreThresholds.hot}`);
  if (f.band === "warm")
    conds.push(sql`${leads.score} >= ${s.scoreThresholds.warm} and ${leads.score} < ${s.scoreThresholds.hot}`);
  if (f.band === "cold") conds.push(sql`${leads.score} < ${s.scoreThresholds.warm}`);
  if (f.stale) {
    conds.push(
      sql`coalesce(${leads.lastContactedAt}, ${leads.createdAt}) < now() - make_interval(days => ${s.staleLeadDays})`,
    );
    conds.push(sql`${leadStatuses.category} = 'open'`);
  }
  return and(...conds);
}

export async function listLeads(ctx: TenantContext, f: LeadFilters = {}): Promise<Page<LeadRow>> {
  need(ctx, "lead:read");
  const { page, pageSize, offset } = pageArgs(f.page, f.pageSize);
  const order = {
    created_desc: [desc(leads.createdAt)],
    created_asc: [asc(leads.createdAt)],
    score_desc: [desc(leads.score), desc(leads.createdAt)],
    name_asc: [asc(leads.lastName), asc(leads.firstName)],
    last_contacted_asc: [sql`${leads.lastContactedAt} asc nulls first`],
  }[f.sort ?? "created_desc"];
  return withScope(ctx, async (tx) => {
    const where = leadWhere(ctx, f);
    const rows = await tx
      .select({
        id: leads.id,
        firstName: leads.firstName,
        lastName: leads.lastName,
        email: leads.email,
        company: leads.company,
        jobTitle: leads.jobTitle,
        source: leads.source,
        score: leads.score,
        country: leads.country,
        createdAt: leads.createdAt,
        lastContactedAt: leads.lastContactedAt,
        ownerId: leads.ownerId,
        statusId: leads.statusId,
        statusLabel: leadStatuses.label,
        statusCategory: leadStatuses.category,
        ownerName: users.name,
      })
      .from(leads)
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset(offset);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .innerJoin(leadStatuses, eq(leadStatuses.id, leads.statusId))
      .where(where);
    return { rows, total: count?.n ?? 0, page, pageSize };
  });
}

async function loadLead(tx: Tx, ctx: TenantContext, id: string): Promise<Lead> {
  const [lead] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
    .limit(1);
  if (!lead) throw new NotFoundError("Lead not found.");
  await assertOwnerAccess(tx, ctx, lead.ownerId);
  return lead;
}

export async function getLead(ctx: TenantContext, id: string) {
  need(ctx, "lead:read");
  return withScope(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, id);
    const [status] = await tx.select().from(leadStatuses).where(eq(leadStatuses.id, lead.statusId));
    const [owner] = lead.ownerId
      ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, lead.ownerId))
      : [];
    return { lead, status: status ?? null, owner: owner ?? null };
  });
}

export async function listLeadStatuses(ctx: TenantContext) {
  return withScope(ctx, (tx) => tx.select().from(leadStatuses).orderBy(asc(leadStatuses.position)));
}

function scoreFor(ctx: TenantContext, values: object) {
  const settings = parseTenantSettings(ctx.tenant.settings);
  return scoreLead(values as Record<string, string | number | boolean | Date | null>, settings.scoringRules);
}

/** Picks the next owner using the tenant's round-robin configuration, if enabled. */
async function nextRoundRobinOwner(tx: Tx, tenantId: string): Promise<string | null> {
  // Lock the tenant row so concurrent lead creation advances the cursor safely.
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).for("update");
  if (!t) return null;
  const settings = parseTenantSettings(t.settings);
  const { mode, userIds, cursor } = settings.assignment;
  if (mode !== "round_robin" || userIds.length === 0) return null;
  const ownerId = userIds[cursor % userIds.length] ?? null;
  await tx
    .update(tenants)
    .set({ settings: { ...settings, assignment: { ...settings.assignment, cursor: (cursor + 1) % userIds.length } } })
    .where(eq(tenants.id, tenantId));
  return ownerId;
}

async function defaultStatusId(tx: Tx): Promise<string> {
  const [s] = await tx
    .select({ id: leadStatuses.id })
    .from(leadStatuses)
    .orderBy(desc(leadStatuses.isDefault), asc(leadStatuses.position))
    .limit(1);
  if (!s) throw new Error("No lead statuses configured");
  return s.id;
}

export interface CreateLeadOptions {
  /** Origin for audit (form, import, api, webhook). */
  origin?: string;
  /** When provided, skip zod parsing (already validated, e.g. import rows). */
  validated?: boolean;
}

export async function createLeadInTx(
  tx: Tx,
  ctx: TenantContext,
  input: LeadInput,
  opts: CreateLeadOptions = {},
): Promise<Lead> {
  let ownerId = input.ownerId;
  if (ownerId && ownerId !== ctx.userId && !ctx.permissions.has("lead:assign")) ownerId = ctx.userId;
  if (!ownerId) ownerId = (await nextRoundRobinOwner(tx, ctx.tenantId)) ?? ctx.userId;
  await assertValidOwner(tx, ctx, ownerId);
  const statusId = input.statusId ?? (await defaultStatusId(tx));
  const domain = normalizeDomain(input.website) ?? (isBusinessEmail(input.email) ? emailDomain(input.email) : null);
  const values = { ...input, ownerId, statusId, domain, lastContactedAt: null };
  const { score, breakdown } = scoreFor(ctx, values);
  const [lead] = await tx
    .insert(leads)
    .values({
      ...input,
      tenantId: ctx.tenantId,
      ownerId,
      statusId,
      domain,
      website: input.website ? `https://${input.website}` : null,
      estimatedValue: input.estimatedValue !== null ? input.estimatedValue.toFixed(2) : null,
      score,
      scoreBreakdown: breakdown,
      createdById: ctx.userId,
    })
    .returning();
  if (!lead) throw new Error("Failed to create lead");
  await writeAudit(tx, actor(ctx), {
    action: "lead.created",
    entityType: "lead",
    entityId: lead.id,
    changes: { origin: opts.origin ?? "form" },
  });
  await emitEvent(tx, actor(ctx), { type: "lead.created", entityType: "lead", entityId: lead.id, payload: { origin: opts.origin ?? "form" } });
  return lead;
}

export function parseLeadInput(raw: unknown): LeadInput {
  const parsed = leadInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", fieldErrors(parsed.error));
  return parsed.data;
}

export async function createLead(ctx: TenantContext, raw: unknown, opts: CreateLeadOptions = {}): Promise<Lead> {
  need(ctx, "lead:write");
  const input = parseLeadInput(raw);
  return withScope(ctx, (tx) => createLeadInTx(tx, ctx, input, opts));
}

export async function updateLead(ctx: TenantContext, id: string, raw: unknown): Promise<Lead> {
  need(ctx, "lead:write");
  const input = parseLeadInput(raw);
  return withScope(ctx, async (tx) => {
    const before = await loadLead(tx, ctx, id);
    if (before.convertedAt) throw new ValidationError("Converted leads are read-only.");
    let ownerId = input.ownerId ?? before.ownerId;
    if (ownerId !== before.ownerId && !ctx.permissions.has("lead:assign")) ownerId = before.ownerId;
    await assertValidOwner(tx, ctx, ownerId);
    const domain = normalizeDomain(input.website) ?? (isBusinessEmail(input.email) ? emailDomain(input.email) : null);
    const next = {
      ...input,
      ownerId,
      statusId: input.statusId ?? before.statusId,
      domain,
      website: input.website ? `https://${input.website}` : null,
      estimatedValue: input.estimatedValue !== null ? input.estimatedValue.toFixed(2) : null,
    };
    const { score, breakdown } = scoreFor(ctx, { ...next, lastContactedAt: before.lastContactedAt });
    const [after] = await tx
      .update(leads)
      .set({ ...next, score, scoreBreakdown: breakdown })
      .where(eq(leads.id, id))
      .returning();
    if (!after) throw new NotFoundError();
    const changes = diffRecords(before, after);
    await writeAudit(tx, actor(ctx), { action: "lead.updated", entityType: "lead", entityId: id, changes });
    if (changes.statusId) {
      const [status] = await tx.select().from(leadStatuses).where(eq(leadStatuses.id, after.statusId));
      if (status?.category === "qualified") {
        await emitEvent(tx, actor(ctx), { type: "lead.qualified", entityType: "lead", entityId: id });
      }
    }
    return after;
  });
}

export async function setLeadStatus(ctx: TenantContext, ids: string[], statusId: string): Promise<number> {
  need(ctx, "lead:write");
  if (ids.length === 0) return 0;
  if (ids.length > 500) throw new ValidationError("Bulk updates are limited to 500 records at a time.");
  return withScope(ctx, async (tx) => {
    const [status] = await tx.select().from(leadStatuses).where(eq(leadStatuses.id, statusId));
    if (!status) throw new ValidationError("Unknown status.");
    if (status.category === "converted") throw new ValidationError("Use Convert to mark a lead converted.");
    const rows = await tx
      .select({ id: leads.id, ownerId: leads.ownerId, statusId: leads.statusId })
      .from(leads)
      .where(and(inArray(leads.id, ids), isNull(leads.archivedAt), isNull(leads.convertedAt), ownerScope(ctx, leads.ownerId)));
    if (rows.length === 0) return 0;
    await tx.update(leads).set({ statusId }).where(inArray(leads.id, rows.map((r) => r.id)));
    for (const r of rows) {
      await writeAudit(tx, actor(ctx), {
        action: "lead.status_changed",
        entityType: "lead",
        entityId: r.id,
        changes: { statusId: { from: r.statusId, to: statusId } },
      });
      if (status.category === "qualified")
        await emitEvent(tx, actor(ctx), { type: "lead.qualified", entityType: "lead", entityId: r.id });
    }
    return rows.length;
  });
}

export async function assignLeads(ctx: TenantContext, ids: string[], ownerId: string): Promise<number> {
  need(ctx, "lead:assign");
  if (ids.length === 0) return 0;
  if (ids.length > 500) throw new ValidationError("Bulk updates are limited to 500 records at a time.");
  return withScope(ctx, async (tx) => {
    await assertValidOwner(tx, ctx, ownerId);
    const rows = await tx
      .select({ id: leads.id, ownerId: leads.ownerId })
      .from(leads)
      .where(and(inArray(leads.id, ids), isNull(leads.archivedAt), ownerScope(ctx, leads.ownerId)));
    if (rows.length === 0) return 0;
    await tx.update(leads).set({ ownerId }).where(inArray(leads.id, rows.map((r) => r.id)));
    for (const r of rows) {
      await writeAudit(tx, actor(ctx), {
        action: "lead.assigned",
        entityType: "lead",
        entityId: r.id,
        changes: { ownerId: { from: r.ownerId, to: ownerId } },
      });
    }
    return rows.length;
  });
}

export async function archiveLeads(ctx: TenantContext, ids: string[]): Promise<number> {
  need(ctx, "lead:delete");
  if (ids.length === 0) return 0;
  return withScope(ctx, async (tx) => {
    const rows = await tx
      .update(leads)
      .set({ archivedAt: new Date() })
      .where(and(inArray(leads.id, ids), isNull(leads.archivedAt), ownerScope(ctx, leads.ownerId)))
      .returning({ id: leads.id });
    for (const r of rows) {
      await writeAudit(tx, actor(ctx), { action: "lead.archived", entityType: "lead", entityId: r.id });
    }
    return rows.length;
  });
}

// ─── Duplicate detection ────────────────────────────────────────────────────

export interface DuplicateCandidate {
  entityType: "lead" | "contact" | "account";
  id: string;
  label: string;
  reason: "email" | "phone" | "domain";
}

export async function findDuplicatesInTx(
  tx: Tx,
  input: { email?: string | null; phone?: string | null; website?: string | null; company?: string | null; excludeLeadId?: string },
): Promise<DuplicateCandidate[]> {
  const out: DuplicateCandidate[] = [];
  const email = normalizeEmail(input.email);
  if (email) {
    const ls = await tx
      .select({ id: leads.id, first: leads.firstName, last: leads.lastName })
      .from(leads)
      .where(and(sql`lower(${leads.email}) = ${email}`, isNull(leads.archivedAt)))
      .limit(5);
    for (const l of ls)
      if (l.id !== input.excludeLeadId)
        out.push({ entityType: "lead", id: l.id, label: [l.first, l.last].filter(Boolean).join(" "), reason: "email" });
    const cs = await tx
      .select({ id: contacts.id, first: contacts.firstName, last: contacts.lastName })
      .from(contacts)
      .where(and(sql`lower(${contacts.email}) = ${email}`, isNull(contacts.archivedAt)))
      .limit(5);
    for (const c of cs)
      out.push({ entityType: "contact", id: c.id, label: [c.first, c.last].filter(Boolean).join(" "), reason: "email" });
  }
  if (input.phone) {
    const ls = await tx
      .select({ id: leads.id, first: leads.firstName, last: leads.lastName })
      .from(leads)
      .where(and(eq(leads.phone, input.phone), isNull(leads.archivedAt)))
      .limit(5);
    for (const l of ls)
      if (l.id !== input.excludeLeadId && !out.some((o) => o.id === l.id))
        out.push({ entityType: "lead", id: l.id, label: [l.first, l.last].filter(Boolean).join(" "), reason: "phone" });
  }
  const domain = normalizeDomain(input.website) ?? (isBusinessEmail(email) ? emailDomain(email) : null);
  if (domain) {
    const as = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.domain, domain), isNull(accounts.archivedAt)))
      .limit(3);
    for (const a of as) out.push({ entityType: "account", id: a.id, label: a.name, reason: "domain" });
  }
  return out;
}

export async function findDuplicates(ctx: TenantContext, input: Parameters<typeof findDuplicatesInTx>[1]) {
  need(ctx, "lead:read");
  return withScope(ctx, (tx) => findDuplicatesInTx(tx, input));
}

// ─── Conversion ─────────────────────────────────────────────────────────────

export interface ConvertLeadInput {
  /** Existing account to attach to; when null a new account is created. */
  accountId: string | null;
  accountName?: string | null;
  /** Existing contact to attach to; when null a new contact is created from the lead. */
  contactId: string | null;
  createOpportunity: boolean;
  opportunity?: {
    name: string;
    pipelineId: string;
    amount: number | null;
    currency: string;
    expectedCloseDate: string | null;
  };
}

export interface ConvertLeadResult {
  accountId: string;
  contactId: string;
  opportunityId: string | null;
}

export async function convertLead(ctx: TenantContext, leadId: string, input: ConvertLeadInput): Promise<ConvertLeadResult> {
  need(ctx, "lead:convert");
  need(ctx, "account:write");
  need(ctx, "contact:write");
  if (input.createOpportunity) need(ctx, "opportunity:write");
  return withScope(ctx, async (tx) => {
    const lead = await loadLead(tx, ctx, leadId);
    // Lock to prevent double conversion.
    await tx.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).for("update");
    const [fresh] = await tx.select({ convertedAt: leads.convertedAt }).from(leads).where(eq(leads.id, leadId));
    if (fresh?.convertedAt) throw new ValidationError("This lead has already been converted.");
    const a = actor(ctx);
    const ownerId = lead.ownerId ?? ctx.userId;

    let accountId = input.accountId;
    if (accountId) {
      const [acc] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), isNull(accounts.archivedAt)));
      if (!acc) throw new ValidationError("Selected account was not found.");
    } else {
      const name = (input.accountName ?? lead.company ?? "").trim();
      if (!name) throw new ValidationError("An account name is required to convert this lead.", { accountName: ["Enter an account name."] });
      if (lead.domain) {
        const [existing] = await tx
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(and(eq(accounts.domain, lead.domain), isNull(accounts.archivedAt)));
        if (existing)
          throw new ValidationError(`An account with domain ${lead.domain} already exists (${existing.name}). Select it instead.`, {
            accountId: [`Existing account: ${existing.name}`],
          });
      }
      const [acc] = await tx
        .insert(accounts)
        .values({
          tenantId: ctx.tenantId,
          name,
          domain: lead.domain,
          website: lead.website,
          industry: lead.industry,
          country: lead.country,
          region: lead.region,
          employeeRange: lead.employeeRange,
          ownerId,
          createdById: ctx.userId,
        })
        .returning({ id: accounts.id });
      if (!acc) throw new Error("Failed to create account");
      accountId = acc.id;
      await writeAudit(tx, a, { action: "account.created", entityType: "account", entityId: accountId, changes: { fromLeadId: leadId } });
      await emitEvent(tx, a, { type: "account.created", entityType: "account", entityId: accountId });
    }

    let contactId = input.contactId;
    if (contactId) {
      const [c] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), isNull(contacts.archivedAt)));
      if (!c) throw new ValidationError("Selected contact was not found.");
      await tx.update(contacts).set({ accountId }).where(and(eq(contacts.id, contactId), isNull(contacts.accountId)));
    } else {
      const [c] = await tx
        .insert(contacts)
        .values({
          tenantId: ctx.tenantId,
          accountId,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          phone: lead.phone,
          jobTitle: lead.jobTitle,
          department: lead.department,
          country: lead.country,
          ownerId,
          consentEmail: lead.consentEmail,
          doNotContact: lead.doNotContact,
          lastContactedAt: lead.lastContactedAt,
          sourceLeadId: lead.id,
          createdById: ctx.userId,
        })
        .returning({ id: contacts.id });
      if (!c) throw new Error("Failed to create contact");
      contactId = c.id;
      await writeAudit(tx, a, { action: "contact.created", entityType: "contact", entityId: contactId, changes: { fromLeadId: leadId } });
      await emitEvent(tx, a, { type: "contact.created", entityType: "contact", entityId: contactId });
    }

    let opportunityId: string | null = null;
    if (input.createOpportunity && input.opportunity) {
      const o = input.opportunity;
      if (!o.name.trim()) throw new ValidationError("Opportunity name is required.", { opportunityName: ["Required."] });
      const [pipeline] = await tx.select().from(pipelines).where(eq(pipelines.id, o.pipelineId));
      if (!pipeline) throw new ValidationError("Unknown pipeline.");
      const [stage] = await tx
        .select()
        .from(pipelineStages)
        .where(and(eq(pipelineStages.pipelineId, pipeline.id), eq(pipelineStages.category, "open")))
        .orderBy(asc(pipelineStages.position))
        .limit(1);
      if (!stage) throw new ValidationError("The selected pipeline has no open stages.");
      const amount = (o.amount ?? 0).toFixed(2);
      const [opp] = await tx
        .insert(opportunities)
        .values({
          tenantId: ctx.tenantId,
          name: o.name.trim(),
          accountId,
          primaryContactId: contactId,
          ownerId,
          pipelineId: pipeline.id,
          stageId: stage.id,
          amount,
          currency: o.currency,
          expectedCloseDate: o.expectedCloseDate,
          forecastCategory: impliedForecastCategory("open", stage.probability),
          source: lead.source,
          campaignId: lead.campaignId,
          partnerId: lead.partnerId,
          sourceLeadId: lead.id,
          createdById: ctx.userId,
        })
        .returning({ id: opportunities.id });
      if (!opp) throw new Error("Failed to create opportunity");
      opportunityId = opp.id;
      await tx.insert(opportunityContacts).values({
        tenantId: ctx.tenantId,
        opportunityId,
        contactId,
        role: "other",
        isPrimary: true,
      });
      await tx.insert(opportunityStageHistory).values({
        tenantId: ctx.tenantId,
        opportunityId,
        fromStageId: null,
        toStageId: stage.id,
        amount,
        currency: o.currency,
        expectedCloseDate: o.expectedCloseDate,
        changedById: ctx.userId,
      });
      await writeAudit(tx, a, { action: "opportunity.created", entityType: "opportunity", entityId: opportunityId, changes: { fromLeadId: leadId } });
      await emitEvent(tx, a, { type: "opportunity.created", entityType: "opportunity", entityId: opportunityId });
    }

    const [convertedStatus] = await tx
      .select({ id: leadStatuses.id })
      .from(leadStatuses)
      .where(eq(leadStatuses.category, "converted"))
      .orderBy(asc(leadStatuses.position))
      .limit(1);
    if (!convertedStatus) throw new Error("No converted lead status configured");
    await tx
      .update(leads)
      .set({
        statusId: convertedStatus.id,
        convertedAt: new Date(),
        convertedAccountId: accountId,
        convertedContactId: contactId,
        convertedOpportunityId: opportunityId,
      })
      .where(eq(leads.id, leadId));
    // Carry the lead's history onto the new records so the timeline stays intact.
    await tx
      .update(activities)
      .set({ accountId, contactId, ...(opportunityId ? { opportunityId } : {}) })
      .where(eq(activities.leadId, leadId));
    await writeAudit(tx, a, {
      action: "lead.converted",
      entityType: "lead",
      entityId: leadId,
      changes: { accountId, contactId, opportunityId },
    });
    await emitEvent(tx, a, {
      type: "lead.converted",
      entityType: "lead",
      entityId: leadId,
      payload: { accountId, contactId, opportunityId },
    });
    return { accountId, contactId, opportunityId };
  });
}

// ─── Merge ──────────────────────────────────────────────────────────────────

export const MERGEABLE_LEAD_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "jobTitle",
  "company",
  "website",
  "industry",
  "country",
  "source",
  "productInterest",
  "businessProblem",
  "ownerId",
  "statusId",
] as const;
export type MergeableLeadField = (typeof MERGEABLE_LEAD_FIELDS)[number];

/**
 * Merges `sourceId` into `targetId`. For each field, `choices` picks which
 * record's value survives (default: target, falling back to source when the
 * target is blank). Activities move to the target; the source is archived.
 */
export async function mergeLeads(
  ctx: TenantContext,
  targetId: string,
  sourceId: string,
  choices: Partial<Record<MergeableLeadField, "target" | "source">> = {},
): Promise<Lead> {
  need(ctx, "lead:write");
  need(ctx, "lead:delete");
  if (targetId === sourceId) throw new ValidationError("Choose two different leads to merge.");
  return withScope(ctx, async (tx) => {
    const target = await loadLead(tx, ctx, targetId);
    const source = await loadLead(tx, ctx, sourceId);
    if (target.convertedAt || source.convertedAt) throw new ValidationError("Converted leads cannot be merged.");
    const patch: Partial<Lead> = {};
    for (const f of MERGEABLE_LEAD_FIELDS) {
      const pick = choices[f] ?? (target[f] === null || target[f] === "" ? "source" : "target");
      if (pick === "source" && source[f] !== null) (patch as Record<string, unknown>)[f] = source[f];
    }
    const merged = { ...target, ...patch };
    const { score, breakdown } = scoreFor(ctx, merged);
    const [after] = await tx
      .update(leads)
      .set({ ...patch, score, scoreBreakdown: breakdown })
      .where(eq(leads.id, targetId))
      .returning();
    await tx.update(activities).set({ leadId: targetId }).where(eq(activities.leadId, sourceId));
    await tx.update(leads).set({ archivedAt: new Date() }).where(eq(leads.id, sourceId));
    await writeAudit(tx, actor(ctx), {
      action: "lead.merged",
      entityType: "lead",
      entityId: targetId,
      changes: { mergedLeadId: sourceId, fields: diffRecords(target, after ?? target) },
    });
    if (!after) throw new NotFoundError();
    return after;
  });
}

export async function recomputeLeadScores(ctx: TenantContext): Promise<number> {
  need(ctx, "admin:settings");
  return withScope(ctx, async (tx) => {
    const rows = await tx.select().from(leads).where(and(isNull(leads.archivedAt), isNull(leads.convertedAt)));
    for (const l of rows) {
      const { score, breakdown } = scoreFor(ctx, l);
      if (score !== l.score) await tx.update(leads).set({ score, scoreBreakdown: breakdown }).where(eq(leads.id, l.id));
    }
    return rows.length;
  });
}

import "server-only";
import { and, asc, desc, eq, ilike, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { withScope, type Tx } from "@/server/db/client";
import {
  accounts,
  contacts,
  opportunities,
  opportunityContacts,
  pipelineStages,
  users,
  type Account,
  type Contact,
} from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/permissions";
import { diffRecords, emitEvent, writeAudit } from "@/server/lib/audit";
import {
  accountInputSchema,
  contactInputSchema,
  fieldErrors,
  type AccountInput,
  type ContactInput,
} from "@/server/validation/crm";
import { actor, assertOwnerAccess, assertValidOwner, likeTerm, need, ownerScope, pageArgs, type Page } from "./_shared";

// ─── Accounts ───────────────────────────────────────────────────────────────

export interface AccountFilters {
  q?: string;
  ownerId?: string | "me";
  status?: string;
  strategic?: boolean;
  page?: number;
  pageSize?: number;
  sort?: "name_asc" | "created_desc" | "open_pipeline_desc";
}

export interface AccountRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  country: string | null;
  status: string;
  tier: string | null;
  isStrategic: boolean;
  ownerName: string | null;
  openOpportunities: number;
  contactCount: number;
  createdAt: Date;
}

export async function listAccounts(ctx: TenantContext, f: AccountFilters = {}): Promise<Page<AccountRow>> {
  need(ctx, "account:read");
  const { page, pageSize, offset } = pageArgs(f.page, f.pageSize);
  const conds: (SQL | undefined)[] = [isNull(accounts.archivedAt), ownerScope(ctx, accounts.ownerId)];
  if (f.q) {
    const t = likeTerm(f.q.trim());
    conds.push(or(ilike(accounts.name, t), ilike(accounts.domain, t)));
  }
  if (f.ownerId === "me") conds.push(eq(accounts.ownerId, ctx.userId));
  else if (f.ownerId) conds.push(eq(accounts.ownerId, f.ownerId));
  if (f.status) conds.push(eq(accounts.status, f.status));
  if (f.strategic) conds.push(eq(accounts.isStrategic, true));
  const where = and(...conds);
  const openOpps = sql<number>`(select count(*)::int from ${opportunities} o join ${pipelineStages} s on s.id = o.stage_id where o.account_id = ${accounts.id} and o.archived_at is null and s.category = 'open')`;
  const contactCount = sql<number>`(select count(*)::int from ${contacts} c where c.account_id = ${accounts.id} and c.archived_at is null)`;
  const order =
    f.sort === "created_desc"
      ? [desc(accounts.createdAt)]
      : f.sort === "open_pipeline_desc"
        ? [desc(openOpps), asc(accounts.name)]
        : [asc(accounts.name)];
  return withScope(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: accounts.id,
        name: accounts.name,
        domain: accounts.domain,
        industry: accounts.industry,
        country: accounts.country,
        status: accounts.status,
        tier: accounts.tier,
        isStrategic: accounts.isStrategic,
        ownerName: users.name,
        openOpportunities: openOpps,
        contactCount,
        createdAt: accounts.createdAt,
      })
      .from(accounts)
      .leftJoin(users, eq(users.id, accounts.ownerId))
      .where(where)
      .orderBy(...order)
      .limit(pageSize)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(accounts).where(where);
    return { rows, total: c?.n ?? 0, page, pageSize };
  });
}

async function loadAccount(tx: Tx, ctx: TenantContext, id: string): Promise<Account> {
  const [a] = await tx.select().from(accounts).where(and(eq(accounts.id, id), isNull(accounts.archivedAt))).limit(1);
  if (!a) throw new NotFoundError("Account not found.");
  await assertOwnerAccess(tx, ctx, a.ownerId);
  return a;
}

export async function getAccount(ctx: TenantContext, id: string) {
  need(ctx, "account:read");
  return withScope(ctx, async (tx) => {
    const account = await loadAccount(tx, ctx, id);
    const [owner] = account.ownerId
      ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, account.ownerId))
      : [];
    const [parent] = account.parentAccountId
      ? await tx.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, account.parentAccountId))
      : [];
    const children = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.parentAccountId, id), isNull(accounts.archivedAt)));
    const accountContacts = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.accountId, id), isNull(contacts.archivedAt)))
      .orderBy(asc(contacts.lastName));
    const opps = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        amount: opportunities.amount,
        currency: opportunities.currency,
        expectedCloseDate: opportunities.expectedCloseDate,
        stageName: pipelineStages.name,
        stageCategory: pipelineStages.category,
        probability: pipelineStages.probability,
        probabilityOverride: opportunities.probabilityOverride,
        ownerName: users.name,
        closedAt: opportunities.closedAt,
      })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .where(and(eq(opportunities.accountId, id), isNull(opportunities.archivedAt)))
      .orderBy(desc(opportunities.createdAt));
    // Buying committee: contacts' roles across this account's open opportunities.
    const committee = await tx
      .select({ contactId: opportunityContacts.contactId, role: opportunityContacts.role })
      .from(opportunityContacts)
      .innerJoin(opportunities, eq(opportunities.id, opportunityContacts.opportunityId))
      .where(eq(opportunities.accountId, id));
    return { account, owner: owner ?? null, parent: parent ?? null, children, contacts: accountContacts, opportunities: opps, committee };
  });
}

export function parseAccountInput(raw: unknown): AccountInput {
  const parsed = accountInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", fieldErrors(parsed.error));
  return parsed.data;
}

async function assertDomainFree(tx: Tx, domain: string | null, exceptId?: string): Promise<void> {
  if (!domain) return;
  const [dup] = await tx
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.domain, domain), isNull(accounts.archivedAt), exceptId ? ne(accounts.id, exceptId) : undefined))
    .limit(1);
  if (dup)
    throw new ValidationError(`Another account already uses ${domain}.`, { website: [`Already used by ${dup.name}.`] });
}

export async function createAccountInTx(tx: Tx, ctx: TenantContext, input: AccountInput): Promise<Account> {
  const ownerId = input.ownerId ?? ctx.userId;
  await assertValidOwner(tx, ctx, ownerId);
  await assertDomainFree(tx, input.website);
  const [a] = await tx
    .insert(accounts)
    .values({
      ...input,
      tenantId: ctx.tenantId,
      ownerId,
      domain: input.website,
      website: input.website ? `https://${input.website}` : null,
      createdById: ctx.userId,
    })
    .returning();
  if (!a) throw new Error("Failed to create account");
  await writeAudit(tx, actor(ctx), { action: "account.created", entityType: "account", entityId: a.id });
  await emitEvent(tx, actor(ctx), { type: "account.created", entityType: "account", entityId: a.id });
  return a;
}

export async function createAccount(ctx: TenantContext, raw: unknown): Promise<Account> {
  need(ctx, "account:write");
  const input = parseAccountInput(raw);
  return withScope(ctx, (tx) => createAccountInTx(tx, ctx, input));
}

export async function updateAccount(ctx: TenantContext, id: string, raw: unknown): Promise<Account> {
  need(ctx, "account:write");
  const input = parseAccountInput(raw);
  if (input.parentAccountId === id) throw new ValidationError("An account cannot be its own parent.");
  return withScope(ctx, async (tx) => {
    const before = await loadAccount(tx, ctx, id);
    const ownerId = input.ownerId ?? before.ownerId;
    await assertValidOwner(tx, ctx, ownerId);
    await assertDomainFree(tx, input.website, id);
    if (input.parentAccountId) {
      // Prevent cycles in the hierarchy.
      const ancestors = await tx.execute<{ id: string }>(sql`
        with recursive chain(id, parent_account_id) as (
          select id, parent_account_id from accounts where id = ${input.parentAccountId}
          union all
          select a.id, a.parent_account_id from accounts a join chain c on a.id = c.parent_account_id
        ) select id from chain`);
      if (ancestors.some((r) => r.id === id)) throw new ValidationError("That parent would create a hierarchy cycle.");
    }
    const [after] = await tx
      .update(accounts)
      .set({ ...input, ownerId, domain: input.website, website: input.website ? `https://${input.website}` : null })
      .where(eq(accounts.id, id))
      .returning();
    if (!after) throw new NotFoundError();
    await writeAudit(tx, actor(ctx), { action: "account.updated", entityType: "account", entityId: id, changes: diffRecords(before, after) });
    return after;
  });
}

export async function archiveAccount(ctx: TenantContext, id: string): Promise<void> {
  need(ctx, "account:delete");
  await withScope(ctx, async (tx) => {
    await loadAccount(tx, ctx, id);
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(and(eq(opportunities.accountId, id), isNull(opportunities.archivedAt), eq(pipelineStages.category, "open")));
    if ((open?.n ?? 0) > 0) throw new ValidationError("Close or reassign open opportunities before archiving this account.");
    await tx.update(accounts).set({ archivedAt: new Date() }).where(eq(accounts.id, id));
    await writeAudit(tx, actor(ctx), { action: "account.archived", entityType: "account", entityId: id });
  });
}

export async function accountOptions(ctx: TenantContext, q?: string): Promise<{ id: string; name: string }[]> {
  need(ctx, "account:read");
  return withScope(ctx, (tx) =>
    tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(isNull(accounts.archivedAt), ownerScope(ctx, accounts.ownerId), q ? ilike(accounts.name, likeTerm(q)) : undefined))
      .orderBy(asc(accounts.name))
      .limit(200),
  );
}

// ─── Contacts ───────────────────────────────────────────────────────────────

export interface ContactFilters {
  q?: string;
  accountId?: string;
  ownerId?: string | "me";
  page?: number;
  pageSize?: number;
}

export async function listContacts(ctx: TenantContext, f: ContactFilters = {}) {
  need(ctx, "contact:read");
  const { page, pageSize, offset } = pageArgs(f.page, f.pageSize);
  const conds: (SQL | undefined)[] = [isNull(contacts.archivedAt), ownerScope(ctx, contacts.ownerId)];
  if (f.q) {
    const t = likeTerm(f.q.trim());
    conds.push(or(ilike(sql`coalesce(${contacts.firstName},'') || ' ' || ${contacts.lastName}`, t), ilike(contacts.email, t)));
  }
  if (f.accountId) conds.push(eq(contacts.accountId, f.accountId));
  if (f.ownerId === "me") conds.push(eq(contacts.ownerId, ctx.userId));
  else if (f.ownerId) conds.push(eq(contacts.ownerId, f.ownerId));
  const where = and(...conds);
  return withScope(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        buyingRole: contacts.buyingRole,
        accountId: contacts.accountId,
        accountName: accounts.name,
        ownerName: users.name,
        lastContactedAt: contacts.lastContactedAt,
        doNotContact: contacts.doNotContact,
      })
      .from(contacts)
      .leftJoin(accounts, eq(accounts.id, contacts.accountId))
      .leftJoin(users, eq(users.id, contacts.ownerId))
      .where(where)
      .orderBy(asc(contacts.lastName), asc(contacts.firstName))
      .limit(pageSize)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(contacts).where(where);
    return { rows, total: c?.n ?? 0, page, pageSize };
  });
}

async function loadContact(tx: Tx, ctx: TenantContext, id: string): Promise<Contact> {
  const [c] = await tx.select().from(contacts).where(and(eq(contacts.id, id), isNull(contacts.archivedAt))).limit(1);
  if (!c) throw new NotFoundError("Contact not found.");
  await assertOwnerAccess(tx, ctx, c.ownerId);
  return c;
}

export async function getContact(ctx: TenantContext, id: string) {
  need(ctx, "contact:read");
  return withScope(ctx, async (tx) => {
    const contact = await loadContact(tx, ctx, id);
    const [account] = contact.accountId
      ? await tx.select({ id: accounts.id, name: accounts.name }).from(accounts).where(eq(accounts.id, contact.accountId))
      : [];
    const [owner] = contact.ownerId
      ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, contact.ownerId))
      : [];
    const opps = await tx
      .select({
        id: opportunities.id,
        name: opportunities.name,
        role: opportunityContacts.role,
        stageName: pipelineStages.name,
        amount: opportunities.amount,
        currency: opportunities.currency,
      })
      .from(opportunityContacts)
      .innerJoin(opportunities, eq(opportunities.id, opportunityContacts.opportunityId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(eq(opportunityContacts.contactId, id));
    return { contact, account: account ?? null, owner: owner ?? null, opportunities: opps };
  });
}

export function parseContactInput(raw: unknown): ContactInput {
  const parsed = contactInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please correct the highlighted fields.", fieldErrors(parsed.error));
  return parsed.data;
}

async function assertAccountExists(tx: Tx, accountId: string | null): Promise<void> {
  if (!accountId) return;
  const [a] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, accountId), isNull(accounts.archivedAt)));
  if (!a) throw new ValidationError("Selected account was not found.", { accountId: ["Not found."] });
}

export async function createContactInTx(tx: Tx, ctx: TenantContext, input: ContactInput): Promise<Contact> {
  const ownerId = input.ownerId ?? ctx.userId;
  await assertValidOwner(tx, ctx, ownerId);
  await assertAccountExists(tx, input.accountId);
  if (input.email) {
    const [dup] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(sql`lower(${contacts.email}) = ${input.email}`, isNull(contacts.archivedAt)))
      .limit(1);
    if (dup) throw new ValidationError("A contact with this email already exists.", { email: ["Duplicate email."] });
  }
  const [c] = await tx
    .insert(contacts)
    .values({ ...input, tenantId: ctx.tenantId, ownerId, createdById: ctx.userId })
    .returning();
  if (!c) throw new Error("Failed to create contact");
  await writeAudit(tx, actor(ctx), { action: "contact.created", entityType: "contact", entityId: c.id });
  await emitEvent(tx, actor(ctx), { type: "contact.created", entityType: "contact", entityId: c.id });
  return c;
}

export async function createContact(ctx: TenantContext, raw: unknown): Promise<Contact> {
  need(ctx, "contact:write");
  const input = parseContactInput(raw);
  return withScope(ctx, (tx) => createContactInTx(tx, ctx, input));
}

export async function updateContact(ctx: TenantContext, id: string, raw: unknown): Promise<Contact> {
  need(ctx, "contact:write");
  const input = parseContactInput(raw);
  return withScope(ctx, async (tx) => {
    const before = await loadContact(tx, ctx, id);
    const ownerId = input.ownerId ?? before.ownerId;
    await assertValidOwner(tx, ctx, ownerId);
    await assertAccountExists(tx, input.accountId);
    if (input.email && input.email !== before.email?.toLowerCase()) {
      const [dup] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(sql`lower(${contacts.email}) = ${input.email}`, isNull(contacts.archivedAt), ne(contacts.id, id)))
        .limit(1);
      if (dup) throw new ValidationError("A contact with this email already exists.", { email: ["Duplicate email."] });
    }
    const [after] = await tx.update(contacts).set({ ...input, ownerId }).where(eq(contacts.id, id)).returning();
    if (!after) throw new NotFoundError();
    await writeAudit(tx, actor(ctx), { action: "contact.updated", entityType: "contact", entityId: id, changes: diffRecords(before, after) });
    return after;
  });
}

export async function archiveContact(ctx: TenantContext, id: string): Promise<void> {
  need(ctx, "contact:delete");
  await withScope(ctx, async (tx) => {
    await loadContact(tx, ctx, id);
    await tx.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, id));
    await writeAudit(tx, actor(ctx), { action: "contact.archived", entityType: "contact", entityId: id });
  });
}

export async function contactOptions(ctx: TenantContext, accountId?: string) {
  need(ctx, "contact:read");
  return withScope(ctx, (tx) =>
    tx
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, accountId: contacts.accountId })
      .from(contacts)
      .where(and(isNull(contacts.archivedAt), ownerScope(ctx, contacts.ownerId), accountId ? eq(contacts.accountId, accountId) : undefined))
      .orderBy(asc(contacts.lastName))
      .limit(500),
  );
}

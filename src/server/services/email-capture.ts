import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, withScope, type Tx } from "@/server/db/client";
import {
  accounts,
  activities,
  contacts,
  emailCaptureTokens,
  emailMessages,
  leads,
  opportunities,
  opportunityContacts,
  pipelineStages,
  tenantMemberships,
  users,
  type EmailMessage,
} from "@/server/db/schema";
import { loadTenantContext, type TenantContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/permissions";
import { writeAudit } from "@/server/lib/audit";
import { decryptSecret, encryptSecret, sha256Hex } from "@/server/lib/crypto";
import { logger } from "@/server/lib/logger";
import { emailDomain, isBusinessEmail } from "@/server/domain/normalize";
import {
  CAPTURE_TOKEN_RE,
  captureAddress,
  isCaptureAddressOf,
  parsePostmarkInbound,
  planCapture,
  type Address,
  type CapturePlan,
} from "@/server/email/inbound";
import { createLeadInTx, findDuplicatesInTx, parseLeadInput } from "./leads";
import { actor, assertOwnerAccess, need } from "./_shared";

export const MAX_INBOUND_BYTES = 4 * 1024 * 1024;
const ACTIVITY_BODY_CHARS = 8000;

type Link = EmailMessage["links"][number];

/* ─── Configuration ─────────────────────────────────────────────────────── */

function inboundAddress(): string | null {
  const v = process.env.POSTMARK_INBOUND_ADDRESS?.trim();
  return v && /^[^@\s]+@[^@\s]+$/.test(v) ? v : null;
}

export function emailCaptureConfigured(): boolean {
  return !!inboundAddress() && (process.env.INBOUND_EMAIL_SECRET?.length ?? 0) >= 24 && !!process.env.ENCRYPTION_KEY;
}

/** Validates Postmark's HTTP basic auth (any username; password = INBOUND_EMAIL_SECRET). */
export function inboundAuthorized(authorization: string | null): boolean {
  const secret = process.env.INBOUND_EMAIL_SECRET ?? "";
  if (secret.length < 24 || !authorization?.toLowerCase().startsWith("basic ")) return false;
  const decoded = Buffer.from(authorization.slice(6).trim(), "base64").toString("utf8");
  const password = decoded.slice(decoded.indexOf(":") + 1);
  const a = Buffer.from(sha256Hex(password), "hex");
  const b = Buffer.from(sha256Hex(secret), "hex");
  return timingSafeEqual(a, b);
}

/* ─── Per-user capture address ──────────────────────────────────────────── */

function newToken(): string {
  return randomBytes(12).toString("hex"); // 24 lowercase hex chars
}

async function upsertToken(tx: Tx, ctx: TenantContext, token: string): Promise<void> {
  await tx
    .insert(emailCaptureTokens)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, tokenHash: sha256Hex(token), tokenEncrypted: encryptSecret(token) })
    .onConflictDoUpdate({
      target: [emailCaptureTokens.tenantId, emailCaptureTokens.userId],
      set: { tokenHash: sha256Hex(token), tokenEncrypted: encryptSecret(token), createdAt: new Date() },
    });
}

/** Returns the caller's personal BCC/forward address, creating it on first use. */
export async function getMyCaptureAddress(ctx: TenantContext): Promise<string | null> {
  need(ctx, "activity:write");
  const base = inboundAddress();
  if (!base || !emailCaptureConfigured()) return null;
  return withScope(ctx, async (tx) => {
    const [row] = await tx.select().from(emailCaptureTokens).where(eq(emailCaptureTokens.userId, ctx.userId));
    let token = row ? decryptSecret(row.tokenEncrypted) : null;
    if (!token) {
      token = newToken();
      await upsertToken(tx, ctx, token);
    }
    return captureAddress(base, token);
  });
}

/** Issues a new address; the old one stops working immediately. */
export async function regenerateMyCaptureAddress(ctx: TenantContext): Promise<void> {
  need(ctx, "activity:write");
  if (!emailCaptureConfigured()) throw new ValidationError("Email capture is not configured on the server.");
  await withScope(ctx, async (tx) => {
    await upsertToken(tx, ctx, newToken());
    await writeAudit(tx, actor(ctx), { action: "email_capture.address_regenerated", entityType: "user", entityId: ctx.userId });
  });
}

/* ─── Matching and logging ──────────────────────────────────────────────── */

async function memberEmails(tx: Tx): Promise<Set<string>> {
  const rows = await tx
    .select({ email: users.email })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId));
  return new Set(rows.map((r) => r.email.toLowerCase()));
}

async function inScope(tx: Tx, ctx: TenantContext, ownerId: string | null): Promise<boolean> {
  try {
    await assertOwnerAccess(tx, ctx, ownerId);
    return true;
  } catch {
    return false;
  }
}

interface Target {
  leadId: string | null;
  contactId: string | null;
  accountId: string | null;
  opportunityId: string | null;
}

/**
 * Matches the thread's external people to contacts, then open leads, then
 * companies by business domain — only records within the capturing user's
 * data scope. A contact on exactly one open deal also links that deal.
 */
async function findTargets(tx: Tx, ctx: TenantContext, people: Address[]): Promise<Target[]> {
  if (!people.length) return [];
  const emails = people.map((p) => p.email);
  const targets: Target[] = [];
  const covered = new Set<string>();
  const coveredAccounts = new Set<string>();

  const cs = await tx
    .select({ id: contacts.id, email: contacts.email, ownerId: contacts.ownerId, accountId: contacts.accountId })
    .from(contacts)
    .where(and(inArray(sql`lower(${contacts.email})`, emails), isNull(contacts.archivedAt)));
  for (const c of cs) {
    const e = c.email!.toLowerCase();
    if (covered.has(e) || !(await inScope(tx, ctx, c.ownerId))) continue;
    covered.add(e);
    const opps = await tx
      .selectDistinct({ id: opportunities.id, ownerId: opportunities.ownerId })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(opportunityContacts, eq(opportunityContacts.opportunityId, opportunities.id))
      .where(
        and(
          eq(pipelineStages.category, "open"),
          isNull(opportunities.archivedAt),
          or(eq(opportunities.primaryContactId, c.id), eq(opportunityContacts.contactId, c.id)),
        ),
      )
      .limit(2);
    const opp = opps.length === 1 && (await inScope(tx, ctx, opps[0]!.ownerId)) ? opps[0]!.id : null;
    targets.push({ leadId: null, contactId: c.id, accountId: c.accountId, opportunityId: opp });
    if (c.accountId) coveredAccounts.add(c.accountId);
  }

  const remaining = emails.filter((e) => !covered.has(e));
  if (remaining.length) {
    const ls = await tx
      .select({ id: leads.id, email: leads.email, ownerId: leads.ownerId })
      .from(leads)
      .where(and(inArray(sql`lower(${leads.email})`, remaining), isNull(leads.archivedAt), isNull(leads.convertedAt)));
    for (const l of ls) {
      const e = l.email!.toLowerCase();
      if (covered.has(e) || !(await inScope(tx, ctx, l.ownerId))) continue;
      covered.add(e);
      targets.push({ leadId: l.id, contactId: null, accountId: null, opportunityId: null });
    }
  }

  const domains = [...new Set(emails.filter((e) => !covered.has(e) && isBusinessEmail(e)).map((e) => emailDomain(e)!))];
  if (domains.length) {
    const as = await tx
      .select({ id: accounts.id, ownerId: accounts.ownerId })
      .from(accounts)
      .where(and(inArray(accounts.domain, domains), isNull(accounts.archivedAt)));
    for (const a of as) {
      if (coveredAccounts.has(a.id) || !(await inScope(tx, ctx, a.ownerId))) continue;
      coveredAccounts.add(a.id);
      targets.push({ leadId: null, contactId: null, accountId: a.id, opportunityId: null });
    }
  }
  return targets.slice(0, 10);
}

function fmt(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

function activityBody(plan: CapturePlan): string {
  const head = [
    plan.from ? `From: ${fmt(plan.from)}` : null,
    plan.to.length ? `To: ${plan.to.map(fmt).join(", ")}` : null,
    plan.cc.length ? `Cc: ${plan.cc.map(fmt).join(", ")}` : null,
  ].filter(Boolean);
  const body = plan.body.length > ACTIVITY_BODY_CHARS ? `${plan.body.slice(0, ACTIVITY_BODY_CHARS)}\n…` : plan.body;
  return `${head.join("\n")}\n\n${body}`.trim();
}

/** Logs one email activity per matched record and returns the links. */
async function logToTargets(tx: Tx, ctx: TenantContext, plan: CapturePlan): Promise<Link[]> {
  const targets = await findTargets(tx, ctx, plan.participants);
  const links: Link[] = [];
  const body = activityBody(plan);
  for (const t of targets) {
    await tx.insert(activities).values({
      tenantId: ctx.tenantId,
      type: "email",
      subject: plan.subject,
      body,
      ownerId: ctx.userId,
      ...t,
      occurredAt: plan.sentAt,
      completedAt: plan.sentAt,
      outcome: plan.direction === "outbound" ? "sent" : "received",
      createdById: ctx.userId,
    });
    const at = plan.sentAt;
    if (t.leadId) {
      await tx.update(leads).set({ lastContactedAt: at }).where(and(eq(leads.id, t.leadId), or(isNull(leads.lastContactedAt), lt(leads.lastContactedAt, at))));
      links.push({ type: "lead", id: t.leadId });
    }
    if (t.contactId) {
      await tx
        .update(contacts)
        .set({ lastContactedAt: at })
        .where(and(eq(contacts.id, t.contactId), or(isNull(contacts.lastContactedAt), lt(contacts.lastContactedAt, at))));
      links.push({ type: "contact", id: t.contactId });
    }
    if (t.accountId && !links.some((l) => l.type === "account" && l.id === t.accountId)) links.push({ type: "account", id: t.accountId });
    if (t.opportunityId && !links.some((l) => l.type === "opportunity" && l.id === t.opportunityId)) links.push({ type: "opportunity", id: t.opportunityId });
  }
  return links;
}

function planFromRow(row: EmailMessage, members: Set<string>): CapturePlan {
  const isCapture = isCaptureAddressOf(inboundAddress() ?? undefined);
  const from: Address = { email: row.fromEmail, name: row.fromName };
  const to = row.toEmails.map((email) => ({ email, name: null }));
  const cc = row.ccEmails.map((email) => ({ email, name: null }));
  const participants = [from, ...to, ...cc].filter((a, i, all) => !members.has(a.email) && !isCapture(a.email) && all.findIndex((b) => b.email === a.email) === i);
  return { direction: row.direction === "outbound" ? "outbound" : "inbound", subject: row.subject, sentAt: row.sentAt, body: row.bodyText ?? "", from, to, cc, participants };
}

/* ─── Inbound webhook ───────────────────────────────────────────────────── */

export interface InboundEmailResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Handles a Postmark inbound email (caller has verified basic auth). Unknown
 * or revoked addresses are acknowledged with 200 so Postmark does not retry,
 * and nothing is stored for them.
 */
export async function handleInboundEmail(rawBody: string): Promise<InboundEmailResult> {
  if (Buffer.byteLength(rawBody) > MAX_INBOUND_BYTES) return { status: 413, body: { error: "payload_too_large" } };
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const email = parsePostmarkInbound(payload);
  if (!email) return { status: 422, body: { error: "unparseable_email" } };
  if (!email.mailboxHash || !CAPTURE_TOKEN_RE.test(email.mailboxHash)) return { status: 200, body: { status: "ignored", reason: "no_capture_token" } };

  const rows = await db().execute<{ tenant_id: string; user_id: string }>(
    sql`select tenant_id, user_id from resolve_email_capture(${sha256Hex(email.mailboxHash)})`,
  );
  const owner = rows[0];
  if (!owner) {
    logger.warn("email_capture.unknown_token");
    return { status: 200, body: { status: "ignored", reason: "unknown_address" } };
  }
  const ctx = await loadTenantContext(owner.user_id, owner.tenant_id);
  if (!ctx || !ctx.permissions.has("activity:write")) return { status: 200, body: { status: "ignored", reason: "user_inactive" } };

  return withScope(ctx, async (tx) => {
    const [dupe] = await tx.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.messageId, email.messageId));
    if (dupe) return { status: 200, body: { status: "duplicate", id: dupe.id } };
    const members = await memberEmails(tx);
    const plan = planCapture(email, members, isCaptureAddressOf(inboundAddress() ?? undefined));
    const links = await logToTargets(tx, ctx, plan);
    const [row] = await tx
      .insert(emailMessages)
      .values({
        tenantId: ctx.tenantId,
        capturedById: ctx.userId,
        provider: "postmark",
        messageId: email.messageId,
        direction: plan.direction,
        subject: plan.subject,
        fromEmail: plan.from?.email ?? email.from?.email ?? "unknown",
        fromName: plan.from?.name ?? null,
        toEmails: plan.to.map((a) => a.email),
        ccEmails: plan.cc.map((a) => a.email),
        sentAt: plan.sentAt,
        snippet: plan.body.replace(/\s+/g, " ").trim().slice(0, 240) || null,
        bodyText: plan.body,
        attachmentCount: email.attachmentCount,
        status: links.length ? "matched" : "unmatched",
        links,
      })
      .returning({ id: emailMessages.id });
    await writeAudit(tx, actor(ctx), { action: "email.captured", entityType: "email", entityId: row!.id, changes: { links: links.length } });
    return { status: 201, body: { status: links.length ? "matched" : "unmatched", id: row!.id, links: links.length } };
  });
}

/* ─── Review queue ──────────────────────────────────────────────────────── */

export type CapturedEmailRow = Pick<
  EmailMessage,
  "id" | "direction" | "subject" | "fromEmail" | "fromName" | "toEmails" | "ccEmails" | "sentAt" | "snippet" | "status" | "links" | "attachmentCount"
>;

export async function listMyCapturedEmails(ctx: TenantContext, status: "unmatched" | "matched" | "all" = "all", limit = 50): Promise<CapturedEmailRow[]> {
  need(ctx, "activity:read");
  return withScope(ctx, (tx) =>
    tx
      .select({
        id: emailMessages.id,
        direction: emailMessages.direction,
        subject: emailMessages.subject,
        fromEmail: emailMessages.fromEmail,
        fromName: emailMessages.fromName,
        toEmails: emailMessages.toEmails,
        ccEmails: emailMessages.ccEmails,
        sentAt: emailMessages.sentAt,
        snippet: emailMessages.snippet,
        status: emailMessages.status,
        links: emailMessages.links,
        attachmentCount: emailMessages.attachmentCount,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.capturedById, ctx.userId),
          status === "all" ? sql`${emailMessages.status} <> 'dismissed'` : eq(emailMessages.status, status),
        ),
      )
      .orderBy(desc(emailMessages.sentAt))
      .limit(Math.min(limit, 200)),
  );
}

async function loadMine(tx: Tx, ctx: TenantContext, id: string): Promise<EmailMessage> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError("Email not found.");
  const [row] = await tx.select().from(emailMessages).where(and(eq(emailMessages.id, id), eq(emailMessages.capturedById, ctx.userId)));
  if (!row) throw new NotFoundError("Email not found.");
  return row;
}

export async function dismissCapturedEmail(ctx: TenantContext, id: string): Promise<void> {
  need(ctx, "activity:write");
  await withScope(ctx, async (tx) => {
    await loadMine(tx, ctx, id);
    await tx.update(emailMessages).set({ status: "dismissed" }).where(eq(emailMessages.id, id));
  });
}

/** Re-runs matching for an unmatched email (e.g. after the contact was added). */
export async function rematchCapturedEmail(ctx: TenantContext, id: string): Promise<number> {
  need(ctx, "activity:write");
  return withScope(ctx, async (tx) => {
    const row = await loadMine(tx, ctx, id);
    if (row.status === "matched") return row.links.length;
    const links = await logToTargets(tx, ctx, planFromRow(row, await memberEmails(tx)));
    if (links.length) await tx.update(emailMessages).set({ status: "matched", links }).where(eq(emailMessages.id, id));
    return links.length;
  });
}

function nameFromAddress(a: Address): { firstName: string | null; lastName: string } {
  const source = a.name?.trim() || a.email.split("@")[0]!.replace(/[._-]+/g, " ").replace(/\d+/g, " ").trim();
  const parts = source.split(/\s+/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  if (parts.length === 0) return { firstName: null, lastName: a.email.split("@")[0]! };
  if (parts.length === 1) return { firstName: null, lastName: parts[0]! };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! };
}

/** Creates a lead from the first external person on an unmatched email, then links the email. */
export async function createLeadFromCapturedEmail(ctx: TenantContext, id: string): Promise<{ leadId: string }> {
  need(ctx, "lead:write");
  need(ctx, "activity:write");
  return withScope(ctx, async (tx) => {
    const row = await loadMine(tx, ctx, id);
    const plan = planFromRow(row, await memberEmails(tx));
    const person = plan.participants[0];
    if (!person) throw new ValidationError("This email has no external sender or recipient to create a lead from.");
    const existing = (await findDuplicatesInTx(tx, { email: person.email })).find((d) => d.entityType === "lead");
    let leadId = existing?.id;
    if (!leadId) {
      const domain = emailDomain(person.email);
      const company = isBusinessEmail(person.email) && domain ? domain.split(".")[0]!.replace(/^./, (c) => c.toUpperCase()) : undefined;
      const input = parseLeadInput({ ...nameFromAddress(person), email: person.email, company, source: "email", ownerId: ctx.userId });
      leadId = (await createLeadInTx(tx, ctx, input, { origin: "email_capture" })).id;
    }
    const links = await logToTargets(tx, ctx, plan);
    await tx.update(emailMessages).set({ status: links.length ? "matched" : row.status, links }).where(eq(emailMessages.id, id));
    return { leadId };
  });
}

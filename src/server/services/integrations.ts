import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, withScope } from "@/server/db/client";
import { integrationConnections, webhookEvents } from "@/server/db/schema";
import { loadTenantContext, type TenantContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/permissions";
import { writeAudit } from "@/server/lib/audit";
import { decryptSecret, encryptSecret, generateSigningSecret, sha256Hex } from "@/server/lib/crypto";
import { logger } from "@/server/lib/logger";
import { websiteFormConfigSchema, websiteFormsConnector } from "@/server/integrations/website-forms";
import { createLeadInTx, findDuplicatesInTx, parseLeadInput } from "./leads";
import { actor, assertValidOwner, need } from "./_shared";

const RATE_LIMIT_PER_MINUTE = 120;
const MAX_BODY_BYTES = 64 * 1024;

export async function listConnections(ctx: TenantContext) {
  need(ctx, "admin:settings");
  return withScope(ctx, (tx) =>
    tx
      .select({
        id: integrationConnections.id,
        provider: integrationConnections.provider,
        name: integrationConnections.name,
        status: integrationConnections.status,
        config: integrationConnections.config,
        secretHint: integrationConnections.secretHint,
        lastSuccessAt: integrationConnections.lastSuccessAt,
        lastErrorAt: integrationConnections.lastErrorAt,
        lastError: integrationConnections.lastError,
        receivedCount: integrationConnections.receivedCount,
        rejectedCount: integrationConnections.rejectedCount,
        createdAt: integrationConnections.createdAt,
      })
      .from(integrationConnections)
      .orderBy(desc(integrationConnections.createdAt)),
  );
}

export async function recentWebhookEvents(ctx: TenantContext, connectionId: string, limit = 25) {
  need(ctx, "admin:settings");
  return withScope(ctx, (tx) =>
    tx.select().from(webhookEvents).where(eq(webhookEvents.connectionId, connectionId)).orderBy(desc(webhookEvents.receivedAt)).limit(limit),
  );
}

/** Creates a website-form connection. The signing secret is returned once and stored encrypted. */
export async function createFormConnection(ctx: TenantContext, input: { name: string; defaultSource?: string; defaultOwnerId?: string | null }) {
  need(ctx, "admin:settings");
  need(ctx, "lead:write");
  const name = input.name.trim();
  if (!name || name.length > 100) throw new ValidationError("Enter a name for this form (max 100 characters).");
  const config = websiteFormConfigSchema.parse({ defaultSource: input.defaultSource || "website", defaultOwnerId: input.defaultOwnerId || null });
  const secret = generateSigningSecret();
  return withScope(ctx, async (tx) => {
    await assertValidOwner(tx, ctx, config.defaultOwnerId);
    const [c] = await tx
      .insert(integrationConnections)
      .values({
        tenantId: ctx.tenantId,
        provider: "website_forms",
        name,
        status: "configured",
        config,
        encryptedSecret: encryptSecret(secret),
        secretHint: `…${secret.slice(-4)}`,
        createdById: ctx.userId,
      })
      .returning({ id: integrationConnections.id });
    if (!c) throw new Error("Failed to create connection");
    await writeAudit(tx, actor(ctx), { action: "integration.created", entityType: "integration", entityId: c.id, changes: { provider: "website_forms", name } });
    return { id: c.id, secret };
  });
}

export async function rotateConnectionSecret(ctx: TenantContext, id: string): Promise<string> {
  need(ctx, "admin:settings");
  const secret = generateSigningSecret();
  await withScope(ctx, async (tx) => {
    const r = await tx
      .update(integrationConnections)
      .set({ encryptedSecret: encryptSecret(secret), secretHint: `…${secret.slice(-4)}` })
      .where(eq(integrationConnections.id, id))
      .returning({ id: integrationConnections.id });
    if (!r.length) throw new NotFoundError("Connection not found.");
    await writeAudit(tx, actor(ctx), { action: "integration.secret_rotated", entityType: "integration", entityId: id });
  });
  return secret;
}

export async function setConnectionEnabled(ctx: TenantContext, id: string, enabled: boolean): Promise<void> {
  need(ctx, "admin:settings");
  await withScope(ctx, async (tx) => {
    const r = await tx
      .update(integrationConnections)
      .set({ status: enabled ? "configured" : "disabled" })
      .where(eq(integrationConnections.id, id))
      .returning({ id: integrationConnections.id });
    if (!r.length) throw new NotFoundError("Connection not found.");
    await writeAudit(tx, actor(ctx), { action: enabled ? "integration.enabled" : "integration.disabled", entityType: "integration", entityId: id });
  });
}

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Handles a signed inbound form submission. Order of checks: size → tenant
 * resolution → signature/replay → rate limit → idempotency → payload → lead.
 * Never reveals whether a connection exists to unauthenticated callers.
 */
export async function handleInboundForm(connectionId: string, rawBody: string, headers: Headers): Promise<InboundResult> {
  const unauthorized: InboundResult = { status: 401, body: { error: "invalid_signature" } };
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) return { status: 413, body: { error: "payload_too_large" } };
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return unauthorized;
  const rows = await db().execute<{ tenant_id: string | null }>(sql`select resolve_inbound_connection(${connectionId}::uuid, 'website_forms') as tenant_id`);
  const tenantId = rows[0]?.tenant_id ?? null;
  if (!tenantId) return unauthorized;

  return withScope({ tenantId, userId: null }, async (tx) => {
    const [conn] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
    if (!conn?.encryptedSecret) return unauthorized;
    const secret = decryptSecret(conn.encryptedSecret);
    const verified = websiteFormsConnector.verifyInbound!(rawBody, headers, secret);
    const reject = async (status: number, error: string, externalId?: string) => {
      await tx
        .update(integrationConnections)
        .set({ rejectedCount: sql`${integrationConnections.rejectedCount} + 1`, lastErrorAt: new Date(), lastError: error.slice(0, 300) })
        .where(eq(integrationConnections.id, connectionId));
      if (externalId)
        await tx.insert(webhookEvents).values({ tenantId, connectionId, externalId, status: "rejected", error: error.slice(0, 300) }).onConflictDoNothing();
      return { status, body: { error } };
    };
    if (!verified.ok) {
      logger.warn("webhook.rejected", { connectionId, reason: verified.reason });
      return reject(401, "invalid_signature");
    }
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.connectionId, connectionId), gt(webhookEvents.receivedAt, sql`now() - interval '1 minute'`)));
    if ((recent?.n ?? 0) >= RATE_LIMIT_PER_MINUTE) return { status: 429, body: { error: "rate_limited" } };

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return reject(400, "invalid_json");
    }
    const config = websiteFormsConnector.parseConfig(conn.config);
    const mapped = websiteFormsConnector.mapInbound!(payload, config);
    const externalId = (mapped.ok && mapped.externalId) || headers.get("x-exato-event-id") || sha256Hex(rawBody);
    const [dupe] = await tx
      .select({ status: webhookEvents.status, recordId: webhookEvents.recordId })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.connectionId, connectionId), eq(webhookEvents.externalId, externalId)));
    if (dupe) return { status: 200, body: { status: "duplicate", leadId: dupe.recordId } };
    if (!mapped.ok) return reject(422, mapped.reason, externalId);

    // Leads are created as the connection's creator, re-checking their current permissions.
    const ctx = conn.createdById ? await loadTenantContext(conn.createdById, tenantId) : null;
    if (!ctx || !ctx.permissions.has("lead:write")) {
      await tx.update(integrationConnections).set({ status: "degraded" }).where(eq(integrationConnections.id, connectionId));
      return reject(409, "connection_owner_lacks_permission", externalId);
    }
    let input;
    try {
      input = parseLeadInput({ ...mapped.value, ownerId: config.defaultOwnerId ?? undefined, consentEmail: mapped.value.consentEmail ? "true" : "false" });
    } catch (err) {
      const msg = err instanceof ValidationError ? Object.entries(err.fieldErrors).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ") : "invalid";
      return reject(422, `validation_failed: ${msg}`, externalId);
    }
    // Avoid creating a second open lead for a known email; record the touch instead.
    const dupes = input.email ? await findDuplicatesInTx(tx, { email: input.email }) : [];
    const existingLead = dupes.find((d) => d.entityType === "lead");
    let leadId: string;
    let outcome: "created" | "matched_existing";
    if (existingLead) {
      leadId = existingLead.id;
      outcome = "matched_existing";
    } else {
      const lead = await createLeadInTx(tx, ctx, input, { origin: `webhook:${connectionId}` });
      leadId = lead.id;
      outcome = "created";
    }
    await tx.insert(webhookEvents).values({ tenantId, connectionId, externalId, status: outcome, recordId: leadId });
    await tx
      .update(integrationConnections)
      .set({
        receivedCount: sql`${integrationConnections.receivedCount} + 1`,
        lastSuccessAt: new Date(),
        // First verified delivery proves the integration works end to end.
        status: conn.status === "configured" || conn.status === "degraded" ? "healthy" : conn.status,
      })
      .where(eq(integrationConnections.id, connectionId));
    return { status: outcome === "created" ? 201 : 200, body: { status: outcome, leadId } };
  });
}

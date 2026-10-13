import "server-only";
import type { Tx } from "@/server/db/client";
import { auditLogs, outboxEvents } from "@/server/db/schema";

export interface Actor {
  tenantId: string;
  userId: string | null;
  requestId?: string | null;
}

const REDACTED_KEYS = new Set(["passwordHash", "password", "token", "secret", "accessToken", "refreshToken"]);

/** Field-level diff of changed values, with sensitive keys redacted. */
export function diffRecords(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (key === "updatedAt" || key === "createdAt") continue;
    const a = normalise(before[key]);
    const b = normalise(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes[key] = REDACTED_KEYS.has(key) ? { from: "[redacted]", to: "[redacted]" } : { from: a, to: b };
    }
  }
  return changes;
}

function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  return v;
}

export async function writeAudit(
  tx: Tx,
  actor: Actor,
  entry: { action: string; entityType: string; entityId: string | null; changes?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: actor.tenantId,
    actorUserId: actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: entry.changes ?? {},
    requestId: actor.requestId ?? null,
  });
}

export type DomainEventType =
  | "lead.created"
  | "lead.updated"
  | "lead.qualified"
  | "lead.converted"
  | "account.created"
  | "contact.created"
  | "opportunity.created"
  | "opportunity.stage_changed"
  | "opportunity.won"
  | "opportunity.lost"
  | "import.completed";

/** Writes a domain event to the transactional outbox in the caller's transaction. */
export async function emitEvent(
  tx: Tx,
  actor: Actor,
  event: { type: DomainEventType; entityType: string; entityId: string; payload?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(outboxEvents).values({
    tenantId: actor.tenantId,
    type: event.type,
    entityType: event.entityType,
    entityId: event.entityId,
    payload: event.payload ?? {},
    actorUserId: actor.userId,
  });
}

import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, withScope } from "@/server/db/client";
import { loginAttempts, sessions } from "@/server/db/schema";

export const SESSION_COOKIE = "exato_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 15 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  tenantId: string | null,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await withScope({ tenantId: null, userId }, (tx) =>
    tx.insert(sessions).values({
      id: hashToken(token),
      userId,
      tenantId,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    }),
  );
  return { token, expiresAt };
}

export interface ValidSession {
  id: string;
  userId: string;
  tenantId: string | null;
  expiresAt: Date;
  /** Set when the expiry was extended and the cookie should be re-issued. */
  refreshed: boolean;
}

export async function validateSessionToken(token: string): Promise<ValidSession | null> {
  const id = hashToken(token);
  const [row] = await db()
    .select({ id: sessions.id, userId: sessions.userId, tenantId: sessions.tenantId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    await db().delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let refreshed = false;
  let expiresAt = row.expiresAt;
  if (row.expiresAt.getTime() - now < SESSION_REFRESH_MS) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    await db().update(sessions).set({ expiresAt, lastSeenAt: new Date() }).where(eq(sessions.id, id));
    refreshed = true;
  }
  return { id: row.id, userId: row.userId, tenantId: row.tenantId, expiresAt, refreshed };
}

export async function setSessionTenant(sessionId: string, tenantId: string): Promise<void> {
  await db().update(sessions).set({ tenantId }).where(eq(sessions.id, sessionId));
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const rows = await db()
    .delete(sessions)
    .where(
      exceptSessionId
        ? and(eq(sessions.userId, userId), sql`${sessions.id} <> ${exceptSessionId}`)
        : eq(sessions.userId, userId),
    )
    .returning({ id: sessions.id });
  return rows.length;
}

export async function listUserSessions(userId: string) {
  return db()
    .select({
      id: sessions.id,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
    .orderBy(sql`${sessions.lastSeenAt} desc`);
}

// ─── Login throttling ───────────────────────────────────────────────────────

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

export async function isLoginThrottled(keys: string[]): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  for (const key of keys) {
    const [row] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.key, key), eq(loginAttempts.succeeded, false), gt(loginAttempts.createdAt, since)));
    if ((row?.n ?? 0) >= MAX_FAILURES) return true;
  }
  return false;
}

export async function recordLoginAttempt(keys: string[], succeeded: boolean): Promise<void> {
  if (keys.length === 0) return;
  await db()
    .insert(loginAttempts)
    .values(keys.map((key) => ({ key, succeeded })));
}

/** Housekeeping, run from the scheduled maintenance job. */
export async function purgeExpiredAuthRecords(): Promise<void> {
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await db()
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
}

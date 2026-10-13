import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "@/server/db/client";
import { tenantMemberships } from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { ForbiddenError, requirePermission, type Permission } from "@/server/auth/permissions";
import type { Actor } from "@/server/lib/audit";

export function actor(ctx: TenantContext): Actor {
  return { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId };
}

/** SQL predicate restricting owner-scoped rows to the caller's data scope. */
export function ownerScope(ctx: TenantContext, ownerCol: AnyPgColumn): SQL | undefined {
  if (ctx.dataScope === "all") return undefined;
  if (ctx.dataScope === "team" && ctx.teamId) {
    return sql`(${ownerCol} = ${ctx.userId} or ${ownerCol} in (select ${tenantMemberships.userId} from ${tenantMemberships} where ${tenantMemberships.teamId} = ${ctx.teamId}))`;
  }
  return eq(ownerCol, ctx.userId);
}

/** Throws ForbiddenError unless the caller's data scope covers a record owned by `ownerId`. */
export async function assertOwnerAccess(tx: Tx, ctx: TenantContext, ownerId: string | null): Promise<void> {
  if (ctx.dataScope === "all") return;
  if (ownerId === ctx.userId) return;
  if (ctx.dataScope === "team" && ctx.teamId && ownerId) {
    const [m] = await tx
      .select({ teamId: tenantMemberships.teamId })
      .from(tenantMemberships)
      .where(and(eq(tenantMemberships.userId, ownerId), eq(tenantMemberships.tenantId, ctx.tenantId)))
      .limit(1);
    if (m?.teamId === ctx.teamId) return;
  }
  throw new ForbiddenError("This record is outside your data access scope.");
}

/** Validates that `ownerId` is an active member of the tenant. */
export async function assertValidOwner(tx: Tx, ctx: TenantContext, ownerId: string | null): Promise<void> {
  if (!ownerId) return;
  const [m] = await tx
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, ownerId),
        eq(tenantMemberships.tenantId, ctx.tenantId),
        eq(tenantMemberships.status, "active"),
      ),
    )
    .limit(1);
  if (!m) throw new ForbiddenError("The selected owner is not an active member of this workspace.");
}

export function need(ctx: TenantContext, permission: Permission): void {
  requirePermission(ctx, permission);
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageArgs(page?: number, pageSize?: number): { page: number; pageSize: number; offset: number } {
  const p = Math.max(1, Math.floor(page ?? 1));
  const s = Math.min(200, Math.max(10, Math.floor(pageSize ?? 50)));
  return { page: p, pageSize: s, offset: (p - 1) * s };
}

/** Escapes LIKE wildcards in user input. */
export function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

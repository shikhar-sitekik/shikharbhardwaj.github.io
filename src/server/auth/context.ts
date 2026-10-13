import "server-only";
import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { withScope } from "@/server/db/client";
import { roles, tenantMemberships, tenants, users } from "@/server/db/schema";
import { parseTenantSettings, type TenantSettings } from "@/server/tenant-settings";
import { isPermission, type AccessSubject, type DataScope, type Permission } from "./permissions";
import { SESSION_COOKIE, validateSessionToken } from "./session";

/** Everything a service needs to authorise and scope a request. */
export interface TenantContext extends AccessSubject {
  tenantId: string;
  userId: string;
  sessionId: string | null;
  roleKey: string;
  roleName: string;
  user: { name: string; email: string };
  tenant: { name: string; slug: string; settings: TenantSettings };
  requestId: string | null;
}

export async function loadTenantContext(
  userId: string,
  tenantId: string,
  sessionId: string | null = null,
  requestId: string | null = null,
): Promise<TenantContext | null> {
  return withScope({ tenantId, userId }, async (tx) => {
    const [row] = await tx
      .select({
        userName: users.name,
        userEmail: users.email,
        disabledAt: users.disabledAt,
        teamId: tenantMemberships.teamId,
        status: tenantMemberships.status,
        roleKey: roles.key,
        roleName: roles.name,
        permissions: roles.permissions,
        dataScope: roles.dataScope,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        settings: tenants.settings,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)))
      .limit(1);
    if (!row || row.status !== "active" || row.disabledAt) return null;
    const permissions = new Set<Permission>(row.permissions.filter(isPermission));
    return {
      tenantId,
      userId,
      sessionId,
      requestId,
      teamId: row.teamId,
      roleKey: row.roleKey,
      roleName: row.roleName,
      permissions,
      dataScope: row.dataScope as DataScope,
      user: { name: row.userName, email: row.userEmail },
      tenant: { name: row.tenantName, slug: row.tenantSlug, settings: parseTenantSettings(row.settings) },
    };
  });
}

export interface AuthState {
  sessionId: string;
  userId: string;
  tenantId: string | null;
}

/** Validates the session cookie. Deduplicated per request. */
export const getAuthState = cache(async (): Promise<AuthState | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await validateSessionToken(token);
  if (!session) return null;
  return { sessionId: session.id, userId: session.userId, tenantId: session.tenantId };
});

/** Resolves the active tenant context, or null when unauthenticated. */
export const getContext = cache(async (): Promise<TenantContext | null> => {
  const auth = await getAuthState();
  if (!auth || !auth.tenantId) return null;
  const requestId = (await headers()).get("x-request-id");
  return loadTenantContext(auth.userId, auth.tenantId, auth.sessionId, requestId);
});

/** For pages and server actions: redirects to login if there is no valid context. */
export async function requireContext(): Promise<TenantContext> {
  const ctx = await getContext();
  if (!ctx) {
    const auth = await getAuthState();
    redirect(auth ? "/select-workspace" : "/login");
  }
  return ctx;
}

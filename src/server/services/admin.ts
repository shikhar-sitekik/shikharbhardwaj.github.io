import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withScope } from "@/server/db/client";
import { auditLogs, roles, teams, tenantMemberships, tenants, users } from "@/server/db/schema";
import type { TenantContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError, PERMISSIONS, ValidationError, isPermission } from "@/server/auth/permissions";
import { hashPassword, passwordPolicyError } from "@/server/auth/password";
import { invalidateAllUserSessions } from "@/server/auth/session";
import { writeAudit } from "@/server/lib/audit";
import { normalizeEmail } from "@/server/domain/normalize";
import { tenantSettingsSchema, type TenantSettings } from "@/server/tenant-settings";
import { actor, need, pageArgs } from "./_shared";

export async function listMembers(ctx: TenantContext) {
  need(ctx, "admin:users");
  return withScope(ctx, (tx) =>
    tx
      .select({
        membershipId: tenantMemberships.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        status: tenantMemberships.status,
        roleId: roles.id,
        roleName: roles.name,
        teamId: teams.id,
        teamName: teams.name,
        createdAt: tenantMemberships.createdAt,
        disabledAt: users.disabledAt,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .leftJoin(teams, eq(teams.id, tenantMemberships.teamId))
      .orderBy(asc(users.name)),
  );
}

const addMemberSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(254),
  roleId: z.string().uuid(),
  teamId: z.preprocess((v) => (v === "" ? null : v ?? null), z.string().uuid().nullable()),
  /** Initial password, communicated out-of-band until an email provider is configured. */
  password: z.string().max(256),
});

/**
 * Adds a user to the workspace. Existing global users are attached; new users
 * are created with an administrator-set initial password (email invitations
 * require an email provider, see INTEGRATIONS.md).
 */
export async function addMember(ctx: TenantContext, raw: unknown) {
  need(ctx, "admin:users");
  const parsed = addMemberSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Please complete all required fields.");
  const input = parsed.data;
  const email = normalizeEmail(input.email);
  if (!email) throw new ValidationError("Enter a valid email address.", { email: ["Invalid email."] });
  return withScope(ctx, async (tx) => {
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, input.roleId));
    if (!role) throw new ValidationError("Unknown role.");
    if (input.teamId) {
      const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, input.teamId));
      if (!team) throw new ValidationError("Unknown team.");
    }
    let [user] = await tx.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (!user) {
      const policy = passwordPolicyError(input.password);
      if (policy) throw new ValidationError(policy, { password: [policy] });
      [user] = await tx
        .insert(users)
        .values({ email, name: input.name, passwordHash: await hashPassword(input.password) })
        .returning();
    }
    if (!user) throw new Error("Failed to create user");
    const [existing] = await tx.select({ id: tenantMemberships.id }).from(tenantMemberships).where(eq(tenantMemberships.userId, user.id));
    if (existing) throw new ValidationError("This user is already a member of the workspace.");
    await tx.insert(tenantMemberships).values({ tenantId: ctx.tenantId, userId: user.id, roleId: role.id, teamId: input.teamId });
    await writeAudit(tx, actor(ctx), { action: "member.added", entityType: "user", entityId: user.id, changes: { roleId: role.id, teamId: input.teamId } });
    return { userId: user.id };
  });
}

export async function updateMember(
  ctx: TenantContext,
  membershipId: string,
  patch: { roleId?: string; teamId?: string | null; status?: "active" | "suspended" },
) {
  need(ctx, "admin:users");
  return withScope(ctx, async (tx) => {
    const [m] = await tx.select().from(tenantMemberships).where(eq(tenantMemberships.id, membershipId));
    if (!m) throw new NotFoundError("Member not found.");
    if (m.userId === ctx.userId && (patch.status === "suspended" || (patch.roleId && patch.roleId !== m.roleId)))
      throw new ForbiddenError("You cannot change your own role or suspend yourself.");
    if (patch.roleId) {
      const [r] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, patch.roleId));
      if (!r) throw new ValidationError("Unknown role.");
    }
    if (patch.teamId) {
      const [t] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, patch.teamId));
      if (!t) throw new ValidationError("Unknown team.");
    }
    // Never leave the workspace without an active administrator.
    if (patch.roleId || patch.status === "suspended") {
      const [admins] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(tenantMemberships)
        .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
        .where(and(eq(roles.key, "tenant_admin"), eq(tenantMemberships.status, "active"), sql`${tenantMemberships.id} <> ${membershipId}`));
      const [current] = await tx.select({ key: roles.key }).from(roles).where(eq(roles.id, m.roleId));
      if (current?.key === "tenant_admin" && (admins?.n ?? 0) === 0)
        throw new ValidationError("The workspace must keep at least one active administrator.");
    }
    await tx
      .update(tenantMemberships)
      .set({
        ...(patch.roleId ? { roleId: patch.roleId } : {}),
        ...(patch.teamId !== undefined ? { teamId: patch.teamId } : {}),
        ...(patch.status ? { status: patch.status } : {}),
      })
      .where(eq(tenantMemberships.id, membershipId));
    await writeAudit(tx, actor(ctx), { action: "member.updated", entityType: "user", entityId: m.userId, changes: patch });
    if (patch.status === "suspended") await invalidateAllUserSessions(m.userId);
  });
}

export async function listTeams(ctx: TenantContext) {
  return withScope(ctx, (tx) => tx.select().from(teams).orderBy(asc(teams.name)));
}

export async function createTeam(ctx: TenantContext, name: string) {
  need(ctx, "admin:users");
  const clean = name.trim();
  if (!clean || clean.length > 100) throw new ValidationError("Enter a team name (max 100 characters).");
  return withScope(ctx, async (tx) => {
    const [t] = await tx.insert(teams).values({ tenantId: ctx.tenantId, name: clean }).onConflictDoNothing().returning();
    if (!t) throw new ValidationError("A team with this name already exists.");
    await writeAudit(tx, actor(ctx), { action: "team.created", entityType: "team", entityId: t.id, changes: { name: clean } });
    return t;
  });
}

export async function listRoles(ctx: TenantContext) {
  return withScope(ctx, (tx) => tx.select().from(roles).orderBy(desc(roles.isSystem), asc(roles.name)));
}

const roleUpdateSchema = z.object({
  permissions: z.array(z.string()).max(PERMISSIONS.length),
  dataScope: z.enum(["own", "team", "all"]),
});

export async function updateRole(ctx: TenantContext, roleId: string, raw: unknown) {
  need(ctx, "admin:roles");
  const parsed = roleUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid role configuration.");
  const permissions = [...new Set(parsed.data.permissions.filter(isPermission))];
  return withScope(ctx, async (tx) => {
    const [before] = await tx.select().from(roles).where(eq(roles.id, roleId));
    if (!before) throw new NotFoundError("Role not found.");
    if (before.key === "tenant_admin") throw new ValidationError("The Tenant Administrator role cannot be edited.");
    await tx.update(roles).set({ permissions, dataScope: parsed.data.dataScope }).where(eq(roles.id, roleId));
    await writeAudit(tx, actor(ctx), {
      action: "role.updated",
      entityType: "role",
      entityId: roleId,
      changes: { permissions: { from: before.permissions, to: permissions }, dataScope: { from: before.dataScope, to: parsed.data.dataScope } },
    });
  });
}

export async function updateTenantSettings(ctx: TenantContext, patch: Partial<TenantSettings>) {
  need(ctx, "admin:settings");
  const next = tenantSettingsSchema.safeParse({ ...ctx.tenant.settings, ...patch });
  if (!next.success) throw new ValidationError("Invalid settings: " + next.error.issues.map((i) => i.path.join(".")).join(", "));
  await withScope(ctx, async (tx) => {
    // Round-robin pool must reference active members only.
    if (next.data.assignment.userIds.length) {
      const members = await tx.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(eq(tenantMemberships.status, "active"));
      const valid = new Set(members.map((m) => m.userId));
      if (next.data.assignment.userIds.some((u) => !valid.has(u))) throw new ValidationError("Assignment pool contains a non-member.");
    }
    await tx.update(tenants).set({ settings: next.data }).where(eq(tenants.id, ctx.tenantId));
    await writeAudit(tx, actor(ctx), { action: "settings.updated", entityType: "tenant", entityId: ctx.tenantId, changes: { keys: Object.keys(patch) } });
  });
}

export async function queryAudit(
  ctx: TenantContext,
  f: { entityType?: string; entityId?: string; actorId?: string; action?: string; page?: number },
) {
  need(ctx, "audit:read");
  const { page, pageSize, offset } = pageArgs(f.page, 50);
  const conds: SQL[] = [];
  if (f.entityType) conds.push(eq(auditLogs.entityType, f.entityType));
  if (f.entityId) conds.push(eq(auditLogs.entityId, f.entityId));
  if (f.actorId) conds.push(eq(auditLogs.actorUserId, f.actorId));
  if (f.action) conds.push(sql`${auditLogs.action} like ${f.action.replace(/[%_\\]/g, "") + "%"}`);
  const where = conds.length ? and(...conds) : undefined;
  return withScope(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        changes: auditLogs.changes,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
        requestId: auditLogs.requestId,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where);
    return { rows, total: c?.n ?? 0, page, pageSize };
  });
}

/** Record-level history for detail pages; requires read access to the entity type. */
export async function recordHistory(ctx: TenantContext, entityType: "lead" | "account" | "contact" | "opportunity", entityId: string) {
  need(ctx, `${entityType}:read`);
  return withScope(ctx, (tx) =>
    tx
      .select({ id: auditLogs.id, action: auditLogs.action, changes: auditLogs.changes, createdAt: auditLogs.createdAt, actorName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(100),
  );
}

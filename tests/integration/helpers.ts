import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { loadTenantContext, type TenantContext } from "@/server/auth/context";
import { createUser, provisionTenant } from "@/server/services/provisioning";
import { addMember, listRoles, createTeam } from "@/server/services/admin";

let migrated = false;

/** Drops and re-migrates the test database once per test run (per file). */
export async function resetDatabase(): Promise<void> {
  if (migrated) return;
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url || !url.includes("exato_test")) throw new Error("Refusing to reset a non-test database");
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end();
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env: process.env, stdio: "pipe" });
  migrated = true;
}

// Pre-hashed "integration-test-password" to avoid scrypt cost per user.
let cachedHash: string | null = null;
async function testHash(): Promise<string> {
  if (!cachedHash) {
    const { hashPassword } = await import("@/server/auth/password");
    cachedHash = await hashPassword("integration-test-password");
  }
  return cachedHash;
}

let seq = 0;
export async function makeTenant(name = "Acme Test"): Promise<{ admin: TenantContext; tenantId: string }> {
  seq += 1;
  const user = await createUser({ email: `admin${seq}-${Date.now()}@example.com`, name: `Admin ${seq}`, passwordHash: await testHash() });
  const { tenantId } = await provisionTenant({ workspaceName: `${name} ${seq}`, owner: { userId: user.id } });
  const admin = await loadTenantContext(user.id, tenantId);
  if (!admin) throw new Error("no admin context");
  return { admin, tenantId };
}

export async function makeMember(
  admin: TenantContext,
  roleKey: string,
  opts: { teamName?: string } = {},
): Promise<TenantContext> {
  seq += 1;
  const roles = await listRoles(admin);
  const role = roles.find((r) => r.key === roleKey);
  if (!role) throw new Error(`role ${roleKey} missing`);
  let teamId: string | null = null;
  if (opts.teamName) {
    const { listTeams } = await import("@/server/services/admin");
    const existing = (await listTeams(admin)).find((t) => t.name === opts.teamName);
    teamId = existing?.id ?? (await createTeam(admin, opts.teamName)).id;
  }
  const { userId } = await addMember(admin, {
    name: `${roleKey} ${seq}`,
    email: `${roleKey}${seq}-${Date.now()}@example.com`,
    roleId: role.id,
    teamId,
    password: "integration-test-password",
  });
  const ctx = await loadTenantContext(userId, admin.tenantId);
  if (!ctx) throw new Error("no member context");
  return ctx;
}

/** Reloads context after settings changes. */
export async function refresh(ctx: TenantContext): Promise<TenantContext> {
  const next = await loadTenantContext(ctx.userId, ctx.tenantId);
  if (!next) throw new Error("context lost");
  return next;
}

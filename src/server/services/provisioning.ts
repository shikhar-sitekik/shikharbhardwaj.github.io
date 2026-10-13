import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import { withScope } from "@/server/db/client";
import {
  leadStatuses,
  pipelineStages,
  pipelines,
  roles,
  tenantMemberships,
  tenants,
  users,
} from "@/server/db/schema";
import { ROLE_TEMPLATES } from "@/server/auth/permissions";
import { DEFAULT_SCORING_RULES, tenantSettingsSchema } from "@/server/tenant-settings";
import { writeAudit } from "@/server/lib/audit";

export const DEFAULT_LEAD_STATUSES = [
  { key: "new", label: "New", category: "open", isDefault: true },
  { key: "working", label: "Working", category: "open", isDefault: false },
  { key: "nurturing", label: "Nurturing", category: "open", isDefault: false },
  { key: "qualified", label: "Qualified", category: "qualified", isDefault: false },
  { key: "disqualified", label: "Disqualified", category: "disqualified", isDefault: false },
  { key: "converted", label: "Converted", category: "converted", isDefault: false },
] as const;

type StageSeed = { name: string; probability: number; category: "open" | "won" | "lost"; requiredFields?: string[] };

export const DEFAULT_PIPELINES: { name: string; description: string; isDefault: boolean; stages: StageSeed[] }[] = [
  {
    name: "Enterprise Solutions",
    description: "Complex, multi-stakeholder solution sales.",
    isDefault: true,
    stages: [
      { name: "New Opportunity", probability: 5, category: "open" },
      { name: "Discovery", probability: 10, category: "open" },
      { name: "Qualified", probability: 20, category: "open", requiredFields: ["primaryContactId"] },
      { name: "Solution Design", probability: 30, category: "open" },
      { name: "Demonstration / Workshop", probability: 40, category: "open" },
      { name: "Proof of Concept", probability: 50, category: "open" },
      { name: "Commercial Proposal", probability: 60, category: "open", requiredFields: ["amount", "expectedCloseDate"] },
      { name: "Negotiation", probability: 75, category: "open", requiredFields: ["amount", "expectedCloseDate"] },
      { name: "Procurement / Legal", probability: 90, category: "open", requiredFields: ["amount", "expectedCloseDate"] },
      { name: "Closed Won", probability: 100, category: "won", requiredFields: ["amount"] },
      { name: "Closed Lost", probability: 0, category: "lost", requiredFields: ["lossReason"] },
    ],
  },
  {
    name: "Managed Services",
    description: "Recurring managed-service agreements.",
    isDefault: false,
    stages: [
      { name: "Qualification", probability: 10, category: "open" },
      { name: "Service Scoping", probability: 30, category: "open" },
      { name: "Proposal", probability: 60, category: "open", requiredFields: ["amount"] },
      { name: "Contracting", probability: 85, category: "open", requiredFields: ["amount", "contractMonths"] },
      { name: "Closed Won", probability: 100, category: "won", requiredFields: ["amount"] },
      { name: "Closed Lost", probability: 0, category: "lost", requiredFields: ["lossReason"] },
    ],
  },
  {
    name: "Renewals",
    description: "Contract renewals and extensions.",
    isDefault: false,
    stages: [
      { name: "Upcoming", probability: 50, category: "open" },
      { name: "In Review", probability: 70, category: "open" },
      { name: "Renewal Proposed", probability: 85, category: "open", requiredFields: ["amount"] },
      { name: "Renewed", probability: 100, category: "won", requiredFields: ["amount"] },
      { name: "Churned", probability: 0, category: "lost", requiredFields: ["lossReason"] },
    ],
  },
];

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "workspace"
  );
}

async function seedTenantConfiguration(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();
  for (const t of ROLE_TEMPLATES) {
    const [r] = await tx
      .insert(roles)
      .values({
        tenantId,
        key: t.key,
        name: t.name,
        description: t.description,
        permissions: t.permissions,
        dataScope: t.dataScope,
        isSystem: true,
      })
      .returning({ id: roles.id });
    if (r) roleIds.set(t.key, r.id);
  }
  await tx.insert(leadStatuses).values(
    DEFAULT_LEAD_STATUSES.map((s, i) => ({ tenantId, ...s, position: i })),
  );
  for (const [pi, p] of DEFAULT_PIPELINES.entries()) {
    const [pipeline] = await tx
      .insert(pipelines)
      .values({ tenantId, name: p.name, description: p.description, isDefault: p.isDefault, position: pi })
      .returning({ id: pipelines.id });
    if (!pipeline) throw new Error("Failed to create pipeline");
    await tx.insert(pipelineStages).values(
      p.stages.map((s, i) => ({
        tenantId,
        pipelineId: pipeline.id,
        name: s.name,
        position: i,
        probability: s.probability,
        category: s.category,
        requiredFields: s.requiredFields ?? [],
      })),
    );
  }
  return roleIds;
}

export interface ProvisionInput {
  workspaceName: string;
  baseCurrency?: string;
  timezone?: string;
  owner: { userId: string };
}

/** Creates a tenant with default roles, statuses and pipelines; makes `owner` its administrator. */
export async function provisionTenant(input: ProvisionInput): Promise<{ tenantId: string; slug: string }> {
  const tenantId = randomUUID();
  const settings = tenantSettingsSchema.parse({
    baseCurrency: input.baseCurrency ?? "USD",
    timezone: input.timezone ?? "UTC",
    scoringRules: DEFAULT_SCORING_RULES,
  });
  return withScope({ tenantId, userId: input.owner.userId }, async (tx) => {
    const base = slugify(input.workspaceName);
    // Slug uniqueness is global; the tenants table is RLS-protected so we cannot
    // probe other tenants' slugs. A random suffix avoids collisions instead.
    const slug = `${base}-${tenantId.slice(0, 6)}`;
    await tx.insert(tenants).values({ id: tenantId, name: input.workspaceName.trim(), slug, settings });
    const roleIds = await seedTenantConfiguration(tx, tenantId);
    const adminRoleId = roleIds.get("tenant_admin");
    if (!adminRoleId) throw new Error("Admin role missing");
    await tx.insert(tenantMemberships).values({ tenantId, userId: input.owner.userId, roleId: adminRoleId });
    await writeAudit(tx, { tenantId, userId: input.owner.userId }, {
      action: "tenant.created",
      entityType: "tenant",
      entityId: tenantId,
      changes: { name: input.workspaceName },
    });
    return { tenantId, slug };
  });
}

/** Finds a user by email (case-insensitive). Users are global identities. */
export async function findUserByEmail(email: string) {
  return withScope({ tenantId: null, userId: null }, async (tx) => {
    const [u] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
      .limit(1);
    return u ?? null;
  });
}

export async function createUser(input: { email: string; name: string; passwordHash: string | null }) {
  return withScope({ tenantId: null, userId: null }, async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email: input.email.trim().toLowerCase(), name: input.name.trim(), passwordHash: input.passwordHash })
      .returning();
    if (!u) throw new Error("Failed to create user");
    return u;
  });
}

/** Active workspaces a user belongs to (uses the own_memberships RLS policy). */
export async function listUserWorkspaces(userId: string) {
  return withScope({ tenantId: null, userId }, (tx) =>
    tx
      .select({ tenantId: tenants.id, name: tenants.name, slug: tenants.slug })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, "active")))
      .orderBy(tenants.name),
  );
}

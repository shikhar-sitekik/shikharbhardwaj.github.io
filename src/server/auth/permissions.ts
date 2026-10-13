/**
 * RBAC model. Pure module (no I/O) so it can be unit-tested and shared.
 *
 * Authorisation = permission (what action on which entity type)
 *               + data scope (which records: own / team / all).
 */

export const PERMISSIONS = [
  "lead:read",
  "lead:write",
  "lead:delete",
  "lead:assign",
  "lead:convert",
  "account:read",
  "account:write",
  "account:delete",
  "contact:read",
  "contact:write",
  "contact:delete",
  "opportunity:read",
  "opportunity:write",
  "opportunity:delete",
  "activity:read",
  "activity:write",
  "report:read",
  "import:run",
  "export:run",
  "pipeline:manage",
  "admin:users",
  "admin:roles",
  "admin:settings",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type DataScope = "own" | "team" | "all";

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

const CRM_READ: Permission[] = [
  "lead:read",
  "account:read",
  "contact:read",
  "opportunity:read",
  "activity:read",
];
const CRM_WRITE: Permission[] = [
  ...CRM_READ,
  "lead:write",
  "lead:convert",
  "account:write",
  "contact:write",
  "opportunity:write",
  "activity:write",
];

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
  dataScope: DataScope;
}

/** Default roles seeded into every new tenant. Tenants can edit or add roles. */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "tenant_admin",
    name: "Tenant Administrator",
    description: "Full access to data, configuration, users and audit logs.",
    permissions: [...PERMISSIONS],
    dataScope: "all",
  },
  {
    key: "executive",
    name: "Executive",
    description: "Read access to all commercial data and reports.",
    permissions: [...CRM_READ, "report:read", "export:run"],
    dataScope: "all",
  },
  {
    key: "sales_manager",
    name: "Sales Manager",
    description: "Manages team pipeline, assignment and imports.",
    permissions: [
      ...CRM_WRITE,
      "lead:assign",
      "lead:delete",
      "opportunity:delete",
      "report:read",
      "import:run",
      "export:run",
    ],
    dataScope: "team",
  },
  {
    key: "sales_rep",
    name: "Sales Representative",
    description: "Works their own and their team's leads and opportunities.",
    permissions: [...CRM_WRITE, "report:read"],
    dataScope: "team",
  },
  {
    key: "marketing_manager",
    name: "Marketing Manager",
    description: "Owns lead intake, imports and routing.",
    permissions: [
      ...CRM_READ,
      "lead:write",
      "lead:assign",
      "contact:write",
      "activity:write",
      "report:read",
      "import:run",
      "export:run",
    ],
    dataScope: "all",
  },
  {
    key: "partnership_manager",
    name: "Partnership Manager",
    description: "Manages partner-sourced leads and co-sell opportunities.",
    permissions: [...CRM_WRITE, "report:read"],
    dataScope: "team",
  },
  {
    key: "presales_engineer",
    name: "Presales Engineer",
    description: "Supports opportunities with solution and technical work.",
    permissions: [...CRM_READ, "opportunity:write", "activity:write"],
    dataScope: "all",
  },
  {
    key: "customer_success",
    name: "Customer Success Manager",
    description: "Manages customer accounts, contacts and renewals.",
    permissions: [...CRM_READ, "account:write", "contact:write", "activity:write", "opportunity:write"],
    dataScope: "team",
  },
  {
    key: "analyst",
    name: "Analyst",
    description: "Read-only data access with reporting and export.",
    permissions: [...CRM_READ, "report:read", "export:run"],
    dataScope: "all",
  },
  {
    key: "read_only",
    name: "Read-Only User",
    description: "Read-only access to commercial records.",
    permissions: [...CRM_READ],
    dataScope: "all",
  },
];

export interface AccessSubject {
  userId: string;
  teamId: string | null;
  permissions: ReadonlySet<Permission>;
  dataScope: DataScope;
}

export function can(subject: AccessSubject, permission: Permission): boolean {
  return subject.permissions.has(permission);
}

/**
 * Whether a subject may act on a record owned by `ownerId`, whose owner belongs
 * to `ownerTeamId`. Callers must check the permission separately.
 */
export function withinScope(
  subject: AccessSubject,
  ownerId: string | null,
  ownerTeamId: string | null,
): boolean {
  switch (subject.dataScope) {
    case "all":
      return true;
    case "team":
      if (ownerId === subject.userId) return true;
      return subject.teamId !== null && ownerTeamId === subject.teamId;
    case "own":
      return ownerId === subject.userId;
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Record not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requirePermission(subject: AccessSubject, permission: Permission): void {
  if (!can(subject, permission)) throw new ForbiddenError();
}

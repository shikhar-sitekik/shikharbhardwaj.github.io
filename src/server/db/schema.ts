import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Exato One relational schema.
 *
 * Conventions
 * - Every tenant-owned table has a NOT NULL `tenant_id` FK and is covered by a
 *   row-level-security policy (see drizzle/0001_rls.sql).
 * - Primary keys are random UUIDs (non-guessable, safe to expose).
 * - Money is stored as numeric(18,2) plus an explicit ISO-4217 currency code.
 * - `archived_at` is a soft delete; hard deletes are reserved for retention jobs.
 * - `custom_fields` holds values validated against custom_field_definitions.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "string" });

export const leadStatusCategory = pgEnum("lead_status_category", [
  "open",
  "qualified",
  "disqualified",
  "converted",
]);
export const stageCategory = pgEnum("stage_category", ["open", "won", "lost"]);
export const forecastCategory = pgEnum("forecast_category", [
  "pipeline",
  "best_case",
  "commit",
  "closed",
  "omitted",
]);
export const activityType = pgEnum("activity_type", ["note", "task", "call", "email", "meeting"]);
export const dataScope = pgEnum("data_scope", ["own", "team", "all"]);
export const membershipStatus = pgEnum("membership_status", ["active", "invited", "suspended"]);
export const revenueType = pgEnum("revenue_type", ["one_time", "recurring"]);
export const importStatus = pgEnum("import_status", [
  "uploaded",
  "mapped",
  "validated",
  "queued",
  "processing",
  "completed",
  "failed",
  "rolled_back",
]);
export const importRowStatus = pgEnum("import_row_status", [
  "pending",
  "valid",
  "invalid",
  "created",
  "updated",
  "skipped",
  "failed",
]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "succeeded", "failed", "dead"]);
export const buyingRole = pgEnum("buying_role", [
  "decision_maker",
  "economic_buyer",
  "champion",
  "influencer",
  "evaluator",
  "procurement",
  "blocker",
  "user",
  "other",
]);

// ─── Identity & tenancy ─────────────────────────────────────────────────────

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Tenant settings: base currency, timezone, date format, scoring config. Validated by zod. */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the opaque session token. The raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    key: text("key").notNull(),
    succeeded: boolean("succeeded").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_key_idx").on(t.key, t.createdAt)],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("teams_tenant_name_uq").on(t.tenantId, t.name)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    /** Which records the role may read/write for owner-scoped entities. */
    dataScope: dataScope("data_scope").notNull().default("own"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roles_tenant_key_uq").on(t.tenantId, t.key)],
);

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    status: membershipStatus("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const territories = pgTable(
  "territories",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    countries: text("countries").array().notNull().default(sql`'{}'::text[]`),
    regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("territories_tenant_name_uq").on(t.tenantId, t.name)],
);

// ─── Leads ──────────────────────────────────────────────────────────────────

export const leadStatuses = pgTable(
  "lead_statuses",
  {
    id: id(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    category: leadStatusCategory("category").notNull(),
    position: integer("position").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
  },
  (t) => [uniqueIndex("lead_statuses_tenant_key_uq").on(t.tenantId, t.key)],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    tenantId: tenantId(),
    firstName: text("first_name"),
    lastName: text("last_name").notNull(),
    email: text("email"),
    personalEmail: text("personal_email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    department: text("department"),
    company: text("company"),
    website: text("website"),
    domain: text("domain"),
    industry: text("industry"),
    subIndustry: text("sub_industry"),
    country: text("country"),
    region: text("region"),
    territoryId: uuid("territory_id").references(() => territories.id, { onDelete: "set null" }),
    employeeRange: text("employee_range"),
    source: text("source"),
    sourceDetail: text("source_detail"),
    campaignId: uuid("campaign_id"),
    productInterest: text("product_interest"),
    businessProblem: text("business_problem"),
    statusId: uuid("status_id")
      .notNull()
      .references(() => leadStatuses.id),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    partnerId: uuid("partner_id"),
    estimatedValue: money("estimated_value"),
    currency: text("currency"),
    score: integer("score").notNull().default(0),
    scoreBreakdown: jsonb("score_breakdown").$type<Record<string, number>>().notNull().default({}),
    consentEmail: boolean("consent_email").notNull().default(false),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    convertedAccountId: uuid("converted_account_id"),
    convertedContactId: uuid("converted_contact_id"),
    convertedOpportunityId: uuid("converted_opportunity_id"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("leads_tenant_status_idx").on(t.tenantId, t.statusId),
    index("leads_tenant_owner_idx").on(t.tenantId, t.ownerId),
    index("leads_tenant_email_idx").on(t.tenantId, sql`lower(${t.email})`),
    index("leads_tenant_domain_idx").on(t.tenantId, t.domain),
    index("leads_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);

// ─── Accounts & contacts ────────────────────────────────────────────────────

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    domain: text("domain"),
    website: text("website"),
    parentAccountId: uuid("parent_account_id"),
    industry: text("industry"),
    country: text("country"),
    region: text("region"),
    headquarters: text("headquarters"),
    employeeRange: text("employee_range"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    tier: text("tier"),
    status: text("status").notNull().default("prospect"),
    isStrategic: boolean("is_strategic").notNull().default(false),
    technologyStack: text("technology_stack").array().notNull().default(sql`'{}'::text[]`),
    businessChallenges: text("business_challenges"),
    description: text("description"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("accounts_tenant_owner_idx").on(t.tenantId, t.ownerId),
    index("accounts_tenant_name_idx").on(t.tenantId, t.name),
    uniqueIndex("accounts_tenant_domain_uq")
      .on(t.tenantId, t.domain)
      .where(sql`${t.domain} is not null and ${t.archivedAt} is null`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    tenantId: tenantId(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    firstName: text("first_name"),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    jobTitle: text("job_title"),
    department: text("department"),
    seniority: text("seniority"),
    buyingRole: buyingRole("buying_role"),
    preferredChannel: text("preferred_channel"),
    country: text("country"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    consentEmail: boolean("consent_email").notNull().default(false),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    linkedinUrl: text("linkedin_url"),
    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    sourceLeadId: uuid("source_lead_id"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("contacts_tenant_account_idx").on(t.tenantId, t.accountId),
    index("contacts_tenant_owner_idx").on(t.tenantId, t.ownerId),
    index("contacts_tenant_email_idx").on(t.tenantId, sql`lower(${t.email})`),
  ],
);

// ─── Pipelines & opportunities ──────────────────────────────────────────────

export const pipelines = pgTable(
  "pipelines",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("pipelines_tenant_name_uq").on(t.tenantId, t.name)],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    tenantId: tenantId(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    probability: integer("probability").notNull(),
    category: stageCategory("category").notNull().default("open"),
    /** Opportunity field keys that must be populated before entering this stage. */
    requiredFields: text("required_fields").array().notNull().default(sql`'{}'::text[]`),
    exitCriteria: text("exit_criteria"),
  },
  (t) => [
    uniqueIndex("stages_pipeline_name_uq").on(t.pipelineId, t.name),
    index("stages_pipeline_pos_idx").on(t.pipelineId, t.position),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    primaryContactId: uuid("primary_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    /** Total deal value in `currency`. For recurring deals this is TCV (see docs/METRICS.md). */
    amount: money("amount").notNull().default("0"),
    currency: text("currency").notNull(),
    /** Null means "use the stage probability". */
    probabilityOverride: integer("probability_override"),
    revenueType: revenueType("revenue_type").notNull().default("one_time"),
    contractMonths: integer("contract_months"),
    expectedCloseDate: date("expected_close_date", { mode: "string" }),
    estimatedStartDate: date("estimated_start_date", { mode: "string" }),
    forecastCategory: forecastCategory("forecast_category").notNull().default("pipeline"),
    source: text("source"),
    campaignId: uuid("campaign_id"),
    partnerId: uuid("partner_id"),
    sourceLeadId: uuid("source_lead_id"),
    nextStep: text("next_step"),
    competitors: text("competitors").array().notNull().default(sql`'{}'::text[]`),
    decisionCriteria: text("decision_criteria"),
    risks: text("risks"),
    technicalRequirements: text("technical_requirements"),
    procurementRequirements: text("procurement_requirements"),
    lossReason: text("loss_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("opps_tenant_stage_idx").on(t.tenantId, t.stageId),
    index("opps_tenant_owner_idx").on(t.tenantId, t.ownerId),
    index("opps_tenant_account_idx").on(t.tenantId, t.accountId),
    index("opps_tenant_close_idx").on(t.tenantId, t.expectedCloseDate),
  ],
);

export const opportunityStageHistory = pgTable(
  "opportunity_stage_history",
  {
    id: id(),
    tenantId: tenantId(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id").references(() => pipelineStages.id, { onDelete: "set null" }),
    toStageId: uuid("to_stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    expectedCloseDate: date("expected_close_date", { mode: "string" }),
    changedById: uuid("changed_by_id").references(() => users.id, { onDelete: "set null" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stage_history_opp_idx").on(t.opportunityId, t.changedAt)],
);

export const opportunityContacts = pgTable(
  "opportunity_contacts",
  {
    tenantId: tenantId(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: buyingRole("role").notNull().default("other"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.contactId] })],
);

// ─── Activities (notes, tasks, calls, emails, meetings) ────────────────────

export const activities = pgTable(
  "activities",
  {
    id: id(),
    tenantId: tenantId(),
    type: activityType("type").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
      onDelete: "cascade",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    outcome: text("outcome"),
    priority: text("priority").notNull().default("normal"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("activities_tenant_owner_due_idx").on(t.tenantId, t.ownerId, t.dueAt),
    index("activities_lead_idx").on(t.leadId),
    index("activities_account_idx").on(t.accountId),
    index("activities_contact_idx").on(t.contactId),
    index("activities_opp_idx").on(t.opportunityId),
  ],
);

// ─── Platform: audit, events, jobs, imports, notifications ─────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    tenantId: tenantId(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull().default({}),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("audit_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

/** Transactional outbox: written in the same transaction as the change it describes. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    tenantId: tenantId(),
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: uuid("actor_user_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [index("outbox_unpublished_idx").on(t.occurredAt).where(sql`${t.publishedAt} is null`)],
);

/** Postgres-backed durable job queue (claimed with FOR UPDATE SKIP LOCKED). */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAt),
    uniqueIndex("jobs_idempotency_uq").on(t.type, t.idempotencyKey),
  ],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: id(),
    tenantId: tenantId(),
    entity: text("entity").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: bigint("file_size", { mode: "number" }).notNull(),
    sheetName: text("sheet_name"),
    headers: text("headers").array().notNull().default(sql`'{}'::text[]`),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
    /** create | update | skip handling for rows matching an existing record. */
    duplicateStrategy: text("duplicate_strategy").notNull().default("skip"),
    status: importStatus("status").notNull().default("uploaded"),
    totalRows: integer("total_rows").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("import_jobs_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: id(),
    tenantId: tenantId(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    status: importRowStatus("status").notNull().default("pending"),
    errors: text("errors").array().notNull().default(sql`'{}'::text[]`),
    recordId: uuid("record_id"),
    /** Snapshot of the record before an update, used for rollback. */
    previous: jsonb("previous").$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("import_rows_job_row_uq").on(t.importJobId, t.rowNumber),
    index("import_rows_job_status_idx").on(t.importJobId, t.status),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.tenantId, t.userId, t.createdAt)],
);

export const recentViews = pgTable(
  "recent_views",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    label: text("label").notNull(),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.entityType, t.entityId] }),
    index("recent_views_user_idx").on(t.tenantId, t.userId, t.viewedAt),
  ],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: id(),
    tenantId: tenantId(),
    entity: text("entity").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    options: text("options").array().notNull().default(sql`'{}'::text[]`),
    isRequired: boolean("is_required").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("cfd_tenant_entity_key_uq").on(t.tenantId, t.entity, t.key)],
);

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type LeadStatus = typeof leadStatuses.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Pipeline = typeof pipelines.$inferSelect;
export type PipelineStage = typeof pipelineStages.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type ImportJob = typeof importJobs.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;

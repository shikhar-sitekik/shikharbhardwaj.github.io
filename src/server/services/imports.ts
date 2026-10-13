import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withScope, type Tx } from "@/server/db/client";
import {
  accounts,
  contacts,
  importJobs,
  importRows,
  leadStatuses,
  leads,
  notifications,
  opportunities,
  pipelineStages,
  pipelines,
  tenantMemberships,
  users,
  type ImportJob,
} from "@/server/db/schema";
import { loadTenantContext, type TenantContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/permissions";
import { emitEvent, writeAudit } from "@/server/lib/audit";
import { normalizeDomain } from "@/server/domain/normalize";
import { IMPORT_FIELDS, missingRequired, suggestMapping, type ImportEntity } from "@/server/imports/fields";
import { transformRow, type RowValues } from "@/server/imports/transform";
import { IMPORT_LIMITS, ImportFileError, detectFormat, parseCsv, parseXlsx } from "@/server/imports/parse";
import { enqueueJob, registerJobHandler } from "@/server/jobs/queue";
import { createLeadInTx } from "./leads";
import { createAccountInTx, createContactInTx } from "./accounts";
import { createOpportunityInTx } from "./opportunities";
import { actor, need, pageArgs } from "./_shared";
import { accountInputSchema, contactInputSchema, leadInputSchema, opportunityInputSchema, fieldErrors } from "@/server/validation/crm";

export type DuplicateStrategy = "skip" | "update" | "create";
const CHUNK = 250;

const ENTITY_PERMISSION = {
  leads: "lead:write",
  accounts: "account:write",
  contacts: "contact:write",
  opportunities: "opportunity:write",
} as const;

function assertCanImport(ctx: TenantContext, entity: ImportEntity): void {
  need(ctx, "import:run");
  need(ctx, ENTITY_PERMISSION[entity]);
}

// ─── Upload ─────────────────────────────────────────────────────────────────

export async function createImportFromFile(
  ctx: TenantContext,
  input: { entity: ImportEntity; fileName: string; bytes: Uint8Array; sheet?: string | null },
): Promise<ImportJob> {
  assertCanImport(ctx, input.entity);
  if (input.bytes.byteLength === 0) throw new ValidationError("The file is empty.");
  if (input.bytes.byteLength > IMPORT_LIMITS.maxBytes)
    throw new ValidationError(`File is too large (max ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB).`);
  const safeName = input.fileName.replace(/[^\w.\- ()]/g, "_").slice(0, 200);
  let parsed;
  let sheets: { name: string; rowCount: number }[] = [];
  try {
    const format = detectFormat(safeName, input.bytes);
    if (format === "csv") {
      parsed = parseCsv(new TextDecoder("utf-8", { fatal: false }).decode(input.bytes));
      sheets = [{ name: parsed.name, rowCount: parsed.rowCount }];
    } else {
      const r = await parseXlsx(input.bytes, input.sheet);
      parsed = r.selected;
      sheets = r.sheets;
    }
  } catch (err) {
    if (err instanceof ImportFileError) throw new ValidationError(err.message);
    throw new ValidationError("The file could not be read. Check that it is a valid CSV or Excel (.xlsx) file.");
  }
  if (parsed.rows.length === 0) throw new ValidationError("No data rows were found under the header row.");
  const mapping = suggestMapping(parsed.headers, input.entity);
  return withScope(ctx, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        tenantId: ctx.tenantId,
        entity: input.entity,
        fileName: safeName,
        fileSize: input.bytes.byteLength,
        sheetName: parsed.name,
        sheets,
        headers: parsed.headers,
        mapping,
        totalRows: parsed.rows.length,
        createdById: ctx.userId,
      })
      .returning();
    if (!job) throw new Error("Failed to create import");
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      await tx.insert(importRows).values(
        parsed.rows.slice(i, i + 1000).map((raw, j) => ({ tenantId: ctx.tenantId, importJobId: job.id, rowNumber: i + j + 2, raw })),
      );
    }
    await writeAudit(tx, actor(ctx), {
      action: "import.uploaded",
      entityType: "import",
      entityId: job.id,
      changes: { entity: input.entity, fileName: safeName, rows: parsed.rows.length },
    });
    return job;
  });
}

// ─── Read ───────────────────────────────────────────────────────────────────

async function loadJob(tx: Tx, ctx: TenantContext, id: string): Promise<ImportJob> {
  const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, id));
  if (!job) throw new NotFoundError("Import not found.");
  // Users see their own imports unless they hold the all-data scope.
  if (job.createdById !== ctx.userId && ctx.dataScope !== "all") throw new ForbiddenError();
  return job;
}

export async function getImport(ctx: TenantContext, id: string) {
  need(ctx, "import:run");
  return withScope(ctx, async (tx) => {
    const job = await loadJob(tx, ctx, id);
    const sample = await tx.select().from(importRows).where(eq(importRows.importJobId, id)).orderBy(asc(importRows.rowNumber)).limit(5);
    const counts = await tx
      .select({ status: importRows.status, n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(eq(importRows.importJobId, id))
      .groupBy(importRows.status);
    const problems = await tx
      .select({ rowNumber: importRows.rowNumber, errors: importRows.errors, status: importRows.status })
      .from(importRows)
      .where(and(eq(importRows.importJobId, id), inArray(importRows.status, ["invalid", "failed"])))
      .orderBy(asc(importRows.rowNumber))
      .limit(50);
    return { job, sample, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>, problems };
  });
}

export async function listImports(ctx: TenantContext, page = 1) {
  need(ctx, "import:run");
  const { pageSize, offset } = pageArgs(page, 25);
  return withScope(ctx, async (tx) => {
    const rows = await tx
      .select({ job: importJobs, createdBy: users.name })
      .from(importJobs)
      .leftJoin(users, eq(users.id, importJobs.createdById))
      .where(ctx.dataScope === "all" ? undefined : eq(importJobs.createdById, ctx.userId))
      .orderBy(desc(importJobs.createdAt))
      .limit(pageSize)
      .offset(offset);
    return rows;
  });
}

export async function importErrorRows(ctx: TenantContext, id: string) {
  need(ctx, "import:run");
  return withScope(ctx, async (tx) => {
    const job = await loadJob(tx, ctx, id);
    const rows = await tx
      .select()
      .from(importRows)
      .where(and(eq(importRows.importJobId, id), inArray(importRows.status, ["invalid", "failed", "skipped"])))
      .orderBy(asc(importRows.rowNumber));
    return { job, rows };
  });
}

// ─── Mapping + dry run ──────────────────────────────────────────────────────

interface RefContext {
  members: Map<string, string>; // email → userId
  statuses: Map<string, string>; // key/label (lower) → id
  pipelineId: string | null;
  stages: Map<string, { id: string }>; // name lower → id
}

async function loadRefs(tx: Tx, entity: ImportEntity, pipelineId?: string): Promise<RefContext> {
  const memberRows = await tx
    .select({ id: users.id, email: users.email })
    .from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(eq(tenantMemberships.status, "active"));
  const members = new Map(memberRows.map((m) => [m.email.toLowerCase(), m.id]));
  const statuses = new Map<string, string>();
  if (entity === "leads") {
    for (const s of await tx.select().from(leadStatuses)) {
      if (s.category === "converted") continue;
      statuses.set(s.key.toLowerCase(), s.id);
      statuses.set(s.label.toLowerCase(), s.id);
    }
  }
  let pid: string | null = null;
  const stages = new Map<string, { id: string }>();
  if (entity === "opportunities") {
    const [p] = pipelineId
      ? await tx.select().from(pipelines).where(eq(pipelines.id, pipelineId))
      : await tx.select().from(pipelines).where(isNull(pipelines.archivedAt)).orderBy(desc(pipelines.isDefault), asc(pipelines.position)).limit(1);
    pid = p?.id ?? null;
    if (pid) for (const s of await tx.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, pid))) stages.set(s.name.toLowerCase(), { id: s.id });
  }
  return { members, statuses, pipelineId: pid, stages };
}

async function resolveAccount(tx: Tx, ref: string): Promise<string | null> {
  const domain = normalizeDomain(ref);
  if (domain) {
    const [a] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.domain, domain), isNull(accounts.archivedAt))).limit(1);
    if (a) return a.id;
  }
  const byName = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(sql`lower(${accounts.name}) = ${ref.trim().toLowerCase()}`, isNull(accounts.archivedAt)))
    .limit(2);
  return byName.length === 1 ? byName[0]!.id : null;
}

/** Finds an existing record matching this row (for skip/update handling). */
async function findExisting(tx: Tx, entity: ImportEntity, v: RowValues): Promise<string | null> {
  if (entity === "leads" && typeof v.email === "string") {
    const [r] = await tx.select({ id: leads.id }).from(leads).where(and(sql`lower(${leads.email}) = ${v.email}`, isNull(leads.archivedAt), isNull(leads.convertedAt))).limit(1);
    return r?.id ?? null;
  }
  if (entity === "contacts" && typeof v.email === "string") {
    const [r] = await tx.select({ id: contacts.id }).from(contacts).where(and(sql`lower(${contacts.email}) = ${v.email}`, isNull(contacts.archivedAt))).limit(1);
    return r?.id ?? null;
  }
  if (entity === "accounts") {
    if (typeof v.website === "string") {
      const [r] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.domain, v.website), isNull(accounts.archivedAt))).limit(1);
      if (r) return r.id;
    }
    if (typeof v.name === "string") {
      const [r] = await tx.select({ id: accounts.id }).from(accounts).where(and(sql`lower(${accounts.name}) = ${v.name.toLowerCase()}`, isNull(accounts.archivedAt))).limit(1);
      return r?.id ?? null;
    }
  }
  return null;
}

/** Converts transformed row values into the entity's service input, resolving references. */
async function toServiceInput(tx: Tx, entity: ImportEntity, v: RowValues, refs: RefContext): Promise<{ input: Record<string, unknown>; errors: string[] }> {
  const errors: string[] = [];
  const input: Record<string, unknown> = { ...v };
  delete input.owner;
  if (typeof v.owner === "string") {
    const id = refs.members.get(v.owner);
    if (!id) errors.push(`Owner ${v.owner} is not an active workspace member`);
    else input.ownerId = id;
  }
  if (entity === "leads") {
    delete input.status;
    if (typeof v.status === "string") {
      const id = refs.statuses.get(v.status.toLowerCase());
      if (!id) errors.push(`Unknown lead status "${v.status}"`);
      else input.statusId = id;
    }
    input.consentEmail = v.consentEmail === true;
    input.doNotContact = v.doNotContact === true;
  }
  if (entity === "contacts" || entity === "opportunities") {
    delete input.account;
    if (typeof v.account === "string") {
      const id = await resolveAccount(tx, v.account);
      if (!id) errors.push(`Account "${v.account}" was not found (match by exact name or domain)`);
      else input.accountId = id;
    }
    if (entity === "contacts") {
      input.consentEmail = v.consentEmail === true;
      input.doNotContact = v.doNotContact === true;
    }
  }
  if (entity === "accounts") input.isStrategic = false;
  if (entity === "opportunities") {
    delete input.stage;
    input.pipelineId = refs.pipelineId;
    if (typeof v.stage === "string") {
      const s = refs.stages.get(v.stage.toLowerCase());
      if (!s) errors.push(`Stage "${v.stage}" does not exist in the selected pipeline`);
      else input.stageId = s.id;
    }
    input.currency = v.currency ?? null;
    input.competitors = [];
  }
  const schema = { leads: leadInputSchema, accounts: accountInputSchema, contacts: contactInputSchema, opportunities: opportunityInputSchema }[entity];
  // Schemas expect string inputs from forms; numbers/booleans pass through preprocessors.
  if (errors.length) return { input, errors };
  const parsed = schema.safeParse(input);
  if (!parsed.success) for (const [k, msgs] of Object.entries(fieldErrors(parsed.error))) errors.push(`${k}: ${msgs.join("; ")}`);
  return { input, errors };
}

export async function saveMappingAndValidate(
  ctx: TenantContext,
  id: string,
  mapping: Record<string, string>,
  duplicateStrategy: DuplicateStrategy,
  options: { dateOrder?: "dmy" | "mdy"; pipelineId?: string } = {},
) {
  return withScope(ctx, async (tx) => {
    const job = await loadJob(tx, ctx, id);
    assertCanImport(ctx, job.entity as ImportEntity);
    if (!["uploaded", "mapped", "validated"].includes(job.status)) throw new ValidationError("This import has already been started.");
    const entity = job.entity as ImportEntity;
    const allowed = new Set(IMPORT_FIELDS[entity].map((f) => f.key));
    const clean: Record<string, string> = {};
    const usedKeys = new Set<string>();
    for (const h of job.headers) {
      const key = mapping[h] ?? "";
      if (key && !allowed.has(key)) throw new ValidationError(`Unknown field ${key}.`);
      if (key && usedKeys.has(key)) throw new ValidationError(`“${IMPORT_FIELDS[entity].find((f) => f.key === key)?.label}” is mapped more than once.`);
      if (key) usedKeys.add(key);
      clean[h] = key;
    }
    const missing = missingRequired(clean, entity);
    if (missing.length) throw new ValidationError(`Map a column to: ${missing.map((f) => f.label).join(", ")}.`);
    if (entity === "opportunities" && duplicateStrategy === "update") throw new ValidationError("Opportunities can only be created by import, not updated.");

    const refs = await loadRefs(tx, entity, options.pipelineId);
    if (entity === "opportunities" && !refs.pipelineId) throw new ValidationError("No pipeline is configured.");
    const rows = await tx.select().from(importRows).where(eq(importRows.importJobId, id)).orderBy(asc(importRows.rowNumber));
    const seenKeys = new Map<string, number>();
    let valid = 0;
    let invalid = 0;
    let duplicates = 0;
    for (const row of rows) {
      const t = transformRow(row.raw, clean, entity, { dateOrder: options.dateOrder });
      const errors = [...t.errors];
      if (errors.length === 0) {
        const s = await toServiceInput(tx, entity, t.values, refs);
        errors.push(...s.errors);
      }
      // In-file duplicates on the match key.
      const fileKey = entity === "accounts" ? (t.values.website ?? t.values.name) : t.values.email;
      if (typeof fileKey === "string" && fileKey) {
        const k = fileKey.toLowerCase();
        const first = seenKeys.get(k);
        if (first !== undefined) errors.push(`Duplicate of row ${first} in this file`);
        else seenKeys.set(k, row.rowNumber);
      }
      if (errors.length === 0 && (await findExisting(tx, entity, t.values))) duplicates += 1;
      const status = errors.length ? "invalid" : "valid";
      if (status === "valid") valid += 1;
      else invalid += 1;
      await tx.update(importRows).set({ status, errors }).where(eq(importRows.id, row.id));
    }
    await tx
      .update(importJobs)
      .set({ mapping: clean, duplicateStrategy, status: "validated", options: { dateOrder: options.dateOrder ?? "dmy", pipelineId: refs.pipelineId ?? undefined }, errorCount: invalid })
      .where(eq(importJobs.id, id));
    return { valid, invalid, duplicates, total: rows.length };
  });
}

// ─── Execute (background) ───────────────────────────────────────────────────

export async function startImport(ctx: TenantContext, id: string): Promise<void> {
  await withScope(ctx, async (tx) => {
    const job = await loadJob(tx, ctx, id);
    assertCanImport(ctx, job.entity as ImportEntity);
    if (job.status !== "validated") throw new ValidationError("Validate the mapping before importing.");
    await tx.update(importJobs).set({ status: "queued" }).where(eq(importJobs.id, id));
    await writeAudit(tx, actor(ctx), { action: "import.started", entityType: "import", entityId: id });
  });
  await enqueueJob({ type: "import.process", tenantId: ctx.tenantId, payload: { importJobId: id }, idempotencyKey: `import:${id}` });
}

const UPDATE_FIELDS: Record<ImportEntity, readonly string[]> = {
  leads: ["firstName", "lastName", "phone", "jobTitle", "department", "company", "industry", "country", "region", "employeeRange", "source", "sourceDetail", "productInterest", "businessProblem"],
  contacts: ["firstName", "lastName", "phone", "jobTitle", "department", "seniority", "country", "accountId", "linkedinUrl"],
  accounts: ["industry", "country", "region", "headquarters", "employeeRange", "tier", "description"],
  opportunities: [],
};

async function updateExisting(tx: Tx, ctx: TenantContext, entity: ImportEntity, id: string, input: Record<string, unknown>) {
  // Only overwrite with non-blank imported values (never blank out CRM data).
  const patch: Record<string, unknown> = {};
  for (const k of UPDATE_FIELDS[entity]) {
    const v = input[k];
    if (v !== null && v !== undefined && v !== "") patch[k] = v;
  }
  const table = entity === "leads" ? leads : entity === "contacts" ? contacts : accounts;
  const [before] = await tx.select().from(table).where(eq(table.id, id));
  if (!before) return null;
  if (Object.keys(patch).length) await tx.update(table).set(patch).where(eq(table.id, id));
  await writeAudit(tx, actor(ctx), { action: `${entity.slice(0, -1)}.updated`, entityType: entity.slice(0, -1), entityId: id, changes: { origin: "import", fields: Object.keys(patch) } });
  const previous: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) previous[k] = (before as Record<string, unknown>)[k];
  return previous;
}

/** Processes one chunk of rows. Returns "continue" while rows remain. */
export async function processImportChunk(tenantId: string, importJobId: string): Promise<"done" | "continue"> {
  const owner = await withScope({ tenantId, userId: null }, async (tx) => {
    const [j] = await tx.select().from(importJobs).where(eq(importJobs.id, importJobId));
    return j ?? null;
  });
  if (!owner || !owner.createdById) return "done";
  if (owner.status === "completed" || owner.status === "rolled_back" || owner.status === "failed") return "done";
  // Re-resolve the importing user's context so permission changes take effect mid-import.
  const ctx = await loadTenantContext(owner.createdById, tenantId);
  if (!ctx || !ctx.permissions.has("import:run") || !ctx.permissions.has(ENTITY_PERMISSION[owner.entity as ImportEntity])) {
    await withScope({ tenantId, userId: null }, (tx) => tx.update(importJobs).set({ status: "failed", completedAt: new Date() }).where(eq(importJobs.id, importJobId)));
    return "done";
  }
  const entity = owner.entity as ImportEntity;
  return withScope(ctx, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, importJobId)).for("update");
    if (!job) return "done";
    if (job.status === "queued") await tx.update(importJobs).set({ status: "processing" }).where(eq(importJobs.id, importJobId));
    const rows = await tx
      .select()
      .from(importRows)
      .where(and(eq(importRows.importJobId, importJobId), eq(importRows.status, "valid")))
      .orderBy(asc(importRows.rowNumber))
      .limit(CHUNK);
    const refs = await loadRefs(tx, entity, job.options.pipelineId);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        // Savepoint per row: one bad row never aborts the chunk.
        await tx.transaction(async (sp) => {
          const t = transformRow(row.raw, job.mapping, entity, { dateOrder: job.options.dateOrder });
          const s = await toServiceInput(sp, entity, t.values, refs);
          if (t.errors.length || s.errors.length) throw new ValidationError([...t.errors, ...s.errors].join("; "));
          const existing = job.duplicateStrategy === "create" ? null : await findExisting(sp, entity, t.values);
          if (existing && job.duplicateStrategy === "skip") {
            await sp.update(importRows).set({ status: "skipped", recordId: existing, errors: ["Matched an existing record (skipped)"] }).where(eq(importRows.id, row.id));
            skipped += 1;
            return;
          }
          if (existing && job.duplicateStrategy === "update") {
            const previous = await updateExisting(sp, ctx, entity, existing, s.input);
            await sp.update(importRows).set({ status: "updated", recordId: existing, previous }).where(eq(importRows.id, row.id));
            updated += 1;
            return;
          }
          let recordId: string;
          if (entity === "leads") recordId = (await createLeadInTx(sp, ctx, leadInputSchema.parse(s.input), { origin: "import" })).id;
          else if (entity === "accounts") recordId = (await createAccountInTx(sp, ctx, accountInputSchema.parse(s.input))).id;
          else if (entity === "contacts") recordId = (await createContactInTx(sp, ctx, contactInputSchema.parse(s.input))).id;
          else recordId = (await createOpportunityInTx(sp, ctx, opportunityInputSchema.parse(s.input))).id;
          await sp.update(importRows).set({ status: "created", recordId }).where(eq(importRows.id, row.id));
          created += 1;
        });
      } catch (err) {
        const message = err instanceof ValidationError ? `${err.message}${Object.keys(err.fieldErrors).length ? ` (${Object.entries(err.fieldErrors).map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ")})` : ""}` : "Unexpected error while saving this row";
        await tx.update(importRows).set({ status: "failed", errors: [message.slice(0, 500)] }).where(eq(importRows.id, row.id));
        failed += 1;
      }
    }
    await tx
      .update(importJobs)
      .set({
        processedRows: sql`${importJobs.processedRows} + ${rows.length}`,
        createdCount: sql`${importJobs.createdCount} + ${created}`,
        updatedCount: sql`${importJobs.updatedCount} + ${updated}`,
        skippedCount: sql`${importJobs.skippedCount} + ${skipped}`,
        errorCount: sql`${importJobs.errorCount} + ${failed}`,
      })
      .where(eq(importJobs.id, importJobId));
    if (rows.length === CHUNK) return "continue";
    const [final] = await tx
      .update(importJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(importJobs.id, importJobId))
      .returning();
    await writeAudit(tx, actor(ctx), { action: "import.completed", entityType: "import", entityId: importJobId, changes: { created: final?.createdCount, updated: final?.updatedCount, skipped: final?.skippedCount, errors: final?.errorCount } });
    await emitEvent(tx, actor(ctx), { type: "import.completed", entityType: "import", entityId: importJobId });
    await tx.insert(notifications).values({
      tenantId,
      userId: ctx.userId,
      kind: "import.completed",
      title: `Import of ${job.fileName} finished`,
      body: `${final?.createdCount ?? 0} created · ${final?.updatedCount ?? 0} updated · ${final?.skippedCount ?? 0} skipped · ${final?.errorCount ?? 0} with errors`,
      href: `/imports/${importJobId}`,
    });
    return "done";
  });
}

registerJobHandler("import.process", async (job) => {
  const id = job.payload.importJobId;
  if (!job.tenantId || typeof id !== "string") return "done";
  return processImportChunk(job.tenantId, id);
});

// ─── Rollback ───────────────────────────────────────────────────────────────

/**
 * Reverses a completed import: archives records it created (soft delete, so
 * any later edits are retained in history) and restores fields it updated.
 */
export async function rollbackImport(ctx: TenantContext, id: string): Promise<{ archived: number; restored: number }> {
  return withScope(ctx, async (tx) => {
    const job = await loadJob(tx, ctx, id);
    assertCanImport(ctx, job.entity as ImportEntity);
    if (job.status !== "completed") throw new ValidationError("Only completed imports can be rolled back.");
    const entity = job.entity as ImportEntity;
    const table = { leads, accounts, contacts, opportunities }[entity];
    const createdRows = await tx.select({ recordId: importRows.recordId }).from(importRows).where(and(eq(importRows.importJobId, id), eq(importRows.status, "created")));
    const ids = createdRows.map((r) => r.recordId).filter((x): x is string => !!x);
    let archived = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const r = await tx.update(table).set({ archivedAt: new Date() }).where(and(inArray(table.id, ids.slice(i, i + 500)), isNull(table.archivedAt))).returning({ id: table.id });
      archived += r.length;
    }
    let restored = 0;
    if (entity !== "opportunities") {
      const updatedRows = await tx.select().from(importRows).where(and(eq(importRows.importJobId, id), eq(importRows.status, "updated")));
      const t = entity === "leads" ? leads : entity === "contacts" ? contacts : accounts;
      for (const r of updatedRows) {
        if (r.recordId && r.previous && Object.keys(r.previous).length) {
          await tx.update(t).set(r.previous).where(eq(t.id, r.recordId));
          restored += 1;
        }
      }
    }
    await tx.update(importJobs).set({ status: "rolled_back" }).where(eq(importJobs.id, id));
    await writeAudit(tx, actor(ctx), { action: "import.rolled_back", entityType: "import", entityId: id, changes: { archived, restored } });
    return { archived, restored };
  });
}


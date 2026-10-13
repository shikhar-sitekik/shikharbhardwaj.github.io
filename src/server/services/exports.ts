import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { withScope } from "@/server/db/client";
import type { TenantContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/permissions";
import { writeAudit } from "@/server/lib/audit";
import { csvSafe } from "@/server/domain/normalize";
import { listLeads, type LeadFilters } from "./leads";
import { listAccounts, listContacts } from "./accounts";
import { listOpportunities } from "./opportunities";
import { actor, need } from "./_shared";

export const EXPORT_MAX_ROWS = 10_000;
export type ExportEntity = "leads" | "accounts" | "contacts" | "opportunities";
type Row = Record<string, string | number | null>;

async function collect<T>(fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page += 1) {
    const r = await fetchPage(page);
    out.push(...r.rows);
    if (r.rows.length === 0 || out.length >= Math.min(r.total, EXPORT_MAX_ROWS)) break;
  }
  return out.slice(0, EXPORT_MAX_ROWS);
}

const iso = (d: Date | string | null) => (d ? (d instanceof Date ? d.toISOString() : d) : null);

/**
 * Exports the caller's authorised view of an entity (same filters and data
 * scope as the list page). Personal-email fields are never exported. Every
 * export is audited.
 */
export async function exportRows(ctx: TenantContext, entity: ExportEntity, params: URLSearchParams): Promise<{ rows: Row[]; truncated: boolean }> {
  need(ctx, "export:run");
  const q = params.get("q") ?? undefined;
  let rows: Row[] = [];
  if (entity === "leads") {
    need(ctx, "lead:read");
    const owner = params.get("owner") ?? undefined;
    const f: LeadFilters = { q, statusId: params.get("status") ?? undefined, ownerId: owner, source: params.get("source") ?? undefined, pageSize: 200 };
    const data = await collect((page) => listLeads(ctx, { ...f, page }));
    rows = data.map((l) => ({ "First name": l.firstName, "Last name": l.lastName, Email: l.email, Company: l.company, "Job title": l.jobTitle, Status: l.statusLabel, Score: l.score, Source: l.source, Country: l.country, Owner: l.ownerName, "Last contacted": iso(l.lastContactedAt), Created: iso(l.createdAt) }));
  } else if (entity === "accounts") {
    need(ctx, "account:read");
    const data = await collect((page) => listAccounts(ctx, { q, status: params.get("status") ?? undefined, pageSize: 200, page }));
    rows = data.map((a) => ({ Name: a.name, Domain: a.domain, Status: a.status, Industry: a.industry, Country: a.country, Tier: a.tier, Strategic: a.isStrategic ? "yes" : "no", "Open opportunities": a.openOpportunities, Contacts: a.contactCount, Owner: a.ownerName, Created: iso(a.createdAt) }));
  } else if (entity === "contacts") {
    need(ctx, "contact:read");
    const data = await collect((page) => listContacts(ctx, { q, pageSize: 200, page }));
    rows = data.map((c) => ({ "First name": c.firstName, "Last name": c.lastName, Email: c.email, Phone: c.phone, "Job title": c.jobTitle, Account: c.accountName, "Buying role": c.buyingRole, "Do not contact": c.doNotContact ? "yes" : "no", Owner: c.ownerName, "Last contacted": iso(c.lastContactedAt) }));
  } else if (entity === "opportunities") {
    need(ctx, "opportunity:read");
    const status = params.get("status");
    const data = await collect((page) =>
      listOpportunities(ctx, {
        q,
        pipelineId: params.get("pipeline") ?? undefined,
        status: status === "open" || status === "won" || status === "lost" ? status : undefined,
        pageSize: 200,
        page,
      }),
    );
    rows = data.map((o) => ({ Name: o.name, Account: o.accountName, Stage: o.stageName, Status: o.stageCategory, Amount: Number(o.amount), Currency: o.currency, "Probability %": o.probability, "Expected close": o.expectedCloseDate, Forecast: o.forecastCategory, Owner: o.ownerName, Updated: iso(o.updatedAt) }));
  } else throw new ValidationError("Unknown export.");
  await withScope(ctx, (tx) =>
    writeAudit(tx, actor(ctx), { action: "export.downloaded", entityType: entity, entityId: null, changes: { rows: rows.length, filters: Object.fromEntries(params) } }),
  );
  return { rows, truncated: rows.length >= EXPORT_MAX_ROWS };
}

export function toCsv(rows: Row[]): string {
  const safe = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "number" ? v : csvSafe(v)])));
  return `﻿${Papa.unparse(safe.length ? safe : [{ "No data": "" }])}`;
}

export async function toXlsx(rows: Row[], sheetName: string): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31));
  const headers = Object.keys(rows[0] ?? { "No data": "" });
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 4)) }));
  ws.getRow(1).font = { bold: true };
  // Values are written as plain cell values (never formulas).
  for (const r of rows) ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? csvSafe(v) : v])));
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

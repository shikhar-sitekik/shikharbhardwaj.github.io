import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createImportFromFile, getImport, processImportChunk, rollbackImport, saveMappingAndValidate, startImport } from "@/server/services/imports";
import { createLead, listLeads } from "@/server/services/leads";
import { createAccount, listAccounts } from "@/server/services/accounts";
import { listOpportunities } from "@/server/services/opportunities";
import { runJobs } from "@/server/jobs";
import { exportRows, toCsv } from "@/server/services/exports";
import { ForbiddenError, ValidationError } from "@/server/auth/permissions";
import { makeMember, makeTenant, resetDatabase } from "./helpers";

beforeAll(async () => {
  await resetDatabase();
});

const enc = (s: string) => new TextEncoder().encode(s);

describe("import engine", () => {
  it("validates, imports with duplicate handling, reports errors and rolls back", async () => {
    const { admin } = await makeTenant("Import");
    await createLead(admin, { firstName: "Old", lastName: "Existing", email: "existing@acme.com", company: "Acme" });
    const csv = [
      "First Name,Last Name,Email,Company,Phone,Lead Source,Owner",
      "Ana,Silva,ana@initech.com,Initech,+55 11 98765 4321,website,",
      "Bob,,bob@initech.com,Initech,,website,",
      "Cy,Jones,not-an-email,Initech,,referral,",
      "Existing,Person,existing@acme.com,Acme Updated,,event,",
      "Dee,Dupe,ana@initech.com,Initech,,website,",
      `Eve,Owner,eve@globex.com,Globex,,website,${admin.user.email}`,
      "Fay,Ghost,fay@globex.com,Globex,,website,ghost@nowhere.com",
    ].join("\n");
    const job = await createImportFromFile(admin, { entity: "leads", fileName: "leads.csv", bytes: enc(csv) });
    expect(job.totalRows).toBe(7);
    expect(job.mapping).toMatchObject({ "First Name": "firstName", Email: "email", "Lead Source": "source", Owner: "owner" });

    const v = await saveMappingAndValidate(admin, job.id, job.mapping, "update");
    expect(v).toMatchObject({ total: 7, valid: 3, invalid: 4, duplicates: 1 });
    const detail = await getImport(admin, job.id);
    const errs = detail.problems.map((p) => `${p.rowNumber}: ${p.errors.join(";")}`).join("\n");
    expect(errs).toMatch(/3: .*Last name is required/);
    expect(errs).toMatch(/4: .*Email/);
    expect(errs).toMatch(/6: .*Duplicate of row 2/);
    expect(errs).toMatch(/8: .*not an active workspace member/);

    await startImport(admin, job.id);
    const r = await runJobs({ maxMs: 20_000 });
    expect(r.failed).toBe(0);
    const done = await getImport(admin, job.id);
    expect(done.job.status).toBe("completed");
    expect(done.job).toMatchObject({ createdCount: 2, updatedCount: 1, skippedCount: 0 });
    const all = await listLeads(admin, { pageSize: 100 });
    expect(all.rows.find((l) => l.email === "existing@acme.com")?.company).toBe("Acme Updated");
    expect(all.total).toBe(3);

    const rb = await rollbackImport(admin, job.id);
    expect(rb).toEqual({ archived: 2, restored: 1 });
    const after = await listLeads(admin, { pageSize: 100 });
    expect(after.total).toBe(1);
    expect(after.rows[0]?.company).toBe("Acme");
  });

  it("imports opportunities from xlsx with account and stage resolution", async () => {
    const { admin } = await makeTenant("Xlsx");
    await createAccount(admin, { name: "Umbrella Corp", website: "umbrella.example" });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Deals");
    ws.addRow(["Deal Name", "Account", "Stage", "Amount", "Currency", "Close Date"]);
    ws.addRow(["Umbrella CCaaS", "umbrella.example", "Discovery", 120000, "USD", new Date(Date.UTC(2026, 11, 15))]);
    ws.addRow(["Unknown account deal", "Nobody Inc", "Discovery", 5000, "USD", "2026-12-01"]);
    ws.addRow(["Bad stage", "Umbrella Corp", "Imaginary", 5000, "USD", "2026-12-01"]);
    const bytes = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const job = await createImportFromFile(admin, { entity: "opportunities", fileName: "deals.xlsx", bytes });
    expect(job.sheetName).toBe("Deals");
    const v = await saveMappingAndValidate(admin, job.id, job.mapping, "create");
    expect(v).toMatchObject({ valid: 1, invalid: 2 });
    await startImport(admin, job.id);
    while ((await processImportChunk(admin.tenantId, job.id)) === "continue");
    const opps = await listOpportunities(admin);
    expect(opps.rows).toHaveLength(1);
    expect(opps.rows[0]).toMatchObject({ name: "Umbrella CCaaS", stageName: "Discovery", amount: "120000.00", expectedCloseDate: "2026-12-15" });
  });

  it("rejects bad files and enforces permissions", async () => {
    const { admin } = await makeTenant("BadFiles");
    await expect(createImportFromFile(admin, { entity: "leads", fileName: "x.exe", bytes: enc("MZ") })).rejects.toBeInstanceOf(ValidationError);
    await expect(createImportFromFile(admin, { entity: "leads", fileName: "x.xlsx", bytes: enc("not a zip") })).rejects.toThrow(/not a valid Excel/);
    await expect(createImportFromFile(admin, { entity: "leads", fileName: "x.csv", bytes: enc("A,B\n") })).rejects.toThrow(/No data rows/);
    const rep = await makeMember(admin, "sales_rep");
    await expect(createImportFromFile(rep, { entity: "leads", fileName: "x.csv", bytes: enc("Last Name\nX") })).rejects.toBeInstanceOf(ForbiddenError);
    const job = await createImportFromFile(admin, { entity: "leads", fileName: "x.csv", bytes: enc("Email\na@b.co") });
    await expect(saveMappingAndValidate(admin, job.id, job.mapping, "skip")).rejects.toThrow(/Last name/);
  });

  it("exports authorised rows with formula injection neutralised", async () => {
    const { admin } = await makeTenant("Export");
    await createLead(admin, { lastName: "=HYPERLINK(\"http://evil\")", company: "Acme" });
    const { rows } = await exportRows(admin, "leads", new URLSearchParams());
    expect(rows).toHaveLength(1);
    expect(toCsv(rows)).toContain("'=HYPERLINK");
    const rep = await makeMember(admin, "sales_rep");
    await expect(exportRows(rep, "leads", new URLSearchParams())).rejects.toBeInstanceOf(ForbiddenError);
    void listAccounts;
  });
});

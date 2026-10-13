import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Upload } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { listImports } from "@/server/services/imports";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Import & export" };

const EXPORTS = [
  { entity: "leads", label: "Leads", permission: "lead:read" },
  { entity: "accounts", label: "Accounts", permission: "account:read" },
  { entity: "contacts", label: "Contacts", permission: "contact:read" },
  { entity: "opportunities", label: "Opportunities", permission: "opportunity:read" },
] as const;

export default async function ImportsPage() {
  const ctx = await requireContext();
  if (!ctx.permissions.has("import:run") && !ctx.permissions.has("export:run")) notFound();
  const rows = ctx.permissions.has("import:run") ? await listImports(ctx) : [];
  return (
    <div>
      <PageHeader
        title="Import & export"
        description="Bring data in from spreadsheets and other CRMs; export your authorised views."
        actions={
          ctx.permissions.has("import:run") ? (
            <Button asChild variant="primary">
              <Link href="/imports/new">
                <Upload /> New import
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 p-4 md:p-6">
        {ctx.permissions.has("export:run") ? (
          <Card>
            <CardHeader title="Export" description="Exports respect your data access scope, exclude personal email, and are recorded in the audit log. Limit 10,000 rows per export." />
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {EXPORTS.filter((e) => ctx.permissions.has(e.permission)).map((e) => (
                <div key={e.entity} className="flex items-center gap-1 rounded-md border border-border px-2 py-1">
                  <span className="mr-1 text-[12.5px] font-medium">{e.label}</span>
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/api/export/${e.entity}`}>
                      <Download /> CSV
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <a href={`/api/export/${e.entity}?format=xlsx`}>
                      <Download /> XLSX
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
        {ctx.permissions.has("import:run") ? (
          <Card>
            <CardHeader title="Import history" />
            {rows.length === 0 ? (
              <EmptyState icon={Upload} title="No imports yet" description="Import leads, accounts, contacts or opportunities from CSV or Excel." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>File</TH>
                    <TH>Entity</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Rows</TH>
                    <TH className="text-right">Created</TH>
                    <TH className="text-right">Errors</TH>
                    <TH>By</TH>
                    <TH>When</TH>
                  </tr>
                </THead>
                <TBody>
                  {rows.map(({ job, createdBy }) => (
                    <TR key={job.id}>
                      <TD>
                        <Link href={`/imports/${job.id}`} className="font-medium hover:text-accent">
                          {job.fileName}
                        </Link>
                      </TD>
                      <TD className="capitalize">{job.entity}</TD>
                      <TD>
                        <Badge tone={job.status === "completed" ? "success" : job.status === "failed" ? "danger" : "neutral"}>{job.status.replace("_", " ")}</Badge>
                      </TD>
                      <TD className="tabular text-right">{job.totalRows}</TD>
                      <TD className="tabular text-right">{job.createdCount}</TD>
                      <TD className="tabular text-right">{job.errorCount}</TD>
                      <TD className="text-text-2">{createdBy ?? "—"}</TD>
                      <TD className="text-text-3">{formatDate(job.createdAt, { withTime: true, timeZone: ctx.tenant.settings.timezone })}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

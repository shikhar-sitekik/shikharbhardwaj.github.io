import Link from "next/link";
import { Download } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { getImport } from "@/server/services/imports";
import { listPipelines } from "@/server/services/opportunities";
import { IMPORT_FIELDS, type ImportEntity } from "@/server/imports/fields";
import { loadOr404 } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/crm/stat";
import { AutoRefresh, MappingForm, RollbackButton, StartImportButton } from "@/components/crm/import-forms";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Import" };

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "danger" | "warning"> = {
  uploaded: "neutral",
  mapped: "neutral",
  validated: "accent",
  queued: "warning",
  processing: "warning",
  completed: "success",
  failed: "danger",
  rolled_back: "neutral",
};

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext();
  const { id } = await params;
  const { job, sample, counts, problems } = await loadOr404(() => getImport(ctx, id));
  const entity = job.entity as ImportEntity;
  const running = job.status === "queued" || job.status === "processing";
  const editable = ["uploaded", "mapped", "validated"].includes(job.status);
  const pipelines = entity === "opportunities" && editable ? await listPipelines(ctx) : [];
  // Rows still "valid" are those not yet processed.
  const pct = Math.round((job.processedRows / Math.max(1, job.processedRows + (counts.valid ?? 0))) * 100);
  return (
    <div>
      {running ? <AutoRefresh /> : null}
      <PageHeader
        title={job.fileName}
        description={`${job.totalRows} rows · ${entity}${job.sheetName && job.sheetName !== "CSV" ? ` · sheet “${job.sheetName}”` : ""} · uploaded ${formatDate(job.createdAt, { withTime: true, timeZone: ctx.tenant.settings.timezone })}`}
        crumbs={[{ label: "Import & export", href: "/imports" }, { label: job.fileName }]}
        meta={<Badge tone={STATUS_TONE[job.status]}>{job.status.replace("_", " ")}</Badge>}
        actions={
          job.status === "completed" ? (
            <RollbackButton importId={id} />
          ) : null
        }
      />
      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:p-6">
        {job.sheets.length > 1 ? (
          <p className="text-[12.5px] text-text-3">
            This workbook has {job.sheets.length} sheets ({job.sheets.map((s) => `${s.name}: ${s.rowCount} rows`).join(", ")}). To import a different sheet,{" "}
            <Link href={`/imports/new?entity=${entity}`} className="text-accent hover:underline">
              upload again
            </Link>{" "}
            and enter its name.
          </p>
        ) : null}

        {editable ? (
          <Card>
            <CardHeader title="1. Map columns" description="Fields marked * are required. Unmapped columns are ignored." />
            <CardBody>
              <MappingForm
                importId={id}
                headers={job.headers}
                sample={sample.map((s) => s.raw)}
                mapping={job.mapping}
                fields={IMPORT_FIELDS[entity].map((f) => ({ key: f.key, label: f.label, required: !!f.required }))}
                duplicateStrategy={job.duplicateStrategy}
                dateOrder={job.options.dateOrder ?? "dmy"}
                entity={entity}
                pipelines={pipelines.map((p) => ({ id: p.id, name: p.name }))}
                pipelineId={job.options.pipelineId}
              />
            </CardBody>
          </Card>
        ) : null}

        {job.status === "validated" ? (
          <Card>
            <CardHeader title="2. Review and import" description="Validation results from the dry run. Nothing has been saved yet." />
            <CardBody className="grid gap-4">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Valid rows" value={counts.valid ?? 0} />
                <Stat label="Rows with errors" value={counts.invalid ?? 0} tone={(counts.invalid ?? 0) > 0 ? "danger" : "neutral"} />
                <Stat label="Duplicate handling" value={<span className="text-[15px] capitalize">{job.duplicateStrategy}</span>} />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {(counts.invalid ?? 0) > 0 ? (
                  <Button asChild variant="ghost">
                    <a href={`/api/imports/${id}/errors`}>
                      <Download /> Download rows with errors
                    </a>
                  </Button>
                ) : null}
                <StartImportButton importId={id} validCount={counts.valid ?? 0} />
              </div>
            </CardBody>
          </Card>
        ) : null}

        {running || job.status === "completed" || job.status === "rolled_back" || job.status === "failed" ? (
          <Card>
            <CardHeader title={running ? "Importing…" : "Result"} description={running ? "This page refreshes automatically. You can leave it; you'll get a notification when it's done." : job.completedAt ? `Finished ${formatDate(job.completedAt, { withTime: true, timeZone: ctx.tenant.settings.timezone })}` : undefined} />
            <CardBody className="grid gap-4">
              {running ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Created" value={job.createdCount} />
                <Stat label="Updated" value={job.updatedCount} />
                <Stat label="Skipped (duplicates)" value={job.skippedCount} />
                <Stat label="Errors" value={job.errorCount} tone={job.errorCount > 0 ? "danger" : "neutral"} />
              </div>
              {job.errorCount + job.skippedCount > 0 ? (
                <div className="flex justify-end">
                  <Button asChild variant="secondary">
                    <a href={`/api/imports/${id}/errors`}>
                      <Download /> Download error & skip report (CSV)
                    </a>
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {problems.length > 0 ? (
          <Card>
            <CardHeader title="Rows needing attention" description={`First ${problems.length} shown; download the full report above.`} />
            <ul className="divide-y divide-border">
              {problems.map((p) => (
                <li key={p.rowNumber} className="flex gap-3 px-4 py-2 text-[12.5px]">
                  <span className="tabular w-16 shrink-0 text-text-3">Row {p.rowNumber}</span>
                  <span className="text-danger">{p.errors.join("; ")}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

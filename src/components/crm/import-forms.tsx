"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import { rollbackImportAction, startImportAction, uploadImportAction, validateImportAction } from "@/server/actions/imports";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/submit";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export function UploadForm({ entities, defaultEntity, maxMb }: { entities: { value: string; label: string }[]; defaultEntity: string; maxMb: number }) {
  const [state, action] = useActionState(uploadImportAction, { status: "idle" });
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <Field label="What are you importing?" htmlFor="entity">
        <Select id="entity" name="entity" defaultValue={defaultEntity}>
          {entities.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>
      <label htmlFor="file" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-2 px-6 py-10 text-center hover:border-accent">
        {fileName ? <FileSpreadsheet className="size-6 text-accent" /> : <Upload className="size-6 text-text-3" />}
        <span className="text-[13px] font-medium">{fileName ?? "Choose a .csv or .xlsx file"}</span>
        <span className="text-[12px] text-text-3">Up to {maxMb} MB and 20,000 rows. The first non-empty row must contain column headers.</span>
        <input id="file" name="file" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
      </label>
      <Field label="Sheet name (Excel only, optional)" htmlFor="sheet" hint="Leave blank to use the first sheet that contains data.">
        <Input id="sheet" name="sheet" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Reading file…">Upload and preview</SubmitButton>
      </div>
    </form>
  );
}

export function MappingForm({
  importId,
  headers,
  sample,
  mapping,
  fields,
  duplicateStrategy,
  dateOrder,
  entity,
  pipelines,
  pipelineId,
}: {
  importId: string;
  headers: string[];
  sample: Record<string, string>[];
  mapping: Record<string, string>;
  fields: { key: string; label: string; required: boolean }[];
  duplicateStrategy: string;
  dateOrder: string;
  entity: string;
  pipelines: { id: string; name: string }[];
  pipelineId?: string;
}) {
  const [state, action] = useActionState(validateImportAction.bind(null, importId), { status: "idle" });
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <THead>
            <tr>
              <TH>Column in file</TH>
              <TH>Sample values</TH>
              <TH className="w-[260px]">Maps to</TH>
            </tr>
          </THead>
          <TBody>
            {headers.map((h) => (
              <TR key={h}>
                <TD className="font-medium">{h}</TD>
                <TD className="max-w-[320px] truncate text-text-3">
                  {sample
                    .map((r) => r[h])
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(" · ") || "—"}
                </TD>
                <TD>
                  <Select name={`map:${h}`} defaultValue={mapping[h] ?? ""} aria-label={`Map ${h}`}>
                    <option value="">Don’t import</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </option>
                    ))}
                  </Select>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="When a row matches an existing record" htmlFor="duplicateStrategy" hint={entity === "accounts" ? "Matched by domain, then exact name." : entity === "opportunities" ? "Opportunities are always created." : "Matched by email."}>
          <Select id="duplicateStrategy" name="duplicateStrategy" defaultValue={entity === "opportunities" ? "create" : duplicateStrategy}>
            <option value="skip">Skip the row</option>
            {entity !== "opportunities" ? <option value="update">Update the existing record (non-blank values only)</option> : null}
            <option value="create">Create a new record anyway</option>
          </Select>
        </Field>
        <Field label="Date format for ambiguous dates" htmlFor="dateOrder" hint="e.g. 03/04/2026">
          <Select id="dateOrder" name="dateOrder" defaultValue={dateOrder}>
            <option value="dmy">Day/Month/Year</option>
            <option value="mdy">Month/Day/Year</option>
          </Select>
        </Field>
        {entity === "opportunities" ? (
          <Field label="Pipeline" htmlFor="pipelineId" hint="Stage names must match this pipeline.">
            <Select id="pipelineId" name="pipelineId" defaultValue={pipelineId ?? pipelines[0]?.id}>
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Validating every row…">Validate (dry run)</SubmitButton>
      </div>
    </form>
  );
}

export function StartImportButton({ importId, validCount }: { importId: string; validCount: number }) {
  const [state, action] = useActionState(startImportAction.bind(null, importId), { status: "idle" });
  useEffect(() => {
    if (state.status === "error") toast.error(state.message);
  }, [state]);
  return (
    <form action={action}>
      <SubmitButton disabled={validCount === 0} pendingLabel="Starting…">
        Import {validCount} valid row{validCount === 1 ? "" : "s"}
      </SubmitButton>
    </form>
  );
}

export function RollbackButton({ importId }: { importId: string }) {
  const [state, action] = useActionState(rollbackImportAction.bind(null, importId), { status: "idle" });
  useEffect(() => {
    if (state.status === "success") toast.success(state.message ?? "Rolled back");
    if (state.status === "error") toast.error(state.message);
  }, [state]);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm("Archive every record this import created and restore fields it updated?")) e.preventDefault();
      }}
    >
      <SubmitButton variant="danger" pendingLabel="Rolling back…">
        Roll back import
      </SubmitButton>
    </form>
  );
}

/** Polls while an import runs in the background. */
export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), intervalMs);
    return () => window.clearInterval(t);
  }, [router, intervalMs]);
  return null;
}


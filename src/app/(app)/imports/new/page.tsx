import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { IMPORT_LIMITS } from "@/server/imports/parse";
import { sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { UploadForm } from "@/components/crm/import-forms";

export const metadata = { title: "Upload Excel sheet" };

const ALL = [
  { value: "leads", label: "Leads", permission: "lead:write" },
  { value: "accounts", label: "Accounts", permission: "account:write" },
  { value: "contacts", label: "Contacts", permission: "contact:write" },
  { value: "opportunities", label: "Opportunities", permission: "opportunity:write" },
] as const;

export default async function NewImportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("import:run")) notFound();
  const entities = ALL.filter((e) => ctx.permissions.has(e.permission));
  const wanted = sp(await searchParams, "entity");
  return (
    <div>
      <PageHeader title="Upload Excel sheet" description="Upload, map columns, validate every row, then import in the background." crumbs={[{ label: "Upload Excel", href: "/imports" }, { label: "New import" }]} />
      <div className="mx-auto grid max-w-2xl gap-4 p-4 md:p-6">
        <Card>
          <CardBody>
            <UploadForm entities={entities.map(({ value, label }) => ({ value, label }))} defaultEntity={entities.find((e) => e.value === wanted)?.value ?? entities[0]?.value ?? "leads"} maxMb={IMPORT_LIMITS.maxBytes / 1024 / 1024} />
          </CardBody>
        </Card>
        <Card>
          <CardBody className="grid gap-2 text-[12.5px] text-text-2">
            <p className="font-medium text-text">How importing works</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Columns are matched to fields automatically; you can change any mapping.</li>
              <li>A dry run validates every row (emails, phones, dates, currencies, owners, accounts, stages) and finds duplicates. Nothing is saved yet.</li>
              <li>Valid rows import in the background. Rows with errors are never silently dropped; download them, fix and re-import.</li>
              <li>A completed import can be rolled back: created records are archived and updated fields restored.</li>
            </ol>
            <p className="text-text-3">Formulas are not evaluated (cached values are used) and macro-enabled files are not accepted.</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

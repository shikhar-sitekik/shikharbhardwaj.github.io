import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Download, Plus, Star, Upload } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { listAccounts } from "@/server/services/accounts";
import { memberOptions } from "@/server/services/opportunities";
import { isUuid, sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/crm/filter-bar";
import { Pagination } from "@/components/crm/pagination";
import { ACCOUNT_STATUSES } from "@/lib/crm-options";

export const metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("account:read")) notFound();
  const params = await searchParams;
  const owner = sp(params, "owner");
  const sort = sp(params, "sort");
  const [data, owners] = await Promise.all([
    listAccounts(ctx, {
      q: sp(params, "q"),
      ownerId: owner === "me" || isUuid(owner) ? owner : undefined,
      status: sp(params, "status"),
      strategic: sp(params, "strategic") === "1",
      sort: sort === "created_desc" || sort === "open_pipeline_desc" ? sort : "name_asc",
      page: Number(sp(params, "page") ?? 1),
    }),
    memberOptions(ctx),
  ]);
  const exportParams = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "page"));
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Accounts"
        description="Organisations you sell to, partner with or serve."
        actions={
          <>
            {ctx.permissions.has("export:run") ? (
              <Button asChild variant="ghost">
                <a href={`/api/export/accounts?${exportParams}`}>
                  <Download /> Export
                </a>
              </Button>
            ) : null}
            {ctx.permissions.has("import:run") ? (
              <Button asChild>
                <Link href="/imports/new?entity=accounts">
                  <Upload /> Import
                </Link>
              </Button>
            ) : null}
            {ctx.permissions.has("account:write") ? (
              <Button asChild variant="primary">
                <Link href="/accounts/new">
                  <Plus /> New account
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface md:m-6">
        <FilterBar
          searchPlaceholder="Name or domain"
          filters={[
            { key: "status", label: "Any status", options: ACCOUNT_STATUSES.map((s) => ({ value: s.value, label: s.label })) },
            { key: "owner", label: "Any owner", options: [{ value: "me", label: "Me" }, ...owners.map((o) => ({ value: o.id, label: o.name }))] },
            { key: "strategic", label: "All accounts", options: [{ value: "1", label: "Strategic only" }] },
            { key: "sort", label: "Name A–Z", options: [{ value: "open_pipeline_desc", label: "Most open deals" }, { value: "created_desc", label: "Newest" }] },
          ]}
        />
        {data.total === 0 ? (
          <EmptyState icon={Building2} title="No accounts found" description="Accounts are created when you convert leads, import data, or add them directly." />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Account</TH>
                  <TH>Status</TH>
                  <TH>Industry</TH>
                  <TH>Country</TH>
                  <TH className="text-right">Open deals</TH>
                  <TH className="text-right">Contacts</TH>
                  <TH>Owner</TH>
                </tr>
              </THead>
              <TBody>
                {data.rows.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <Link href={`/accounts/${a.id}`} className="flex items-center gap-1.5 font-medium hover:text-accent">
                        {a.name}
                        {a.isStrategic ? <Star className="size-3 fill-warning text-warning" aria-label="Strategic" /> : null}
                      </Link>
                      <p className="text-[12px] text-text-3">{a.domain ?? ""}</p>
                    </TD>
                    <TD>
                      <Badge tone={a.status === "customer" ? "success" : a.status === "partner" ? "accent" : "neutral"}>
                        {ACCOUNT_STATUSES.find((s) => s.value === a.status)?.label ?? a.status}
                      </Badge>
                    </TD>
                    <TD className="text-text-2">{a.industry ?? "—"}</TD>
                    <TD className="text-text-2">{a.country ?? "—"}</TD>
                    <TD className="tabular text-right">{a.openOpportunities}</TD>
                    <TD className="tabular text-right">{a.contactCount}</TD>
                    <TD className="text-text-2">{a.ownerName ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/accounts" params={Object.fromEntries(exportParams)} />
      </div>
    </div>
  );
}

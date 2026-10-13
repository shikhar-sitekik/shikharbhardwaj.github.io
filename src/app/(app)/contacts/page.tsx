import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, Plus, Upload, Users } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { listContacts } from "@/server/services/accounts";
import { memberOptions } from "@/server/services/opportunities";
import { isUuid, sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/crm/filter-bar";
import { Pagination } from "@/components/crm/pagination";
import { BUYING_ROLE_LABELS } from "@/lib/crm-options";
import { personName, relativeTime } from "@/lib/format";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("contact:read")) notFound();
  const params = await searchParams;
  const owner = sp(params, "owner");
  const [data, owners] = await Promise.all([
    listContacts(ctx, { q: sp(params, "q"), ownerId: owner === "me" || isUuid(owner) ? owner : undefined, page: Number(sp(params, "page") ?? 1) }),
    memberOptions(ctx),
  ]);
  const keep = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "page"));
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Contacts"
        description="People at your accounts, including buying-committee roles."
        actions={
          <>
            {ctx.permissions.has("export:run") ? (
              <Button asChild variant="ghost">
                <a href={`/api/export/contacts?${keep}`}>
                  <Download /> Export
                </a>
              </Button>
            ) : null}
            {ctx.permissions.has("import:run") ? (
              <Button asChild>
                <Link href="/imports/new?entity=contacts">
                  <Upload /> Import
                </Link>
              </Button>
            ) : null}
            {ctx.permissions.has("contact:write") ? (
              <Button asChild variant="primary">
                <Link href="/contacts/new">
                  <Plus /> New contact
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface md:m-6">
        <FilterBar
          searchPlaceholder="Name or email"
          filters={[{ key: "owner", label: "Any owner", options: [{ value: "me", label: "Me" }, ...owners.map((o) => ({ value: o.id, label: o.name }))] }]}
        />
        {data.total === 0 ? (
          <EmptyState icon={Users} title="No contacts found" description="Contacts are created when leads convert, from imports, or manually." />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Account</TH>
                  <TH>Title</TH>
                  <TH>Role</TH>
                  <TH>Email</TH>
                  <TH>Owner</TH>
                  <TH>Last contacted</TH>
                </tr>
              </THead>
              <TBody>
                {data.rows.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/contacts/${c.id}`} className="font-medium hover:text-accent">
                        {personName(c.firstName, c.lastName)}
                      </Link>
                      {c.doNotContact ? <Badge tone="danger" className="ml-2">DNC</Badge> : null}
                    </TD>
                    <TD>{c.accountId ? <Link href={`/accounts/${c.accountId}`} className="hover:text-accent">{c.accountName}</Link> : <span className="text-text-3">—</span>}</TD>
                    <TD className="max-w-[220px] truncate text-text-2">{c.jobTitle ?? "—"}</TD>
                    <TD>{c.buyingRole ? <Badge>{BUYING_ROLE_LABELS[c.buyingRole]}</Badge> : <span className="text-text-3">—</span>}</TD>
                    <TD className="text-text-2">{c.email ?? "—"}</TD>
                    <TD className="text-text-2">{c.ownerName ?? "—"}</TD>
                    <TD className="text-text-3">{c.lastContactedAt ? relativeTime(c.lastContactedAt) : "Never"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/contacts" params={Object.fromEntries(keep)} />
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { queryAudit } from "@/server/services/admin";
import { isUuid, sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/crm/filter-bar";
import { Pagination } from "@/components/crm/pagination";
import { SettingsNav } from "@/components/crm/settings-nav";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("audit:read")) notFound();
  const params = await searchParams;
  const entityId = sp(params, "entityId");
  const data = await queryAudit(ctx, {
    entityType: sp(params, "entity"),
    action: sp(params, "q"),
    entityId: isUuid(entityId) ? entityId : undefined,
    page: Number(sp(params, "page") ?? 1),
  });
  const keep = Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "page"));
  return (
    <div>
      <PageHeader title="Administration" description="Append-only record of sensitive and data-changing actions. The application role cannot modify or delete entries." />
      <SettingsNav active="/settings/audit" permissions={ctx.permissions} />
      <div className="p-4 md:p-6">
        <Card>
          <FilterBar
            searchPlaceholder="Action prefix, e.g. lead. or export"
            filters={[{ key: "entity", label: "Any entity", options: ["lead", "account", "contact", "opportunity", "activity", "import", "user", "role", "tenant", "team", "leads", "accounts", "contacts", "opportunities"].map((e) => ({ value: e, label: e })) }]}
          />
          <Table>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH>Entity</TH>
                <TH>Details</TH>
              </tr>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap text-text-3">{formatDate(r.createdAt, { withTime: true, timeZone: ctx.tenant.settings.timezone })}</TD>
                  <TD>{r.actorName ?? "System"}</TD>
                  <TD className="font-mono text-[12px]">{r.action}</TD>
                  <TD className="font-mono text-[11.5px] text-text-3">
                    {r.entityType}
                    {r.entityId ? `:${r.entityId.slice(0, 8)}` : ""}
                  </TD>
                  <TD className="max-w-[420px] truncate font-mono text-[11px] text-text-3" title={JSON.stringify(r.changes)}>
                    {Object.keys(r.changes).length ? JSON.stringify(r.changes) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/settings/audit" params={keep} />
        </Card>
      </div>
    </div>
  );
}

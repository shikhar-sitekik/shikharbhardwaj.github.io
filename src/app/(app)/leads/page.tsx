import Link from "next/link";
import { Download, Inbox, Plus, Upload } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { listLeads, listLeadStatuses, type LeadFilters } from "@/server/services/leads";
import { memberOptions } from "@/server/services/opportunities";
import { bulkLeadAction } from "@/server/actions/crm";
import { isUuid, sp } from "@/server/lib/page";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/crm/filter-bar";
import { Pagination } from "@/components/crm/pagination";
import { BulkForm, SelectAll, type BulkOp } from "@/components/crm/bulk-table";
import { ScorePill } from "@/components/crm/score";
import { ContactActions } from "@/components/crm/contact-actions";
import { LEAD_SOURCES } from "@/lib/crm-options";
import { personName, relativeTime } from "@/lib/format";

export const metadata = { title: "Leads" };

const STATUS_TONE = { open: "neutral", qualified: "success", disqualified: "danger", converted: "accent" } as const;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("lead:read")) notFound();
  const params = await searchParams;
  const owner = sp(params, "owner");
  const band = sp(params, "band");
  const sort = sp(params, "sort");
  const filters: LeadFilters = {
    q: sp(params, "q"),
    statusId: isUuid(sp(params, "status")) ? sp(params, "status") : undefined,
    ownerId: owner === "me" || owner === "unassigned" || isUuid(owner) ? owner : undefined,
    source: sp(params, "source"),
    band: band === "hot" || band === "warm" || band === "cold" ? band : undefined,
    stale: sp(params, "stale") === "1",
    sort: (["created_desc", "created_asc", "score_desc", "name_asc", "last_contacted_asc"] as const).find((s) => s === sort),
    page: Number(sp(params, "page") ?? 1),
  };
  const [data, statuses, owners] = await Promise.all([listLeads(ctx, filters), listLeadStatuses(ctx), memberOptions(ctx)]);
  const thresholds = ctx.tenant.settings.scoreThresholds;

  const ops: BulkOp[] = [];
  if (ctx.permissions.has("lead:write"))
    ops.push({ op: "status", label: "Set status", options: statuses.filter((s) => s.category !== "converted").map((s) => ({ value: s.id, label: s.label })) });
  if (ctx.permissions.has("lead:assign")) ops.push({ op: "assign", label: "Assign owner", options: owners.map((o) => ({ value: o.id, label: o.name })) });
  if (ctx.permissions.has("lead:delete")) ops.push({ op: "archive", label: "Archive", danger: true });

  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (typeof v === "string" && k !== "page") exportParams.set(k, v);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Leads"
        description="People you're trying to win. Tap a lead to see everything about them."
        actions={
          <>
            {ctx.permissions.has("export:run") ? (
              <Button asChild variant="ghost">
                <a href={`/api/export/leads?${exportParams.toString()}`} className="hidden sm:inline-flex">
                  <Download /> Export
                </a>
              </Button>
            ) : null}
            {ctx.permissions.has("import:run") ? (
              <Button asChild variant="secondary">
                <Link href="/imports/new?entity=leads">
                  <Upload /> <span className="hidden sm:inline">Upload Excel</span>
                </Link>
              </Button>
            ) : null}
            {ctx.permissions.has("lead:write") ? (
              <Button asChild variant="primary">
                <Link href="/leads/new">
                  <Plus /> Add lead
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-border bg-surface md:m-6 md:rounded-lg md:border">
        <FilterBar
          searchPlaceholder="Search name, company or email"
          filters={[
            { key: "status", label: "Any status", options: statuses.map((s) => ({ value: s.id, label: s.label })) },
            { key: "owner", label: "Anyone", options: [{ value: "me", label: "Mine" }, { value: "unassigned", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.name }))] },
            { key: "source", label: "Any source", secondary: true, options: LEAD_SOURCES.map((s) => ({ value: s, label: s.replace("_", " ") })) },
            { key: "band", label: "Any score", secondary: true, options: [{ value: "hot", label: "Hot" }, { value: "warm", label: "Warm" }, { value: "cold", label: "Cold" }] },
            { key: "stale", label: "Follow-up", secondary: true, options: [{ value: "1", label: "Needs follow-up" }] },
            {
              key: "sort",
              label: "Newest first",
              secondary: true,
              options: [
                { value: "score_desc", label: "Highest score" },
                { value: "created_asc", label: "Oldest first" },
                { value: "name_asc", label: "Name A–Z" },
                { value: "last_contacted_asc", label: "Least recently contacted" },
              ],
            },
          ]}
        />
        {data.total === 0 ? (
          <EmptyState
            icon={Inbox}
            title={filters.q || filters.statusId || filters.ownerId || filters.source ? "No leads match these filters" : "No leads yet"}
            description="Add a lead, or upload an Excel sheet of your prospects."
            action={
              ctx.permissions.has("lead:write") ? (
                <div className="flex gap-2">
                  <Button asChild variant="primary">
                    <Link href="/leads/new">Add lead</Link>
                  </Button>
                  {ctx.permissions.has("import:run") ? (
                    <Button asChild>
                      <Link href="/imports/new?entity=leads">Upload Excel</Link>
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            {/* Phone layout: one card per lead with one-tap actions. */}
            <ul className="divide-y divide-border md:hidden">
              {data.rows.map((l) => {
                const name = personName(l.firstName, l.lastName);
                return (
                  <li key={l.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/leads/${l.id}`} className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{name}</p>
                        <p className="truncate text-[12.5px] text-text-3">{[l.jobTitle, l.company].filter(Boolean).join(" · ") || l.email || "—"}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={STATUS_TONE[l.statusCategory as keyof typeof STATUS_TONE] ?? "neutral"}>{l.statusLabel}</Badge>
                          <ScorePill score={l.score} thresholds={thresholds} />
                          <span className="text-[11.5px] text-text-3">{l.ownerName ?? "Unassigned"}</span>
                        </div>
                      </Link>
                      <ContactActions target={{ name, email: l.email, phone: l.phone, doNotContact: l.doNotContact, leadId: l.id }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden md:block">
              <BulkForm action={bulkLeadAction} ops={ops} formId="lead-bulk">
                <Table>
                  <THead>
                    <tr>
                      {ops.length > 0 ? (
                        <TH className="w-8">
                          <SelectAll formId="lead-bulk" />
                        </TH>
                      ) : null}
                      <TH>Name</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Score</TH>
                      <TH>Owner</TH>
                      <TH>Last contact</TH>
                      <TH className="w-[120px]">Reach out</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {data.rows.map((l) => {
                      const name = personName(l.firstName, l.lastName);
                      return (
                        <TR key={l.id}>
                          {ops.length > 0 ? (
                            <TD>
                              <input type="checkbox" name="ids" value={l.id} aria-label={`Select ${name}`} className="size-3.5 accent-[var(--accent)]" />
                            </TD>
                          ) : null}
                          <TD>
                            <Link href={`/leads/${l.id}`} className="font-medium text-text hover:text-accent">
                              {name}
                            </Link>
                            <p className="max-w-[300px] truncate text-[12px] text-text-3">{[l.jobTitle, l.company].filter(Boolean).join(" · ") || l.email || ""}</p>
                          </TD>
                          <TD>
                            <Badge tone={STATUS_TONE[l.statusCategory as keyof typeof STATUS_TONE] ?? "neutral"}>{l.statusLabel}</Badge>
                          </TD>
                          <TD className="text-right">
                            <ScorePill score={l.score} thresholds={thresholds} />
                          </TD>
                          <TD className="text-text-2">{l.ownerName ?? <span className="text-text-3">Unassigned</span>}</TD>
                          <TD className="text-text-3">{l.lastContactedAt ? relativeTime(l.lastContactedAt) : "Never"}</TD>
                          <TD>
                            <ContactActions target={{ name, email: l.email, phone: l.phone, doNotContact: l.doNotContact, leadId: l.id }} />
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </BulkForm>
            </div>
          </div>
        )}
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          basePath="/leads"
          params={Object.fromEntries(Object.entries(params).filter(([k, v]) => k !== "page" && typeof v === "string")) as Record<string, string>}
        />
      </div>
    </div>
  );
}

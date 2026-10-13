import Link from "next/link";
import { notFound } from "next/navigation";
import { Columns3, Download, KanbanSquare, Plus, Rows3 } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { listOpportunities, listPipelines, memberOptions, pipelineBoard } from "@/server/services/opportunities";
import { isUuid, sp } from "@/server/lib/page";
import { convertToBase, daysBetween } from "@/server/domain/pipeline";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/crm/filter-bar";
import { Pagination } from "@/components/crm/pagination";
import { PipelineBoard } from "@/components/crm/pipeline-board";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney, relativeTime } from "@/lib/format";

export const metadata = { title: "Opportunities" };

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("opportunity:read")) notFound();
  const params = await searchParams;
  const view = sp(params, "view") === "table" ? "table" : "board";
  const pipelines = await listPipelines(ctx);
  const pipelineParam = sp(params, "pipeline");
  const pipeline = pipelines.find((p) => p.id === pipelineParam) ?? pipelines[0];
  const owner = sp(params, "owner");
  const ownerId = owner === "me" || isUuid(owner) ? owner : undefined;
  const owners = await memberOptions(ctx);
  const { baseCurrency, fxRates, staleOpportunityDays } = ctx.tenant.settings;
  const keep = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[0] !== "page"));
  const viewHref = (v: string) => {
    const n = new URLSearchParams(keep);
    if (v === "board") n.delete("view");
    else n.set("view", v);
    const s = n.toString();
    return s ? `/opportunities?${s}` : "/opportunities";
  };

  const header = (
    <PageHeader
      title="Opportunities"
      description={pipeline ? pipeline.description ?? undefined : undefined}
      actions={
        <>
          {ctx.permissions.has("export:run") ? (
            <Button asChild variant="ghost">
              <a href={`/api/export/opportunities?${keep}`}>
                <Download /> Export
              </a>
            </Button>
          ) : null}
          {ctx.permissions.has("opportunity:write") ? (
            <Button asChild variant="primary">
              <Link href={`/opportunities/new${pipeline ? `?pipelineId=${pipeline.id}` : ""}`}>
                <Plus /> New opportunity
              </Link>
            </Button>
          ) : null}
        </>
      }
    />
  );

  const filterBar = (
    <FilterBar
      searchPlaceholder="Opportunity name"
      filters={[
        { key: "pipeline", label: pipeline?.name ?? "Pipeline", options: pipelines.filter((p) => p.id !== pipeline?.id).map((p) => ({ value: p.id, label: p.name })) },
        { key: "owner", label: "Any owner", options: [{ value: "me", label: "Me" }, ...owners.map((o) => ({ value: o.id, label: o.name }))] },
        ...(view === "table"
          ? [
              { key: "status", label: "Any status", options: [{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }] },
              { key: "sort", label: "Close date", options: [{ value: "amount_desc", label: "Largest first" }, { value: "updated_desc", label: "Recently updated" }, { value: "created_desc", label: "Newest" }] },
            ]
          : []),
      ]}
    >
      <div className="flex overflow-hidden rounded-md border border-border" role="group" aria-label="View">
        <Link href={viewHref("board")} aria-current={view === "board" ? "page" : undefined} className={cn("flex h-7 items-center gap-1 px-2 text-[12px]", view === "board" ? "bg-accent-soft text-accent" : "text-text-3 hover:bg-surface-hover")}>
          <Columns3 className="size-3.5" /> Board
        </Link>
        <Link href={viewHref("table")} aria-current={view === "table" ? "page" : undefined} className={cn("flex h-7 items-center gap-1 border-l border-border px-2 text-[12px]", view === "table" ? "bg-accent-soft text-accent" : "text-text-3 hover:bg-surface-hover")}>
          <Rows3 className="size-3.5" /> Table
        </Link>
      </div>
    </FilterBar>
  );

  if (!pipeline) {
    return (
      <div>
        {header}
        <EmptyState icon={KanbanSquare} title="No pipelines configured" description="An administrator needs to configure at least one pipeline." />
      </div>
    );
  }

  if (view === "board") {
    const board = await pipelineBoard(ctx, pipeline.id, { ownerId, q: sp(params, "q") });
    const now = new Date();
    const cards = board.rows.map((r) => ({
      id: r.id,
      name: r.name,
      accountName: r.accountName,
      ownerName: r.ownerName,
      stageId: r.stageId,
      amount: r.amount,
      currency: r.currency,
      baseAmount: convertToBase(r.amount, r.currency, baseCurrency, fxRates),
      probability: r.probability,
      expectedCloseDate: r.expectedCloseDate,
      daysInStage: daysBetween(new Date(r.stageEnteredAt), now),
      stale: r.stageCategory === "open" && daysBetween(new Date(r.lastActivityAt ?? r.stageEnteredAt), now) > staleOpportunityDays,
    }));
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="border-b border-border bg-surface">{filterBar}</div>
        <div className="min-h-0 flex-1">
          <PipelineBoard
            stages={board.stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability, category: s.category, requiredFields: s.requiredFields }))}
            cards={cards}
            baseCurrency={baseCurrency}
          />
        </div>
      </div>
    );
  }

  const status = sp(params, "status");
  const sort = sp(params, "sort");
  const data = await listOpportunities(ctx, {
    q: sp(params, "q"),
    pipelineId: pipeline.id,
    ownerId,
    status: status === "open" || status === "won" || status === "lost" ? status : undefined,
    sort: sort === "amount_desc" || sort === "updated_desc" || sort === "created_desc" ? sort : "close_asc",
    page: Number(sp(params, "page") ?? 1),
  });
  return (
    <div className="flex h-full flex-col">
      {header}
      <div className="m-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface md:m-6">
        {filterBar}
        {data.total === 0 ? (
          <EmptyState icon={KanbanSquare} title="No opportunities match" />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <Table>
              <THead>
                <tr>
                  <TH>Opportunity</TH>
                  <TH>Stage</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Prob.</TH>
                  <TH>Close date</TH>
                  <TH>Forecast</TH>
                  <TH>Owner</TH>
                  <TH>Last activity</TH>
                </tr>
              </THead>
              <TBody>
                {data.rows.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link href={`/opportunities/${o.id}`} className="font-medium hover:text-accent">
                        {o.name}
                      </Link>
                      <p className="text-[12px] text-text-3">{o.accountName}</p>
                    </TD>
                    <TD>
                      <Badge tone={o.stageCategory === "won" ? "success" : o.stageCategory === "lost" ? "danger" : "neutral"}>{o.stageName}</Badge>
                    </TD>
                    <TD className="tabular text-right font-medium">{formatMoney(o.amount, o.currency)}</TD>
                    <TD className="tabular text-right text-text-2">{o.probability}%</TD>
                    <TD className="text-text-2">{formatDate(o.expectedCloseDate)}</TD>
                    <TD className="text-text-2 capitalize">{o.forecastCategory.replace("_", " ")}</TD>
                    <TD className="text-text-2">{o.ownerName ?? "—"}</TD>
                    <TD className="text-text-3">{o.lastActivityAt ? relativeTime(new Date(o.lastActivityAt)) : "None"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/opportunities" params={Object.fromEntries(keep)} />
      </div>
    </div>
  );
}

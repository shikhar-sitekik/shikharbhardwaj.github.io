import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { executiveMetrics, resolvePeriod } from "@/server/services/metrics";
import { listPipelines } from "@/server/services/opportunities";
import { sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Stat } from "@/components/crm/stat";
import { HBarChart } from "@/components/crm/bar-chart";
import { FilterBar } from "@/components/crm/filter-bar";
import { formatMoney, formatPercent } from "@/lib/format";

export const metadata = { title: "Executive overview" };


export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("report:read")) notFound();
  const params = await searchParams;
  const pipelines = await listPipelines(ctx);
  const pipeline = pipelines.find((p) => p.id === sp(params, "pipeline"));
  const period = resolvePeriod(sp(params, "period"));
  const m = await executiveMetrics(ctx, pipeline?.id, period);
  const cur = m.baseCurrency;
  const scopeNote = ctx.dataScope === "all" ? "All records" : ctx.dataScope === "team" ? "Your team's records" : "Your records";

  return (
    <div>
      <PageHeader
        title="Executive overview"
        description={`${period.label} · ${pipeline?.name ?? "All pipelines"} · ${scopeNote} · values in ${cur}`}
        actions={<Link href="/reports" className="text-[12.5px] text-accent hover:underline">Metric definitions →</Link>}
      />
      <div className="border-b border-border bg-surface">
        <FilterBar
          searchPlaceholder="(filters apply to all tiles)"
          filters={[
            { key: "period", label: "This quarter", options: [{ value: "last_quarter", label: "Last quarter" }, { value: "ytd", label: "Year to date" }, { value: "last_year", label: "Last year" }] },
            { key: "pipeline", label: "All pipelines", options: pipelines.map((p) => ({ value: p.id, label: p.name })) },
          ]}
        />
      </div>
      <div className="grid gap-4 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open pipeline" value={formatMoney(m.openPipeline, cur, { compact: true })} hint={`${m.openCount} open opportunities`} href="/opportunities?view=table&status=open" />
          <Stat label="Weighted pipeline" value={formatMoney(m.weightedPipeline, cur, { compact: true })} hint="Σ amount × probability" />
          <Stat label={`Closed-won · ${period.label}`} value={formatMoney(m.closedWon, cur, { compact: true })} hint={`${m.wonCount} won · ${m.lostCount} lost`} tone="accent" />
          <Stat label="Win rate" value={formatPercent(m.winRate)} hint={m.winRate === null ? "No closed deals in period" : "Won ÷ (won + lost), by count"} />
          <Stat label="Average deal size (won)" value={m.avgDealSize === null ? "—" : formatMoney(m.avgDealSize, cur, { compact: true })} />
          <Stat label="Average sales cycle" value={m.avgSalesCycleDays === null ? "—" : `${Math.round(m.avgSalesCycleDays)} days`} hint="Created → closed-won" />
          <Stat label={`New leads · ${period.label}`} value={m.newLeads} href="/leads" />
          <Stat label="Lead → converted" value={m.newLeads ? formatPercent(m.convertedLeads / m.newLeads) : "—"} hint={`${m.convertedLeads} of ${m.newLeads} leads created in period`} />
        </div>
        {m.unconverted > 0 ? (
          <p className="text-[12px] text-warning">
            {m.unconverted} opportunity group(s) use currencies without a configured FX rate and are excluded from totals. Configure FX rates in Administration.
          </p>
        ) : null}
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Open pipeline by stage" description={`Total value in ${cur}; hover for weighted value`} />
            {m.byStage.length === 0 ? (
              <EmptyState icon={BarChart3} title="No open pipeline" />
            ) : (
              <HBarChart format="money" secondaryLabel="Weighted" data={m.byStage.map((s) => ({ label: s.stageName, value: s.value, secondary: s.weighted, count: s.count }))} />
            )}
          </Card>
          <Card>
            <CardHeader title="Leads by source" description={`Created in ${period.label}`} />
            {m.bySource.length === 0 ? (
              <EmptyState icon={BarChart3} title="No leads in this period" />
            ) : (
              <HBarChart format="number" data={m.bySource.map((s) => ({ label: s.source.replace("_", " "), value: s.leads }))} />
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Pipeline by owner" description={`Open and weighted pipeline; closed-won in ${period.label}`} />
          {m.byOwner.length === 0 ? (
            <EmptyState title="No opportunities" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Owner</TH>
                  <TH className="text-right">Open pipeline</TH>
                  <TH className="text-right">Weighted</TH>
                  <TH className="text-right">Closed-won</TH>
                </tr>
              </THead>
              <TBody>
                {m.byOwner.map((o) => (
                  <TR key={o.ownerName}>
                    <TD className="font-medium">{o.ownerName}</TD>
                    <TD className="tabular text-right">{formatMoney(o.open, cur)}</TD>
                    <TD className="tabular text-right">{formatMoney(o.weighted, cur)}</TD>
                    <TD className="tabular text-right">{formatMoney(o.won, cur)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

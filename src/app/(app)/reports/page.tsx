import { notFound } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import { executiveMetrics, forecastReport, lossReasonReport, resolvePeriod } from "@/server/services/metrics";
import { sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/crm/filter-bar";
import { formatMoney, formatPercent } from "@/lib/format";

export const metadata = { title: "Reports" };

const DEFINITIONS: [string, string][] = [
  ["Pipeline (open)", "Sum of amount for non-archived opportunities in stages of category “open”. Amount is total contract value (TCV)."],
  ["Weighted pipeline", "Σ amount × effective probability ÷ 100. Effective probability is the deal's override if set, otherwise its stage probability."],
  ["Closed-won (bookings)", "Sum of amount for opportunities moved to a “won” stage with closed date inside the period. Not recognised revenue and not cash collected."],
  ["ARR", "For recurring deals with a contract term: TCV ÷ months × 12. Recurring deals without a term show ARR as unknown, never estimated. One-time deals have ARR 0."],
  ["Win rate", "Won ÷ (won + lost) by count, for opportunities closed inside the period."],
  ["Sales cycle", "Mean days from opportunity creation to close, for deals won inside the period."],
  ["Forecast category", "Set per deal, or derived from stage: won → closed; lost → omitted; ≥75% → commit; ≥40% → best case; otherwise pipeline."],
  ["Currency", "Totals are shown in the workspace base currency using administrator-maintained FX rates. Deals without a rate are excluded and counted, never mixed."],
  ["Scope", "Every figure respects your role's record access (own, team or all)."],
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("report:read")) notFound();
  const period = resolvePeriod(sp(await searchParams, "period"));
  const [forecast, losses, m] = await Promise.all([forecastReport(ctx, period), lossReasonReport(ctx, period), executiveMetrics(ctx, undefined, period)]);
  const cur = ctx.tenant.settings.baseCurrency;
  return (
    <div>
      <PageHeader title="Reports" description={`${period.label} · values in ${cur}. Built from live records; exports are available from each list view.`} />
      <div className="border-b border-border bg-surface">
        <FilterBar searchPlaceholder="(period applies to all reports)" filters={[{ key: "period", label: "This quarter", options: [{ value: "last_quarter", label: "Last quarter" }, { value: "ytd", label: "Year to date" }, { value: "last_year", label: "Last year" }] }]} />
      </div>
      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Forecast by category" description="Deals expected to close (or closed-won) in the period" />
          <Table>
            <THead>
              <tr>
                <TH>Category</TH>
                <TH className="text-right">Deals</TH>
                <TH className="text-right">Value</TH>
                <TH className="text-right">Weighted</TH>
              </tr>
            </THead>
            <TBody>
              {forecast.rows.map((r) => (
                <TR key={r.category}>
                  <TD className="capitalize">{r.category.replace("_", " ")}</TD>
                  <TD className="tabular text-right">{r.count}</TD>
                  <TD className="tabular text-right">{formatMoney(r.value, cur)}</TD>
                  <TD className="tabular text-right">{formatMoney(r.weighted, cur)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {forecast.unconverted ? <p className="px-4 py-2 text-[12px] text-warning">{forecast.unconverted} deal group(s) excluded: no FX rate.</p> : null}
        </Card>
        <Card>
          <CardHeader title="Lead source performance" description="Leads created in the period and how many have converted" />
          {m.bySource.length === 0 ? (
            <EmptyState title="No leads in this period" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Source</TH>
                  <TH className="text-right">Leads</TH>
                  <TH className="text-right">Converted</TH>
                  <TH className="text-right">Conversion</TH>
                </tr>
              </THead>
              <TBody>
                {m.bySource.map((s) => (
                  <TR key={s.source}>
                    <TD className="capitalize">{s.source.replace("_", " ")}</TD>
                    <TD className="tabular text-right">{s.leads}</TD>
                    <TD className="tabular text-right">{s.converted}</TD>
                    <TD className="tabular text-right">{formatPercent(s.leads ? s.converted / s.leads : null)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Loss reasons" description="Deals lost in the period" />
          {losses.length === 0 ? (
            <EmptyState title="No lost deals in this period" />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Reason</TH>
                  <TH className="text-right">Deals</TH>
                </tr>
              </THead>
              <TBody>
                {losses.map((l) => (
                  <TR key={l.reason}>
                    <TD className="first-letter:uppercase">{l.reason}</TD>
                    <TD className="tabular text-right">{l.n}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="Metric definitions" description="Used consistently across dashboards, reports and exports" />
          <dl className="divide-y divide-border">
            {DEFINITIONS.map(([k, v]) => (
              <div key={k} className="grid gap-0.5 px-4 py-2">
                <dt className="text-[12.5px] font-medium">{k}</dt>
                <dd className="text-[12.5px] text-text-2">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  );
}

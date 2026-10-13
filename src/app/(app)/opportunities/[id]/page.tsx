import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, Pencil, Trash2 } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { getOpportunity } from "@/server/services/opportunities";
import { contactOptions } from "@/server/services/accounts";
import { timelineFor } from "@/server/services/activities";
import { recordHistory } from "@/server/services/admin";
import { recordView } from "@/server/services/search";
import { archiveOpportunityAction } from "@/server/actions/crm";
import { loadOr404, sp } from "@/server/lib/page";
import { OPPORTUNITY_FIELD_LABELS, annualRecurringRevenue, daysBetween, effectiveProbability, missingRequiredFields } from "@/server/domain/pipeline";
import { inspectDeal } from "@/server/domain/inspection";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TabsNav } from "@/components/ui/tabs-nav";
import { FieldList } from "@/components/crm/fields";
import { Timeline } from "@/components/crm/timeline";
import { ActivityComposer } from "@/components/crm/activity-composer";
import { RecordHistory } from "@/components/crm/history";
import { StagePath } from "@/components/crm/stage-path";
import { CommitteeForm } from "@/components/crm/committee-form";
import { ConfirmAction } from "@/components/crm/confirm-action";
import { Stat } from "@/components/crm/stat";
import { BUYING_ROLE_LABELS } from "@/lib/crm-options";
import { formatDate, formatMoney, personName } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Opportunity" };

export default async function OpportunityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const tab = sp(await searchParams, "tab") ?? "activity";
  const d = await loadOr404(() => getOpportunity(ctx, id));
  const o = d.opportunity;
  const tz = ctx.tenant.settings.timezone;
  const canEdit = ctx.permissions.has("opportunity:write");
  const [timeline, history, accountContacts] = await Promise.all([
    ctx.permissions.has("activity:read") ? timelineFor(ctx, { type: "opportunity", id }) : Promise.resolve([]),
    tab === "history" ? recordHistory(ctx, "opportunity", id) : Promise.resolve([]),
    canEdit && ctx.permissions.has("contact:read") ? contactOptions(ctx, o.accountId) : Promise.resolve([]),
    recordView(ctx, "opportunity", id, o.name),
  ]);
  const tasks = timeline.filter((x) => x.type === "task" && !x.completedAt);
  const stage = d.stage;
  const probability = effectiveProbability(stage?.probability ?? 0, o.probabilityOverride);
  const arr = annualRecurringRevenue({ amount: o.amount, currency: o.currency, revenueType: o.revenueType, contractMonths: o.contractMonths });
  const now = new Date();
  const lastActivity = timeline.filter((t) => t.type !== "task").map((t) => t.occurredAt ?? t.createdAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const nextStage = d.stages.find((s) => s.category === "open" && s.position > (stage?.position ?? 0));
  const closeDates = d.history.map((h) => h.expectedCloseDate).filter((x): x is string => !!x);
  const closeDateChanges = closeDates.reduce((n, cur, i) => (i > 0 && cur !== closeDates[i - 1] ? n + 1 : n), 0);
  const signals = inspectDeal({
    now,
    stageCategory: stage?.category ?? "open",
    daysInStage: daysBetween(o.stageEnteredAt, now),
    staleDays: ctx.tenant.settings.staleOpportunityDays,
    lastActivityAt: lastActivity,
    expectedCloseDate: o.expectedCloseDate,
    nextStep: o.nextStep,
    openTasks: tasks.length,
    committeeRoles: d.committee.map((c) => c.role),
    committeeSize: d.committee.length,
    nextStageMissing: nextStage ? missingRequiredFields(nextStage.requiredFields, o).map((f) => OPPORTUNITY_FIELD_LABELS[f] ?? f) : [],
    closeDateChanges,
    amount: Number(o.amount),
  });
  const stageName = (sid: string | null) => d.stages.find((s) => s.id === sid)?.name ?? "—";

  return (
    <div>
      <PageHeader
        title={o.name}
        description={
          <>
            <Link href={`/accounts/${o.accountId}`} className="text-accent hover:underline">
              {d.account?.name}
            </Link>
            {" · "}
            {d.pipeline?.name}
          </>
        }
        crumbs={[{ label: "Opportunities", href: "/opportunities" }, { label: o.name }]}
        meta={
          <>
            <Badge tone={stage?.category === "won" ? "success" : stage?.category === "lost" ? "danger" : "accent"}>{stage?.name}</Badge>
            <Badge className="capitalize">{o.forecastCategory.replace("_", " ")}</Badge>
            <span className="text-[12px] text-text-3">Owner: {d.owner?.name ?? "—"}</span>
          </>
        }
        actions={
          <>
            {ctx.permissions.has("opportunity:delete") ? (
              <ConfirmAction action={archiveOpportunityAction.bind(null, id)} label={<><Trash2 /> Archive</>} title="Archive opportunity?" description="It will be removed from pipeline, forecasts and reports. History is retained in the audit log." confirmLabel="Archive" />
            ) : null}
            {canEdit ? (
              <Button asChild>
                <Link href={`/opportunities/${id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 p-4 md:p-6">
        <StagePath
          opportunity={{ id, name: o.name, stageId: o.stageId, amount: o.amount, expectedCloseDate: o.expectedCloseDate }}
          stages={d.stages.map((s) => ({ id: s.id, name: s.name, category: s.category, requiredFields: s.requiredFields, probability: s.probability }))}
          canEdit={canEdit}
        />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Amount (TCV)" value={formatMoney(o.amount, o.currency)} hint={o.revenueType === "recurring" ? `ARR ${arr === null ? "unknown (no term)" : formatMoney(arr, o.currency)}` : "One-time"} />
          <Stat label="Probability" value={`${probability}%`} hint={o.probabilityOverride !== null ? `Override (stage ${stage?.probability}%)` : "Stage default"} />
          <Stat label="Weighted" value={formatMoney((Number(o.amount) * probability) / 100, o.currency)} />
          <Stat label="Expected close" value={o.expectedCloseDate ? formatDate(o.expectedCloseDate) : "—"} hint={`${daysBetween(o.stageEnteredAt, now)} days in stage`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0">
            <TabsNav
              basePath={`/opportunities/${id}`}
              active={tab}
              tabs={[
                { key: "activity", label: "Activity", count: timeline.length },
                { key: "details", label: "Deal context" },
                { key: "stages", label: "Stage history", count: d.history.length },
                { key: "history", label: "Field history" },
              ]}
            />
            {tab === "details" ? (
              <FieldList
                items={[
                  ["Next step", o.nextStep],
                  ["Decision criteria", o.decisionCriteria ? <span className="whitespace-pre-wrap">{o.decisionCriteria}</span> : null],
                  ["Risks & dependencies", o.risks ? <span className="whitespace-pre-wrap">{o.risks}</span> : null],
                  ["Technical requirements", o.technicalRequirements ? <span className="whitespace-pre-wrap">{o.technicalRequirements}</span> : null],
                  ["Procurement requirements", o.procurementRequirements ? <span className="whitespace-pre-wrap">{o.procurementRequirements}</span> : null],
                  ["Competitors", o.competitors.length ? o.competitors.join(", ") : null],
                  ["Source", o.source],
                  ["Revenue type", o.revenueType === "recurring" ? `Recurring${o.contractMonths ? ` · ${o.contractMonths} months` : ""}` : "One-time"],
                  ["Estimated start", formatDate(o.estimatedStartDate)],
                  ["Loss reason", o.lossReason],
                  ["Created", formatDate(o.createdAt, { timeZone: tz })],
                  ["Closed", o.closedAt ? formatDate(o.closedAt, { timeZone: tz }) : null],
                  ["Source lead", o.sourceLeadId ? <Link className="text-accent hover:underline" href={`/leads/${o.sourceLeadId}`}>View lead</Link> : null],
                ]}
              />
            ) : tab === "stages" ? (
              <ul className="divide-y divide-border">
                {d.history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[12.5px]">
                    <span>
                      {h.fromStageId ? `${stageName(h.fromStageId)} → ` : "Created in "}
                      <span className="font-medium">{stageName(h.toStageId)}</span>
                    </span>
                    <span className="tabular text-text-3">
                      {formatMoney(h.amount, h.currency, { compact: true })} · close {formatDate(h.expectedCloseDate)} · {h.changedBy ?? "System"} · {formatDate(h.changedAt, { withTime: true, timeZone: tz })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : tab === "history" ? (
              <RecordHistory entries={history} timeZone={tz} />
            ) : (
              <>
                {ctx.permissions.has("activity:write") ? <ActivityComposer related={{ opportunityId: id, accountId: o.accountId }} revalidate={`/opportunities/${id}`} /> : null}
                <Timeline items={timeline} timeZone={tz} />
              </>
            )}
          </Card>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader title="Deal inspection" description="Rule-based checks on recorded data" />
              {stage?.category !== "open" ? (
                <p className="px-4 py-3 text-[12.5px] text-text-3">This deal is closed.</p>
              ) : signals.length === 0 ? (
                <EmptyState icon={CheckCircle2} title="No issues detected" className="py-6" />
              ) : (
                <ul className="divide-y divide-border">
                  {signals.map((s) => (
                    <li key={s.key} className="flex gap-2.5 px-4 py-2">
                      {s.severity === "risk" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" /> : s.severity === "warning" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /> : <Info className="mt-0.5 size-3.5 shrink-0 text-accent" />}
                      <div>
                        <p className={cn("text-[12.5px] font-medium", s.severity === "risk" && "text-danger")}>{s.label}</p>
                        <p className="text-[12px] text-text-3">{s.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardHeader title="Buying committee" description={`${d.committee.length} contact${d.committee.length === 1 ? "" : "s"}`} />
              {d.committee.length === 0 ? (
                <p className="px-4 py-3 text-[12.5px] text-text-3">No contacts linked to this deal yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {d.committee.map((c) => (
                    <li key={c.contactId} className="flex items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <Link href={`/contacts/${c.contactId}`} className="block truncate font-medium hover:text-accent">
                          {personName(c.firstName, c.lastName)}
                          {c.isPrimary ? <span className="ml-1.5 text-[11px] font-normal text-text-3">Primary</span> : null}
                        </Link>
                        <p className="truncate text-[12px] text-text-3">{c.jobTitle ?? c.email ?? ""}</p>
                      </div>
                      <Badge tone={c.role === "blocker" ? "danger" : c.role === "champion" || c.role === "decision_maker" ? "success" : "neutral"}>{BUYING_ROLE_LABELS[c.role]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? <CommitteeForm opportunityId={id} contacts={accountContacts.map((c) => ({ id: c.id, name: personName(c.firstName, c.lastName) }))} /> : null}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

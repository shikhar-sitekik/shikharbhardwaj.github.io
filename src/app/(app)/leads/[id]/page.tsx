import Link from "next/link";
import { Pencil } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { findDuplicates, getLead } from "@/server/services/leads";
import { accountOptions } from "@/server/services/accounts";
import { listPipelines } from "@/server/services/opportunities";
import { timelineFor } from "@/server/services/activities";
import { recordHistory } from "@/server/services/admin";
import { recordView } from "@/server/services/search";
import { CURRENCIES } from "@/server/domain/normalize";
import { withScope } from "@/server/db/client";
import { leads as leadsTable } from "@/server/db/schema";
import { inArray } from "drizzle-orm";
import { loadOr404, sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { TabsNav } from "@/components/ui/tabs-nav";
import { FieldList } from "@/components/crm/fields";
import { Timeline } from "@/components/crm/timeline";
import { ActivityComposer } from "@/components/crm/activity-composer";
import { RecordHistory } from "@/components/crm/history";
import { ScorePill } from "@/components/crm/score";
import { ConvertLeadDialog } from "@/components/crm/convert-lead-dialog";
import { MergeLeadDialog } from "@/components/crm/merge-lead-dialog";
import { ContactActions } from "@/components/crm/contact-actions";
import { formatDate, formatMoney, personName, relativeTime } from "@/lib/format";

export const metadata = { title: "Lead" };

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const tab = sp(await searchParams, "tab") ?? "activity";
  const { lead, status, owner } = await loadOr404(() => getLead(ctx, id));
  const name = personName(lead.firstName, lead.lastName);
  const tz = ctx.tenant.settings.timezone;
  const converted = !!lead.convertedAt;
  const canWrite = ctx.permissions.has("lead:write") && !converted;
  const canConvert = !converted && ctx.permissions.has("lead:convert") && ctx.permissions.has("account:write") && ctx.permissions.has("contact:write");

  const [timeline, history, dupes, accounts, pipelines] = await Promise.all([
    timelineFor(ctx, { type: "lead", id }),
    tab === "history" ? recordHistory(ctx, "lead", id) : Promise.resolve([]),
    converted ? Promise.resolve([]) : findDuplicates(ctx, { email: lead.email, phone: lead.phone, website: lead.domain, excludeLeadId: id }),
    canConvert ? accountOptions(ctx) : Promise.resolve([]),
    canConvert ? listPipelines(ctx) : Promise.resolve([]),
    recordView(ctx, "lead", id, name),
  ]);
  const leadDupes = dupes.filter((d) => d.entityType === "lead");
  const matchingAccount = dupes.find((d) => d.entityType === "account");
  const dupeRows =
    leadDupes.length && canWrite && ctx.permissions.has("lead:delete")
      ? await withScope(ctx, (tx) => tx.select().from(leadsTable).where(inArray(leadsTable.id, leadDupes.map((d) => d.id))))
      : [];
  const asValues = (l: typeof lead) => ({
    firstName: l.firstName,
    lastName: l.lastName,
    email: l.email,
    phone: l.phone,
    jobTitle: l.jobTitle,
    company: l.company,
    website: l.website,
    industry: l.industry,
    country: l.country,
    source: l.source,
    productInterest: l.productInterest,
    businessProblem: l.businessProblem,
  });
  const rules = ctx.tenant.settings.scoringRules;

  return (
    <div>
      <PageHeader
        title={name}
        description={[lead.jobTitle, lead.company].filter(Boolean).join(" · ") || undefined}
        crumbs={[{ label: "Leads", href: "/leads" }, { label: name }]}
        meta={
          <>
            <Badge tone={status?.category === "qualified" ? "success" : status?.category === "disqualified" ? "danger" : status?.category === "converted" ? "accent" : "neutral"}>
              {status?.label}
            </Badge>
            <ScorePill score={lead.score} thresholds={ctx.tenant.settings.scoreThresholds} />
            <span className="text-[12px] text-text-3">Owner: {owner?.name ?? "Unassigned"}</span>
            {lead.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
          </>
        }
        actions={
          <>
            <ContactActions variant="full" target={{ name, email: lead.email, phone: lead.phone, doNotContact: lead.doNotContact, leadId: id }} />
            {dupeRows.length > 0 ? (
              <MergeLeadDialog
                targetId={id}
                target={asValues(lead)}
                candidates={dupeRows.map((d) => ({ id: d.id, label: `${personName(d.firstName, d.lastName)}${d.email ? ` <${d.email}>` : ""}`, values: asValues(d) }))}
              />
            ) : null}
            {canWrite ? (
              <Button asChild>
                <Link href={`/leads/${id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            ) : null}
            {canConvert ? (
              <ConvertLeadDialog
                leadId={id}
                defaults={{
                  accountName: lead.company ?? "",
                  opportunityName: lead.company ? `${lead.company} – ${lead.productInterest ?? "New opportunity"}` : "",
                  amount: lead.estimatedValue ?? "",
                  currency: lead.currency ?? ctx.tenant.settings.baseCurrency,
                }}
                matchingAccount={matchingAccount ? { id: matchingAccount.id, name: matchingAccount.label } : null}
                accounts={accounts}
                pipelines={pipelines}
                currencies={CURRENCIES}
              />
            ) : null}
          </>
        }
      />
      {converted ? (
        <div className="mx-4 mt-4 rounded-md border border-accent/30 bg-accent-soft px-4 py-2.5 text-[12.5px] text-accent md:mx-6">
          Converted {formatDate(lead.convertedAt, { timeZone: tz })}.{" "}
          {lead.convertedAccountId ? (
            <Link className="font-medium underline" href={`/accounts/${lead.convertedAccountId}`}>
              Account
            </Link>
          ) : null}
          {lead.convertedContactId ? (
            <>
              {" · "}
              <Link className="font-medium underline" href={`/contacts/${lead.convertedContactId}`}>
                Contact
              </Link>
            </>
          ) : null}
          {lead.convertedOpportunityId ? (
            <>
              {" · "}
              <Link className="font-medium underline" href={`/opportunities/${lead.convertedOpportunityId}`}>
                Opportunity
              </Link>
            </>
          ) : null}
        </div>
      ) : null}
      {dupes.length > 0 && !converted ? (
        <div className="mx-4 mt-4 rounded-md border border-warning/30 bg-warning-soft px-4 py-2.5 text-[12.5px] text-warning md:mx-6">
          Possible duplicates:{" "}
          {dupes.map((d, i) => (
            <span key={`${d.entityType}-${d.id}`}>
              {i > 0 ? ", " : ""}
              <Link className="font-medium underline" href={`/${d.entityType}s/${d.id}`}>
                {d.label}
              </Link>{" "}
              ({d.entityType}, matched on {d.reason})
            </span>
          ))}
        </div>
      ) : null}
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <TabsNav
            basePath={`/leads/${id}`}
            active={tab}
            tabs={[
              { key: "activity", label: "Activity", count: timeline.length },
              { key: "history", label: "Field history" },
            ]}
          />
          {tab === "history" ? (
            <RecordHistory entries={history} timeZone={tz} />
          ) : (
            <>
              {ctx.permissions.has("activity:write") ? <ActivityComposer related={{ leadId: id }} revalidate={`/leads/${id}`} /> : null}
              <Timeline items={timeline} timeZone={tz} />
            </>
          )}
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Details" />
            <FieldList
              items={[
                ["Email", lead.email ? <a href={`mailto:${lead.email}`} className="text-accent hover:underline">{lead.email}</a> : null],
                ["Phone", lead.phone],
                ["Company", lead.company],
                ["Website", lead.domain],
                ["Industry", lead.industry],
                ["Employees", lead.employeeRange],
                ["Country", lead.country],
                ["Source", lead.source ? `${lead.source}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ""}` : null],
                ["Interest", lead.productInterest],
                ["Est. value", lead.estimatedValue ? formatMoney(lead.estimatedValue, lead.currency ?? ctx.tenant.settings.baseCurrency) : null],
                ["Email consent", lead.consentEmail ? "Yes" : "No"],
                ["Last contacted", lead.lastContactedAt ? relativeTime(lead.lastContactedAt) : "Never"],
                ["Created", formatDate(lead.createdAt, { timeZone: tz })],
              ]}
            />
            {lead.businessProblem ? (
              <div className="border-t border-border px-4 py-3">
                <p className="mb-1 text-[12px] text-text-3">Business problem</p>
                <p className="text-[13px] whitespace-pre-wrap">{lead.businessProblem}</p>
              </div>
            ) : null}
          </Card>
          <Card>
            <CardHeader title="Score breakdown" description="Deterministic rules configured by administrators" />
            <ul className="divide-y divide-border">
              {rules.map((r) => {
                const pts = lead.scoreBreakdown[r.id];
                return (
                  <li key={r.id} className="flex items-center justify-between px-4 py-1.5 text-[12.5px]">
                    <span className={pts ? "text-text" : "text-text-3"}>{r.label}</span>
                    <span className={`tabular ${pts ? "font-medium text-success" : "text-text-3"}`}>{pts ? `+${pts}` : "0"}</span>
                  </li>
                );
              })}
              <li className="flex items-center justify-between px-4 py-2 text-[12.5px] font-medium">
                <span>Total (capped at 100)</span>
                <span className="tabular">{lead.score}</span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

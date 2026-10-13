import Link from "next/link";
import { Pencil, Plus, Star, Trash2, UserPlus, Users } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { getAccount } from "@/server/services/accounts";
import { timelineFor } from "@/server/services/activities";
import { recordHistory } from "@/server/services/admin";
import { recordView } from "@/server/services/search";
import { archiveAccountAction } from "@/server/actions/crm";
import { loadOr404, sp } from "@/server/lib/page";
import { convertToBase, effectiveProbability } from "@/server/domain/pipeline";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TabsNav } from "@/components/ui/tabs-nav";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FieldList } from "@/components/crm/fields";
import { Timeline } from "@/components/crm/timeline";
import { ActivityComposer } from "@/components/crm/activity-composer";
import { RecordHistory } from "@/components/crm/history";
import { Stat } from "@/components/crm/stat";
import { ConfirmAction } from "@/components/crm/confirm-action";
import { ACCOUNT_STATUSES, BUYING_ROLE_LABELS } from "@/lib/crm-options";
import { formatDate, formatMoney, personName, relativeTime } from "@/lib/format";

export const metadata = { title: "Account" };

const COMMITTEE_ROLES = ["decision_maker", "economic_buyer", "champion", "influencer", "evaluator", "procurement", "blocker"] as const;

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const tab = sp(await searchParams, "tab") ?? "overview";
  const data = await loadOr404(() => getAccount(ctx, id));
  const { account } = data;
  const tz = ctx.tenant.settings.timezone;
  const { baseCurrency, fxRates } = ctx.tenant.settings;
  const [timeline, history] = await Promise.all([
    ctx.permissions.has("activity:read") ? timelineFor(ctx, { type: "account", id }) : Promise.resolve([]),
    tab === "history" ? recordHistory(ctx, "account", id) : Promise.resolve([]),
    recordView(ctx, "account", id, account.name),
  ]);

  const open = data.opportunities.filter((o) => o.stageCategory === "open");
  const won = data.opportunities.filter((o) => o.stageCategory === "won");
  let openValue = 0;
  let weighted = 0;
  let wonValue = 0;
  let unconverted = 0;
  for (const o of open) {
    const v = convertToBase(o.amount, o.currency, baseCurrency, fxRates);
    if (v === null) unconverted += 1;
    else {
      openValue += v;
      weighted += (v * effectiveProbability(o.probability, o.probabilityOverride)) / 100;
    }
  }
  for (const o of won) {
    const v = convertToBase(o.amount, o.currency, baseCurrency, fxRates);
    if (v === null) unconverted += 1;
    else wonValue += v;
  }
  // Buying-committee coverage across this account's opportunities.
  const roleCoverage = new Map<string, Set<string>>();
  for (const c of data.committee) {
    const set = roleCoverage.get(c.role) ?? new Set<string>();
    set.add(c.contactId);
    roleCoverage.set(c.role, set);
  }
  const contactRole = new Map(data.committee.map((c) => [c.contactId, c.role]));
  const missingRoles = open.length > 0 ? COMMITTEE_ROLES.filter((r) => ["decision_maker", "economic_buyer", "champion"].includes(r) && !roleCoverage.has(r)) : [];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {account.name}
            {account.isStrategic ? <Star className="size-4 fill-warning text-warning" aria-label="Strategic account" /> : null}
          </span>
        }
        description={[account.industry, account.country, account.domain].filter(Boolean).join(" · ") || undefined}
        crumbs={[{ label: "Accounts", href: "/accounts" }, { label: account.name }]}
        meta={
          <>
            <Badge tone={account.status === "customer" ? "success" : "neutral"}>{ACCOUNT_STATUSES.find((s) => s.value === account.status)?.label}</Badge>
            {account.tier ? <Badge>{account.tier.replace("_", " ")}</Badge> : null}
            <span className="text-[12px] text-text-3">Owner: {data.owner?.name ?? "—"}</span>
            {data.parent ? (
              <span className="text-[12px] text-text-3">
                Parent:{" "}
                <Link className="text-accent hover:underline" href={`/accounts/${data.parent.id}`}>
                  {data.parent.name}
                </Link>
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {ctx.permissions.has("account:delete") ? (
              <ConfirmAction
                action={archiveAccountAction.bind(null, id)}
                label={<><Trash2 /> Archive</>}
                title="Archive account?"
                description="Archived accounts are hidden from lists and search. Accounts with open opportunities cannot be archived."
                confirmLabel="Archive"
              />
            ) : null}
            {ctx.permissions.has("contact:write") ? (
              <Button asChild>
                <Link href={`/contacts/new?accountId=${id}`}>
                  <UserPlus /> Add contact
                </Link>
              </Button>
            ) : null}
            {ctx.permissions.has("account:write") ? (
              <Button asChild>
                <Link href={`/accounts/${id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            ) : null}
            {ctx.permissions.has("opportunity:write") ? (
              <Button asChild variant="primary">
                <Link href={`/opportunities/new?accountId=${id}`}>
                  <Plus /> New opportunity
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open pipeline" value={formatMoney(openValue, baseCurrency, { compact: true })} hint={`${open.length} open deal${open.length === 1 ? "" : "s"}`} />
          <Stat label="Weighted pipeline" value={formatMoney(weighted, baseCurrency, { compact: true })} hint="Amount × stage probability" />
          <Stat label="Closed-won (all time)" value={formatMoney(wonValue, baseCurrency, { compact: true })} hint={`${won.length} deal${won.length === 1 ? "" : "s"}`} />
          <Stat label="Contacts" value={data.contacts.length} hint={missingRoles.length ? `Missing: ${missingRoles.map((r) => BUYING_ROLE_LABELS[r]).join(", ")}` : open.length ? "Key roles covered" : undefined} />
        </div>
        {unconverted > 0 ? (
          <p className="text-[12px] text-warning">
            {unconverted} deal(s) are in currencies without a configured FX rate and are excluded from totals. Configure rates in Administration → General.
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="min-w-0">
            <TabsNav
              basePath={`/accounts/${id}`}
              active={tab}
              tabs={[
                { key: "overview", label: "Opportunities", count: data.opportunities.length },
                { key: "contacts", label: "Contacts & buying committee", count: data.contacts.length },
                { key: "activity", label: "Activity", count: timeline.length },
                { key: "history", label: "History" },
              ]}
            />
            {tab === "contacts" ? (
              data.contacts.length === 0 ? (
                <EmptyState icon={Users} title="No contacts" description="Add the people involved in buying, using and approving your solutions." />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <TH>Name</TH>
                      <TH>Title</TH>
                      <TH>Deal role</TH>
                      <TH>Email</TH>
                      <TH>Last contacted</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {data.contacts.map((c) => {
                      const role = contactRole.get(c.id) ?? c.buyingRole;
                      return (
                        <TR key={c.id}>
                          <TD>
                            <Link href={`/contacts/${c.id}`} className="font-medium hover:text-accent">
                              {personName(c.firstName, c.lastName)}
                            </Link>
                            {c.doNotContact ? <Badge tone="danger" className="ml-2">DNC</Badge> : null}
                          </TD>
                          <TD className="text-text-2">{c.jobTitle ?? "—"}</TD>
                          <TD>{role ? <Badge tone={role === "blocker" ? "danger" : role === "champion" ? "success" : "neutral"}>{BUYING_ROLE_LABELS[role]}</Badge> : <span className="text-text-3">—</span>}</TD>
                          <TD className="text-text-2">{c.email ?? "—"}</TD>
                          <TD className="text-text-3">{c.lastContactedAt ? relativeTime(c.lastContactedAt) : "Never"}</TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              )
            ) : tab === "activity" ? (
              <>
                {ctx.permissions.has("activity:write") ? <ActivityComposer related={{ accountId: id }} revalidate={`/accounts/${id}`} /> : null}
                <Timeline items={timeline} timeZone={tz} />
              </>
            ) : tab === "history" ? (
              <RecordHistory entries={history} timeZone={tz} />
            ) : data.opportunities.length === 0 ? (
              <EmptyState title="No opportunities" description="Open an opportunity to start tracking a deal with this account." />
            ) : (
              <Table>
                <THead>
                  <tr>
                    <TH>Opportunity</TH>
                    <TH>Stage</TH>
                    <TH className="text-right">Amount</TH>
                    <TH>Close date</TH>
                    <TH>Owner</TH>
                  </tr>
                </THead>
                <TBody>
                  {data.opportunities.map((o) => (
                    <TR key={o.id}>
                      <TD>
                        <Link href={`/opportunities/${o.id}`} className="font-medium hover:text-accent">
                          {o.name}
                        </Link>
                      </TD>
                      <TD>
                        <Badge tone={o.stageCategory === "won" ? "success" : o.stageCategory === "lost" ? "danger" : "neutral"}>{o.stageName}</Badge>
                      </TD>
                      <TD className="tabular text-right">{formatMoney(o.amount, o.currency)}</TD>
                      <TD className="text-text-2">{formatDate(o.closedAt ?? o.expectedCloseDate, { timeZone: tz })}</TD>
                      <TD className="text-text-2">{o.ownerName ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          <div className="grid content-start gap-4">
            <Card>
              <CardHeader title="Details" />
              <FieldList
                items={[
                  ["Website", account.website ? <a href={account.website} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{account.domain}</a> : null],
                  ["Industry", account.industry],
                  ["Headquarters", account.headquarters],
                  ["Country", account.country],
                  ["Region", account.region],
                  ["Employees", account.employeeRange],
                  ["Subsidiaries", data.children.length ? data.children.map((c, i) => <span key={c.id}>{i > 0 ? ", " : ""}<Link className="text-accent hover:underline" href={`/accounts/${c.id}`}>{c.name}</Link></span>) : null],
                  ["Created", formatDate(account.createdAt, { timeZone: tz })],
                ]}
              />
            </Card>
            {account.businessChallenges || account.description ? (
              <Card>
                <CardHeader title="Context" />
                <div className="space-y-3 px-4 py-3 text-[13px]">
                  {account.businessChallenges ? (
                    <div>
                      <p className="mb-0.5 text-[12px] text-text-3">Business challenges</p>
                      <p className="whitespace-pre-wrap">{account.businessChallenges}</p>
                    </div>
                  ) : null}
                  {account.description ? (
                    <div>
                      <p className="mb-0.5 text-[12px] text-text-3">Description</p>
                      <p className="whitespace-pre-wrap">{account.description}</p>
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

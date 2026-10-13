import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { getContact } from "@/server/services/accounts";
import { timelineFor } from "@/server/services/activities";
import { recordHistory } from "@/server/services/admin";
import { recordView } from "@/server/services/search";
import { archiveContactAction } from "@/server/actions/crm";
import { loadOr404, sp } from "@/server/lib/page";
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
import { ConfirmAction } from "@/components/crm/confirm-action";
import { BUYING_ROLE_LABELS } from "@/lib/crm-options";
import { formatDate, formatMoney, personName, relativeTime } from "@/lib/format";

export const metadata = { title: "Contact" };

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const tab = sp(await searchParams, "tab") ?? "activity";
  const { contact, account, owner, opportunities } = await loadOr404(() => getContact(ctx, id));
  const name = personName(contact.firstName, contact.lastName);
  const tz = ctx.tenant.settings.timezone;
  const [timeline, history] = await Promise.all([
    ctx.permissions.has("activity:read") ? timelineFor(ctx, { type: "contact", id }) : Promise.resolve([]),
    tab === "history" ? recordHistory(ctx, "contact", id) : Promise.resolve([]),
    recordView(ctx, "contact", id, name),
  ]);
  return (
    <div>
      <PageHeader
        title={name}
        description={[contact.jobTitle, account?.name].filter(Boolean).join(" · ") || undefined}
        crumbs={[{ label: "Contacts", href: "/contacts" }, { label: name }]}
        meta={
          <>
            {contact.buyingRole ? <Badge>{BUYING_ROLE_LABELS[contact.buyingRole]}</Badge> : null}
            {contact.doNotContact ? <Badge tone="danger">Do not contact</Badge> : null}
            {contact.consentEmail ? <Badge tone="success">Email consent</Badge> : null}
            <span className="text-[12px] text-text-3">Owner: {owner?.name ?? "—"}</span>
          </>
        }
        actions={
          <>
            {ctx.permissions.has("contact:delete") ? (
              <ConfirmAction action={archiveContactAction.bind(null, id)} label={<><Trash2 /> Archive</>} title="Archive contact?" description="The contact will be hidden from lists and search. History is retained." confirmLabel="Archive" />
            ) : null}
            {ctx.permissions.has("contact:write") ? (
              <Button asChild>
                <Link href={`/contacts/${id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0">
          <TabsNav basePath={`/contacts/${id}`} active={tab} tabs={[{ key: "activity", label: "Activity", count: timeline.length }, { key: "history", label: "History" }]} />
          {tab === "history" ? (
            <RecordHistory entries={history} timeZone={tz} />
          ) : (
            <>
              {ctx.permissions.has("activity:write") ? <ActivityComposer related={{ contactId: id, accountId: account?.id }} revalidate={`/contacts/${id}`} /> : null}
              <Timeline items={timeline} timeZone={tz} />
            </>
          )}
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader title="Details" />
            <FieldList
              items={[
                ["Account", account ? <Link href={`/accounts/${account.id}`} className="text-accent hover:underline">{account.name}</Link> : null],
                ["Email", contact.email ? <a href={`mailto:${contact.email}`} className="text-accent hover:underline">{contact.email}</a> : null],
                ["Phone", contact.phone],
                ["Department", contact.department],
                ["Seniority", contact.seniority],
                ["Preferred channel", contact.preferredChannel],
                ["Country", contact.country],
                ["LinkedIn", contact.linkedinUrl ? <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Profile</a> : null],
                ["Last contacted", contact.lastContactedAt ? relativeTime(contact.lastContactedAt) : "Never"],
                ["Created", formatDate(contact.createdAt, { timeZone: tz })],
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Opportunities" />
            {opportunities.length === 0 ? (
              <EmptyState title="Not on any opportunity" />
            ) : (
              <ul className="divide-y divide-border">
                {opportunities.map((o) => (
                  <li key={o.id} className="px-4 py-2">
                    <Link href={`/opportunities/${o.id}`} className="font-medium hover:text-accent">
                      {o.name}
                    </Link>
                    <p className="text-[12px] text-text-3">
                      {BUYING_ROLE_LABELS[o.role]} · {o.stageName} · {formatMoney(o.amount, o.currency, { compact: true })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, Mail, Paperclip } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { emailCaptureConfigured, getMyCaptureAddress, listMyCapturedEmails } from "@/server/services/email-capture";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TabsNav } from "@/components/ui/tabs-nav";
import { CaptureAddress, UnmatchedActions } from "@/components/crm/email-widgets";
import { relativeTime } from "@/lib/format";

export const metadata = { title: "Email log" };

const LINK_PATH = { lead: "/leads", contact: "/contacts", account: "/accounts", opportunity: "/opportunities" } as const;
const LINK_LABEL = { lead: "Lead", contact: "Contact", account: "Company", opportunity: "Deal" } as const;

export default async function EmailPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("activity:write")) notFound();
  const tab = (await searchParams).tab === "logged" ? "logged" : "review";
  const configured = emailCaptureConfigured();
  const [address, unmatched, logged] = await Promise.all([
    configured ? getMyCaptureAddress(ctx) : null,
    listMyCapturedEmails(ctx, "unmatched"),
    tab === "logged" ? listMyCapturedEmails(ctx, "matched") : Promise.resolve([]),
  ]);
  const rows = tab === "logged" ? logged : unmatched;
  const canCreateLead = ctx.permissions.has("lead:write");
  return (
    <div>
      <PageHeader title="Email log" description="Emails you BCC or forward are logged on the matching contact, lead, company and deal automatically." />
      <div className="grid grid-cols-1 gap-4 p-4 md:p-6">
        <Card>
          <CardHeader title="Your logging address" description="Only you have this address. Anything sent to it is logged under your name." />
          <CardBody className="grid grid-cols-1 gap-3 text-[13px]">
            {address ? (
              <>
                <CaptureAddress address={address} />
                <ul className="grid gap-1 text-text-2">
                  <li>
                    <strong className="text-text">Sending:</strong> add it as <strong>BCC</strong> when you email a client.
                  </li>
                  <li>
                    <strong className="text-text">Received:</strong> <strong>forward</strong> the client&apos;s email to it.
                  </li>
                  <li className="text-text-3">Tip: save it as a contact named &quot;CRM&quot; so it autocompletes. Attachments are counted, not stored.</li>
                </ul>
              </>
            ) : (
              <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-warning">
                Email logging isn&apos;t switched on for this workspace yet. An administrator needs to connect the inbound mail service (see INTEGRATIONS.md → Email capture).
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <TabsNav
            basePath="/email"
            active={tab}
            tabs={[
              { key: "review", label: "Needs review", count: unmatched.length },
              { key: "logged", label: "Logged" },
            ]}
          />
          {rows.length === 0 ? (
            <EmptyState
              icon={Mail}
              title={tab === "review" ? "Nothing to review" : "No emails logged yet"}
              description={tab === "review" ? "Emails with no matching contact, lead or company show up here." : "BCC your logging address on your next client email."}
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((e) => (
                <li key={e.id} className="grid gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    {e.direction === "outbound" ? (
                      <ArrowUpRight className="size-4 text-accent" aria-label="Sent" />
                    ) : (
                      <ArrowDownLeft className="size-4 text-success" aria-label="Received" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{e.subject}</span>
                    {e.attachmentCount ? (
                      <span className="flex items-center gap-0.5 text-[12px] text-text-3">
                        <Paperclip className="size-3" /> {e.attachmentCount}
                      </span>
                    ) : null}
                    <span className="text-[12px] text-text-3">{relativeTime(e.sentAt)}</span>
                  </div>
                  <p className="truncate text-[12.5px] text-text-2">
                    {e.direction === "outbound" ? `To ${[...e.toEmails, ...e.ccEmails].join(", ") || "—"}` : `From ${e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail}`}
                  </p>
                  {e.snippet ? <p className="line-clamp-2 text-[12.5px] text-text-3">{e.snippet}</p> : null}
                  {e.status === "matched" ? (
                    <div className="flex flex-wrap gap-1">
                      {e.links.map((l) => (
                        <Link key={`${l.type}:${l.id}`} href={`${LINK_PATH[l.type]}/${l.id}`}>
                          <Badge tone="accent">{LINK_LABEL[l.type]}</Badge>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <UnmatchedActions id={e.id} canCreateLead={canCreateLead} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

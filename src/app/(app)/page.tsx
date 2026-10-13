import Link from "next/link";
import { AlarmClock, CheckCircle2, Clock, History, Inbox, KanbanSquare } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { workspaceSummary } from "@/server/services/metrics";
import { listTasks } from "@/server/services/activities";
import { recentlyViewed } from "@/server/services/search";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/crm/stat";
import { TaskList, taskHref } from "@/components/crm/task-list";
import { formatDate, formatMoney, relativeTime } from "@/lib/format";

export const metadata = { title: "Home" };

function greeting(tz: string): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default async function HomePage() {
  const ctx = await requireContext();
  const canActivities = ctx.permissions.has("activity:read");
  const [summary, tasks, recent] = await Promise.all([
    workspaceSummary(ctx),
    canActivities ? listTasks(ctx, { status: "open", limit: 12 }) : Promise.resolve([]),
    recentlyViewed(ctx, 8),
  ]);
  const firstName = ctx.user.name.split(" ")[0];
  return (
    <div>
      <PageHeader
        title={`${greeting(ctx.tenant.settings.timezone)}, ${firstName}`}
        description="Your tasks, follow-ups and deals that need attention."
        actions={
          ctx.permissions.has("lead:write") ? (
            <Button asChild variant="secondary">
              <Link href="/leads/new">New lead</Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Open tasks" value={summary.openTasks} href="/tasks" />
          <Stat label="Overdue" value={summary.overdueTasks} tone={summary.overdueTasks > 0 ? "danger" : "neutral"} href="/tasks?status=overdue" />
          <Stat label="Due today" value={summary.dueToday} href="/tasks?status=today" />
          <Stat label="New leads assigned to you" value={summary.newLeadsAssigned} href="/leads?owner=me" />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader title="My open tasks" actions={<Link href="/tasks" className="text-[12px] text-accent hover:underline">View all</Link>} />
            {tasks.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="No open tasks" description="Create tasks from any lead, account, contact or opportunity." />
            ) : (
              <TaskList
                tasks={tasks.map((t) => ({
                  id: t.id,
                  subject: t.subject,
                  dueAt: t.dueAt?.toISOString() ?? null,
                  completedAt: t.completedAt?.toISOString() ?? null,
                  priority: t.priority,
                  relatedLabel: t.relatedLabel,
                  relatedHref: taskHref(t),
                }))}
              />
            )}
          </Card>

          <Card>
            <CardHeader title="Closing in the next 30 days" description="Your open opportunities by expected close date" />
            {summary.closingSoon.length === 0 ? (
              <EmptyState icon={KanbanSquare} title="Nothing closing soon" />
            ) : (
              <ul className="divide-y divide-border">
                {summary.closingSoon.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/opportunities/${o.id}`} className="block truncate font-medium hover:text-accent">
                        {o.name}
                      </Link>
                      <p className="truncate text-[12px] text-text-3">
                        {o.accountName} · {o.stageName}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="tabular text-[13px] font-medium">{formatMoney(o.amount, o.currency, { compact: true })}</p>
                      <p className="tabular text-[12px] text-text-3">{formatDate(o.expectedCloseDate)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Leads needing follow-up" description={`No touch in ${ctx.tenant.settings.staleLeadDays}+ days`} />
            {summary.staleLeads.length === 0 ? (
              <EmptyState icon={Inbox} title="All leads followed up" />
            ) : (
              <ul className="divide-y divide-border">
                {summary.staleLeads.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <Link href={`/leads/${l.id}`} className="block truncate font-medium hover:text-accent">
                        {l.name}
                      </Link>
                      {l.company ? <p className="truncate text-[12px] text-text-3">{l.company}</p> : null}
                    </div>
                    <span className="shrink-0 text-[12px] text-text-3">{relativeTime(l.lastTouch)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Stalled deals" description={`No activity in ${ctx.tenant.settings.staleOpportunityDays}+ days`} />
            {summary.stalledDeals.length === 0 ? (
              <EmptyState icon={AlarmClock} title="No stalled deals" />
            ) : (
              <ul className="divide-y divide-border">
                {summary.stalledDeals.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <Link href={`/opportunities/${o.id}`} className="block truncate font-medium hover:text-accent">
                        {o.name}
                      </Link>
                      <p className="truncate text-[12px] text-text-3">
                        {o.accountName} · {o.stageName}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12px] text-text-3">{relativeTime(o.lastTouch)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Recently viewed" />
            {recent.length === 0 ? (
              <EmptyState icon={History} title="Nothing yet" description="Records you open appear here." />
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((r) => (
                  <li key={`${r.entityType}-${r.entityId}`} className="flex items-center justify-between gap-3 px-4 py-2">
                    <Link href={r.href} className="truncate hover:text-accent">
                      {r.label}
                    </Link>
                    <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-text-3 capitalize">
                      <Clock className="size-3" /> {r.entityType}
                    </span>
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

import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { requireContext } from "@/server/auth/context";
import { listTasks } from "@/server/services/activities";
import { sp } from "@/server/lib/page";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TaskList, taskHref } from "@/components/crm/task-list";
import { cn } from "@/lib/cn";

export const metadata = { title: "Tasks" };

const STATUSES = [
  { key: "open", label: "All open" },
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "completed", label: "Completed" },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  if (!ctx.permissions.has("activity:read")) notFound();
  const params = await searchParams;
  const status = STATUSES.find((s) => s.key === sp(params, "status"))?.key ?? "open";
  const scope = sp(params, "scope") === "team" && ctx.dataScope !== "own" ? "team" : "mine";
  const tasks = await listTasks(ctx, { status, scope, limit: 300 });
  const href = (s: string, sc: string) => `/tasks?status=${s}${sc === "team" ? "&scope=team" : ""}`;
  return (
    <div>
      <PageHeader title="Tasks" description="Follow-ups created from leads, accounts, contacts and opportunities." />
      <div className="p-4 md:p-6">
        <Card>
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
            {STATUSES.map((s) => (
              <Link key={s.key} href={href(s.key, scope)} aria-current={status === s.key ? "page" : undefined} className={cn("rounded-md px-2 py-1 text-[12.5px] font-medium", status === s.key ? "bg-accent-soft text-accent" : "text-text-3 hover:bg-surface-hover hover:text-text")}>
                {s.label}
              </Link>
            ))}
            {ctx.dataScope !== "own" ? (
              <div className="ml-auto flex gap-1">
                {(["mine", "team"] as const).map((sc) => (
                  <Link key={sc} href={href(status, sc)} aria-current={scope === sc ? "page" : undefined} className={cn("rounded-md px-2 py-1 text-[12.5px]", scope === sc ? "bg-surface-2 font-medium text-text" : "text-text-3 hover:text-text")}>
                    {sc === "mine" ? "Mine" : ctx.dataScope === "all" ? "Everyone" : "My team"}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          {tasks.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No tasks here" description="Create tasks from the activity panel on any record." />
          ) : (
            <TaskList
              showOwner={scope === "team"}
              tasks={tasks.map((t) => ({
                id: t.id,
                subject: t.subject,
                dueAt: t.dueAt?.toISOString() ?? null,
                completedAt: t.completedAt?.toISOString() ?? null,
                priority: t.priority,
                relatedLabel: t.relatedLabel,
                relatedHref: taskHref(t),
                ownerName: t.ownerName,
              }))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

import { CalendarDays, CheckSquare, Mail, MessageSquareText, Phone } from "lucide-react";
import type { TimelineItem } from "@/server/services/activities";
import { formatDate, relativeTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";

const ICON = { note: MessageSquareText, task: CheckSquare, call: Phone, email: Mail, meeting: CalendarDays } as const;

export function Timeline({ items, timeZone }: { items: TimelineItem[]; timeZone: string }) {
  if (items.length === 0)
    return <EmptyState icon={MessageSquareText} title="No activity yet" description="Log a call, meeting or note, or create a follow-up task." />;
  return (
    <ol className="relative px-4 py-3">
      {items.map((a) => {
        const Icon = ICON[a.type];
        const when = a.type === "task" ? a.dueAt : a.occurredAt ?? a.createdAt;
        return (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            <div className="flex flex-col items-center">
              <span className="flex size-6 items-center justify-center rounded-full border border-border bg-surface-2 text-text-3">
                <Icon className="size-3" aria-hidden />
              </span>
              <span className="mt-1 w-px flex-1 bg-border" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{a.subject}</p>
                {a.type === "task" ? (
                  a.completedAt ? <Badge tone="success">Done</Badge> : a.dueAt && a.dueAt < new Date() ? <Badge tone="danger">Overdue</Badge> : <Badge>Open</Badge>
                ) : null}
                {a.outcome ? <Badge>{a.outcome.replace("_", " ")}</Badge> : null}
              </div>
              {a.body ? <p className="mt-1 text-[12.5px] whitespace-pre-wrap text-text-2">{a.body}</p> : null}
              <p className="mt-1 text-[11.5px] text-text-3">
                <span className="capitalize">{a.type}</span>
                {a.ownerName ? ` · ${a.ownerName}` : ""}
                {when ? ` · ${a.type === "task" ? "due " : ""}${formatDate(when, { withTime: true, timeZone })} (${relativeTime(when)})` : ""}
                {a.durationMinutes ? ` · ${a.durationMinutes} min` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

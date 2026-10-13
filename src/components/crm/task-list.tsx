"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { toggleTaskAction } from "@/server/actions/crm";
import { cn } from "@/lib/cn";

export interface TaskItem {
  id: string;
  subject: string;
  dueAt: string | null;
  completedAt: string | null;
  priority: string;
  relatedLabel: string | null;
  relatedHref: string | null;
  ownerName?: string | null;
}

function dueLabel(dueAt: string | null): { text: string; overdue: boolean } {
  if (!dueAt) return { text: "No due date", overdue: false };
  const d = new Date(dueAt);
  const now = new Date();
  const overdue = d.getTime() < now.getTime();
  const sameDay = d.toDateString() === now.toDateString();
  const text = sameDay
    ? `Today ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return { text, overdue };
}

export function TaskList({ tasks, showOwner = false }: { tasks: TaskItem[]; showOwner?: boolean }) {
  const [optimistic, setOptimistic] = useOptimistic(tasks, (state, id: string) =>
    state.map((t) => (t.id === id ? { ...t, completedAt: t.completedAt ? null : new Date().toISOString() } : t)),
  );
  const [, start] = useTransition();
  return (
    <ul className="divide-y divide-border">
      {optimistic.map((t) => {
        const due = dueLabel(t.dueAt);
        const done = !!t.completedAt;
        return (
          <li key={t.id} className="flex items-center gap-3 px-4 py-2">
            <button
              type="button"
              aria-label={done ? `Reopen ${t.subject}` : `Complete ${t.subject}`}
              aria-pressed={done}
              onClick={() =>
                start(async () => {
                  setOptimistic(t.id);
                  const r = await toggleTaskAction(t.id, !done);
                  if (r.status === "error") toast.error(r.message);
                })
              }
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                done ? "border-success bg-success text-white" : "border-border-strong hover:border-accent",
              )}
            >
              {done ? <Check className="size-3" strokeWidth={3} /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-[13px]", done && "text-text-3 line-through")}>{t.subject}</p>
              {t.relatedLabel ? (
                t.relatedHref ? (
                  <Link href={t.relatedHref} className="truncate text-[12px] text-text-3 hover:text-accent">
                    {t.relatedLabel}
                  </Link>
                ) : (
                  <p className="truncate text-[12px] text-text-3">{t.relatedLabel}</p>
                )
              ) : null}
            </div>
            {showOwner && t.ownerName ? <span className="hidden text-[12px] text-text-3 sm:inline">{t.ownerName}</span> : null}
            {t.priority === "high" ? <span className="text-[11px] font-medium text-warning">High</span> : null}
            <span className={cn("tabular shrink-0 text-[12px]", due.overdue && !done ? "font-medium text-danger" : "text-text-3")}>{due.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function taskHref(t: { opportunityId: string | null; contactId: string | null; accountId: string | null; leadId: string | null }): string | null {
  if (t.opportunityId) return `/opportunities/${t.opportunityId}`;
  if (t.contactId) return `/contacts/${t.contactId}`;
  if (t.accountId) return `/accounts/${t.accountId}`;
  if (t.leadId) return `/leads/${t.leadId}`;
  return null;
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { moveStageAction } from "@/server/actions/crm";
import { cn } from "@/lib/cn";
import { StageMoveDialog, type PendingMove } from "./stage-move-dialog";

interface Stage {
  id: string;
  name: string;
  category: "open" | "won" | "lost";
  requiredFields: string[];
  probability: number;
}

export function StagePath({
  opportunity,
  stages,
  canEdit,
}: {
  opportunity: { id: string; name: string; stageId: string; amount: string; expectedCloseDate: string | null };
  stages: Stage[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [move, setMove] = useState<PendingMove | null>(null);
  const currentIdx = stages.findIndex((s) => s.id === opportunity.stageId);
  const current = stages[currentIdx];
  const openStages = stages.filter((s) => s.category === "open");
  const closed = stages.filter((s) => s.category !== "open");

  const go = (s: Stage) => {
    if (!canEdit || s.id === opportunity.stageId || pending) return;
    const missing = s.requiredFields.filter((f) => (f === "amount" && Number(opportunity.amount) <= 0) || (f === "expectedCloseDate" && !opportunity.expectedCloseDate) || f === "lossReason");
    if (s.category === "lost" || missing.length) {
      setMove({ opportunityId: opportunity.id, opportunityName: opportunity.name, stageId: s.id, stageName: s.name, stageCategory: s.category, requiredFields: missing, current: { amount: opportunity.amount, expectedCloseDate: opportunity.expectedCloseDate } });
      return;
    }
    start(async () => {
      const r = await moveStageAction({ opportunityId: opportunity.id, stageId: s.id });
      if (r.status === "error") toast.error(r.message);
      else {
        toast.success(`Moved to ${s.name}`);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <ol className="flex min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-surface" aria-label="Stage path">
        {openStages.map((s, i) => {
          const idx = stages.indexOf(s);
          const done = current?.category === "won" || (current?.category === "open" && idx < currentIdx);
          const active = s.id === opportunity.stageId;
          return (
            <li key={s.id} className={cn("min-w-[92px] flex-1", i > 0 && "border-l border-border")}>
              <button
                type="button"
                disabled={!canEdit || pending}
                onClick={() => go(s)}
                aria-current={active ? "step" : undefined}
                title={`${s.name} · ${s.probability}%`}
                className={cn(
                  "flex h-9 w-full items-center justify-center gap-1 px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors",
                  active ? "bg-accent text-accent-text" : done ? "bg-accent-soft text-accent" : "text-text-3 hover:bg-surface-hover hover:text-text",
                  !canEdit && "cursor-default",
                )}
              >
                {done && !active ? <Check className="size-3" /> : null}
                <span className="truncate">{s.name}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {closed.map((s) => {
        const active = s.id === opportunity.stageId;
        return (
          <button
            key={s.id}
            type="button"
            disabled={!canEdit || pending}
            onClick={() => go(s)}
            aria-pressed={active}
            className={cn(
              "h-9 rounded-md border px-3 text-[12px] font-medium",
              s.category === "won"
                ? active
                  ? "border-success bg-success text-white"
                  : "border-success/40 text-success hover:bg-success-soft"
                : active
                  ? "border-danger bg-danger text-white"
                  : "border-danger/40 text-danger hover:bg-danger-soft",
            )}
          >
            {s.name}
          </button>
        );
      })}
      <StageMoveDialog move={move} onClose={() => setMove(null)} onMoved={() => router.refresh()} />
    </div>
  );
}

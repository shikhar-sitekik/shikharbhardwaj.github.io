"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { CalendarClock } from "lucide-react";
import { moveStageAction } from "@/server/actions/crm";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { StageMoveDialog, type PendingMove } from "./stage-move-dialog";

export interface BoardStage {
  id: string;
  name: string;
  probability: number;
  category: "open" | "won" | "lost";
  requiredFields: string[];
}

export interface BoardCard {
  id: string;
  name: string;
  accountName: string;
  ownerName: string | null;
  stageId: string;
  amount: string;
  currency: string;
  /** Amount in base currency, null when no FX rate is configured. */
  baseAmount: number | null;
  probability: number;
  expectedCloseDate: string | null;
  daysInStage: number;
  stale: boolean;
}

function Card({ card, dragging = false }: { card: BoardCard; dragging?: boolean }) {
  const overdue = card.expectedCloseDate !== null && card.expectedCloseDate < new Date().toISOString().slice(0, 10);
  return (
    <div className={cn("rounded-md border border-border bg-surface px-2.5 py-2 shadow-[0_1px_0_rgba(15,23,41,0.03)]", dragging && "rotate-[1deg] shadow-lg ring-2 ring-accent/40")}>
      <Link href={`/opportunities/${card.id}`} className="line-clamp-2 text-[12.5px] leading-snug font-medium hover:text-accent" onPointerDown={(e) => e.stopPropagation()}>
        {card.name}
      </Link>
      <p className="mt-0.5 truncate text-[11.5px] text-text-3">{card.accountName}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="tabular text-[12.5px] font-semibold">{formatMoney(card.amount, card.currency, { compact: true })}</span>
        <span className={cn("flex items-center gap-1 text-[11px]", overdue ? "font-medium text-danger" : "text-text-3")}>
          <CalendarClock className="size-3" aria-hidden />
          {card.expectedCloseDate ? new Date(`${card.expectedCloseDate}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }) : "No date"}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-text-3">
        <span className="truncate">{card.ownerName ?? "Unassigned"}</span>
        <span className={cn(card.stale && "font-medium text-warning")}>{card.daysInStage}d in stage</span>
      </div>
    </div>
  );
}

function DraggableCard({ card }: { card: BoardCard }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, data: { card } });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn("cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent", isDragging && "opacity-30")} aria-roledescription="Draggable opportunity">
      <Card card={card} />
    </div>
  );
}

function Column({ stage, cards, baseCurrency }: { stage: BoardStage; cards: BoardCard[]; baseCurrency: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stage } });
  const total = cards.reduce((s, c) => s + (c.baseAmount ?? 0), 0);
  const weighted = cards.reduce((s, c) => s + ((c.baseAmount ?? 0) * c.probability) / 100, 0);
  return (
    <section className="flex w-[264px] shrink-0 flex-col rounded-lg border border-border bg-surface-2" aria-label={`${stage.name}, ${cards.length} opportunities`}>
      <header className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-[12.5px] font-semibold">{stage.name}</h3>
          <span className="text-[11px] text-text-3">{cards.length}</span>
        </div>
        <p className="tabular mt-0.5 text-[11px] text-text-3">
          {formatMoney(total, baseCurrency, { compact: true })}
          {stage.category === "open" ? ` · ${formatMoney(weighted, baseCurrency, { compact: true })} wtd · ${stage.probability}%` : ""}
        </p>
      </header>
      <div ref={setNodeRef} className={cn("flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5 transition-colors", isOver && "bg-accent-soft")}>
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} />
        ))}
      </div>
    </section>
  );
}

export function PipelineBoard({ stages, cards, baseCurrency }: { stages: BoardStage[]; cards: BoardCard[]; baseCurrency: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [optimistic, applyMove] = useOptimistic(cards, (state, m: { id: string; stageId: string }) => state.map((c) => (c.id === m.id ? { ...c, stageId: m.stageId, daysInStage: 0 } : c)));
  const [active, setActive] = useState<BoardCard | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const byStage = useMemo(() => {
    const m = new Map<string, BoardCard[]>();
    for (const s of stages) m.set(s.id, []);
    for (const c of optimistic) m.get(c.stageId)?.push(c);
    return m;
  }, [optimistic, stages]);

  const onStart = (e: DragStartEvent) => setActive((e.active.data.current as { card: BoardCard }).card);
  const onEnd = (e: DragEndEvent) => {
    setActive(null);
    const card = (e.active.data.current as { card: BoardCard } | undefined)?.card;
    const stage = (e.over?.data.current as { stage: BoardStage } | undefined)?.stage;
    if (!card || !stage || card.stageId === stage.id) return;
    const missing = stage.requiredFields.filter((f) => (f === "amount" && Number(card.amount) <= 0) || (f === "expectedCloseDate" && !card.expectedCloseDate) || f === "lossReason");
    if (stage.category === "lost" || missing.length > 0) {
      setPendingMove({
        opportunityId: card.id,
        opportunityName: card.name,
        stageId: stage.id,
        stageName: stage.name,
        stageCategory: stage.category,
        requiredFields: missing,
        current: { amount: card.amount, expectedCloseDate: card.expectedCloseDate },
      });
      return;
    }
    start(async () => {
      applyMove({ id: card.id, stageId: stage.id });
      const r = await moveStageAction({ opportunityId: card.id, stageId: stage.id });
      if (r.status === "error") {
        toast.error(r.message);
        // The server rejected the move (e.g. other required fields); route to the record.
        router.refresh();
      } else toast.success(`${card.name} → ${stage.name}`);
    });
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={onStart}
        onDragEnd={onEnd}
        onDragCancel={() => setActive(null)}
        accessibility={{
          announcements: {
            onDragStart: ({ active: a }) => `Picked up ${(a.data.current as { card: BoardCard }).card.name}.`,
            onDragOver: ({ over }) => (over ? `Over ${(over.data.current as { stage: BoardStage }).stage.name}.` : "Not over a stage."),
            onDragEnd: ({ over }) => (over ? `Dropped in ${(over.data.current as { stage: BoardStage }).stage.name}.` : "Dropped."),
            onDragCancel: () => "Move cancelled.",
          },
        }}
      >
        <div className="flex h-full gap-2.5 overflow-x-auto p-4 md:p-6">
          {stages.map((s) => (
            <Column key={s.id} stage={s} cards={byStage.get(s.id) ?? []} baseCurrency={baseCurrency} />
          ))}
        </div>
        <DragOverlay>{active ? <Card card={active} dragging /> : null}</DragOverlay>
      </DndContext>
      <StageMoveDialog move={pendingMove} onClose={() => setPendingMove(null)} onMoved={() => router.refresh()} />
    </>
  );
}

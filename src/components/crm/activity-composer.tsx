"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { logActivityAction } from "@/server/actions/crm";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit";
import { cn } from "@/lib/cn";

type Kind = "note" | "task" | "call" | "email" | "meeting";
const KINDS: { value: Kind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "task", label: "Task" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email (log)" },
];

export function ActivityComposer({
  related,
  revalidate,
}: {
  related: { leadId?: string; accountId?: string; contactId?: string; opportunityId?: string };
  revalidate: string;
}) {
  const [kind, setKind] = useState<Kind>("note");
  const [state, action] = useActionState(logActivityAction.bind(null, revalidate), { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const tzRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.status === "success") {
      toast.success(state.message ?? "Saved");
      formRef.current?.reset();
    } else if (state.status === "error") toast.error(state.message);
  }, [state]);

  const fe = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={() => {
        if (tzRef.current) tzRef.current.value = String(new Date().getTimezoneOffset());
      }}
      className="border-b border-border px-4 py-3"
    >
      <input type="hidden" name="type" value={kind} />
      <input ref={tzRef} type="hidden" name="tzOffset" defaultValue="0" />
      {Object.entries(related).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="mb-2 flex gap-1" role="tablist" aria-label="Activity type">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            role="tab"
            aria-selected={kind === k.value}
            onClick={() => setKind(k.value)}
            className={cn(
              "rounded-md px-2 py-1 text-[12px] font-medium",
              kind === k.value ? "bg-accent-soft text-accent" : "text-text-3 hover:bg-surface-hover hover:text-text",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        <Input name="subject" placeholder={kind === "task" ? "What needs to be done?" : kind === "note" ? "Title" : "Subject"} required aria-label="Subject" aria-invalid={!!fe?.subject} />
        {kind !== "task" ? <Textarea name="body" placeholder="Details (optional)" className="min-h-16" aria-label="Details" /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {kind === "task" ? (
            <>
              <label className="flex items-center gap-1.5 text-[12px] text-text-3">
                Due
                <Input type="datetime-local" name="dueAt" required className="h-7 w-auto" aria-invalid={!!fe?.dueAt} />
              </label>
              <Select name="priority" defaultValue="normal" className="h-7 w-auto" aria-label="Priority">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </Select>
            </>
          ) : kind !== "note" ? (
            <>
              <label className="flex items-center gap-1.5 text-[12px] text-text-3">
                When
                <Input type="datetime-local" name="occurredAt" className="h-7 w-auto" />
              </label>
              {kind === "call" || kind === "meeting" ? (
                <>
                  <Input name="durationMinutes" type="number" min={0} max={1440} placeholder="Minutes" className="h-7 w-24" aria-label="Duration in minutes" />
                  <Select name="outcome" className="h-7 w-auto" aria-label="Outcome" defaultValue="">
                    <option value="">Outcome</option>
                    <option value="connected">Connected</option>
                    <option value="no_answer">No answer</option>
                    <option value="left_voicemail">Left voicemail</option>
                    <option value="held">Held</option>
                    <option value="rescheduled">Rescheduled</option>
                  </Select>
                </>
              ) : null}
            </>
          ) : null}
          <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…">
            {kind === "task" ? "Create task" : "Log"}
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

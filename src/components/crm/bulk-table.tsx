"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit";
import type { ActionState } from "@/server/actions/result";

export interface BulkOp {
  op: string;
  label: string;
  /** Options for ops that need a value (e.g. owner, status). */
  options?: { value: string; label: string }[];
  danger?: boolean;
}

/**
 * Selection + bulk-action bar around a server-rendered table. Rows render a
 * checkbox with name="ids" via <RowCheck/>; the form submits selected ids.
 */
export function BulkForm({
  action,
  ops,
  children,
  formId,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  ops: BulkOp[];
  children: ReactNode;
  formId: string;
}) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  const [count, setCount] = useState(0);
  const [op, setOp] = useState(ops[0]?.op ?? "");
  const current = ops.find((o) => o.op === op);

  useEffect(() => {
    if (state.status === "success" && state.message) toast.success(state.message);
    if (state.status === "error") toast.error(state.message);
  }, [state]);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const update = () => setCount(form.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked').length);
    form.addEventListener("change", update);
    update();
    return () => form.removeEventListener("change", update);
  }, [formId, state]);

  return (
    <form id={formId} action={formAction}>
      {count > 0 && ops.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-4 py-1.5">
          <span className="text-[12.5px] font-medium text-accent">{count} selected</span>
          <Select name="op" value={op} onChange={(e) => setOp(e.target.value)} className="h-7 w-auto" aria-label="Bulk action">
            {ops.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </Select>
          {current?.options ? (
            <Select name="value" className="h-7 w-auto" aria-label="Value" required>
              <option value="">Choose…</option>
              {current.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : null}
          <SubmitButton size="sm" variant={current?.danger ? "danger" : "primary"} pendingLabel="Applying…">
            Apply
          </SubmitButton>
        </div>
      ) : null}
      {children}
    </form>
  );
}

export function SelectAll({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all rows"
      className="size-3.5 accent-[var(--accent)]"
      onChange={(e) => {
        const form = document.getElementById(formId);
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((c) => (c.checked = e.target.checked));
        form?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

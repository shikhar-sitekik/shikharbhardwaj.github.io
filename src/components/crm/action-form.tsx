"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import type { ActionState } from "@/server/actions/result";

/** Generic form wrapper that toasts the action result. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
    }
    if (state.status === "error") toast.error(state.message);
  }, [state, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
    </form>
  );
}

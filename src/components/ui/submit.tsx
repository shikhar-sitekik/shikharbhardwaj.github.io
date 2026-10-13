"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./button";

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "error" && state.message)
    return (
      <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
        {state.message}
      </p>
    );
  if (state.status === "success" && state.message)
    return (
      <p role="status" className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-[12.5px] text-success">
        {state.message}
      </p>
    );
  return null;
}

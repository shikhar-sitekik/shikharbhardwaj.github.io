"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button, type ButtonProps } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit";
import type { ActionState } from "@/server/actions/result";

export function ConfirmAction({
  action,
  label,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "ghost",
}: {
  action: (prev: ActionState) => Promise<ActionState>;
  label: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: ButtonProps["variant"];
}) {
  const [state, formAction] = useActionState(action, { status: "idle" });
  useEffect(() => {
    if (state.status === "error") toast.error(state.message);
  }, [state]);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={variant}>{label}</Button>
      </DialogTrigger>
      <DialogContent title={title} description={description}>
        <form action={formAction} className="flex justify-end gap-2 p-4">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <SubmitButton variant="danger">{confirmLabel}</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

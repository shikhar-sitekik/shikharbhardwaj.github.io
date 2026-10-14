"use client";

import { useTransition } from "react";
import { RefreshCw, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { createLeadFromEmailAction, dismissEmailAction, regenerateCaptureAddressAction, rematchEmailAction } from "@/server/actions/email";
import type { ActionState } from "@/server/actions/result";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/crm/integration-widgets";

function report(r: ActionState | void) {
  if (!r) return;
  if (r.status === "error") toast.error(r.message);
  else if (r.status === "success" && r.message) toast.success(r.message);
}

export function CaptureAddress({ address }: { address: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12.5px] break-all" data-testid="capture-address">
          {address}
        </code>
        <CopyButton value={address} label="Copy address" />
      </div>
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("Issue a new address? The current one stops working immediately.")) return;
            start(async () => report(await regenerateCaptureAddressAction()));
          }}
        >
          <RefreshCw /> New address
        </Button>
      </div>
    </div>
  );
}

export function UnmatchedActions({ id, canCreateLead }: { id: string; canCreateLead: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-1">
      {canCreateLead ? (
        <Button size="sm" disabled={pending} onClick={() => start(async () => report(await createLeadFromEmailAction(id)))}>
          <UserPlus /> Create lead
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => report(await rematchEmailAction(id)))}>
        <RefreshCw /> Re-check
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => dismissEmailAction(id))} aria-label="Dismiss">
        <X /> Dismiss
      </Button>
    </div>
  );
}

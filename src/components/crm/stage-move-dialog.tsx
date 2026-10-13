"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { moveStageAction } from "@/server/actions/crm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

export interface PendingMove {
  opportunityId: string;
  opportunityName: string;
  stageId: string;
  stageName: string;
  stageCategory: "open" | "won" | "lost";
  requiredFields: string[];
  current: { amount: string; expectedCloseDate: string | null };
}

/** Collects stage-required values (loss reason, amount, close date) before a move. */
export function StageMoveDialog({ move, onClose, onMoved }: { move: PendingMove | null; onClose: () => void; onMoved?: () => void }) {
  const [pending, start] = useTransition();
  const [lossReason, setLossReason] = useState("");
  const [amount, setAmount] = useState("");
  const [closeDate, setCloseDate] = useState("");
  if (!move) return null;
  const needLoss = move.stageCategory === "lost" || move.requiredFields.includes("lossReason");
  const needAmount = move.requiredFields.includes("amount");
  const needClose = move.requiredFields.includes("expectedCloseDate");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Move to “${move.stageName}”`} description={move.opportunityName}>
        <form
          className="grid gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await moveStageAction({
                opportunityId: move.opportunityId,
                stageId: move.stageId,
                lossReason: needLoss ? lossReason : undefined,
                amount: needAmount && amount ? Number(amount.replace(/,/g, "")) : undefined,
                expectedCloseDate: needClose && closeDate ? closeDate : undefined,
              });
              if (r.status === "error") toast.error(r.message);
              else {
                toast.success(`Moved to ${move.stageName}`);
                onMoved?.();
                onClose();
              }
            });
          }}
        >
          {needLoss ? (
            <Field label="Loss reason *" htmlFor="lossReason">
              <Textarea id="lossReason" value={lossReason} onChange={(e) => setLossReason(e.target.value)} required placeholder="e.g. Chose competitor on price; budget frozen" />
            </Field>
          ) : null}
          {needAmount ? (
            <Field label="Deal value *" htmlFor="amount" hint={`Current: ${move.current.amount}`}>
              <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={move.current.amount} required={Number(move.current.amount) <= 0} />
            </Field>
          ) : null}
          {needClose ? (
            <Field label="Expected close date *" htmlFor="closeDate">
              <Input id="closeDate" type="date" value={closeDate || move.current.expectedCloseDate || ""} onChange={(e) => setCloseDate(e.target.value)} required />
            </Field>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={move.stageCategory === "lost" ? "danger" : "primary"} disabled={pending}>
              {pending ? "Moving…" : "Move"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

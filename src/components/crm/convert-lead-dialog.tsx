"use client";

import { useActionState, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { convertLeadAction } from "@/server/actions/crm";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/submit";

export function ConvertLeadDialog({
  leadId,
  defaults,
  matchingAccount,
  accounts,
  pipelines,
  currencies,
}: {
  leadId: string;
  defaults: { accountName: string; opportunityName: string; amount: string; currency: string };
  matchingAccount: { id: string; name: string } | null;
  accounts: { id: string; name: string }[];
  pipelines: { id: string; name: string }[];
  currencies: readonly string[];
}) {
  const [state, action] = useActionState(convertLeadAction.bind(null, leadId), { status: "idle" });
  const [mode, setMode] = useState<"new" | "existing">(matchingAccount ? "existing" : "new");
  const [createOpp, setCreateOpp] = useState(true);
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="primary">
          <ArrowRightLeft /> Convert
        </Button>
      </DialogTrigger>
      <DialogContent title="Convert lead" description="Creates a contact, links or creates an account, and optionally opens an opportunity. Activity history moves with it.">
        <form action={action} className="grid gap-4 p-4">
          <FormMessage state={state} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[12px] font-medium text-text-2">Account</legend>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" name="accountMode" value="new" checked={mode === "new"} onChange={() => setMode("new")} className="accent-[var(--accent)]" />
              Create a new account
            </label>
            {mode === "new" ? (
              <Field label="Account name" htmlFor="accountName" error={fe?.accountName ?? fe?.accountId}>
                <Input id="accountName" name="accountName" defaultValue={defaults.accountName} required />
              </Field>
            ) : null}
            <label className="flex items-center gap-2 text-[13px]">
              <input type="radio" name="accountMode" value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} className="accent-[var(--accent)]" />
              Attach to an existing account
              {matchingAccount ? <span className="text-[12px] text-success">(domain match: {matchingAccount.name})</span> : null}
            </label>
            {mode === "existing" ? (
              <Select name="accountId" defaultValue={matchingAccount?.id ?? ""} required aria-label="Existing account">
                <option value="">Select an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </fieldset>
          <fieldset className="grid gap-2">
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" name="createOpportunity" checked={createOpp} onChange={(e) => setCreateOpp(e.target.checked)} className="accent-[var(--accent)]" />
              Create an opportunity
            </label>
            {createOpp ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Opportunity name" htmlFor="opportunityName" className="sm:col-span-2" error={fe?.opportunityName}>
                  <Input id="opportunityName" name="opportunityName" defaultValue={defaults.opportunityName} required />
                </Field>
                <Field label="Pipeline" htmlFor="pipelineId">
                  <Select id="pipelineId" name="pipelineId" defaultValue={pipelines[0]?.id}>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Expected close" htmlFor="expectedCloseDate">
                  <Input id="expectedCloseDate" name="expectedCloseDate" type="date" />
                </Field>
                <Field label="Amount" htmlFor="amount">
                  <Input id="amount" name="amount" inputMode="decimal" defaultValue={defaults.amount} />
                </Field>
                <Field label="Currency" htmlFor="currency">
                  <Select id="currency" name="currency" defaultValue={defaults.currency}>
                    {currencies.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}
          </fieldset>
          <div className="flex justify-end">
            <SubmitButton pendingLabel="Converting…">Convert lead</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

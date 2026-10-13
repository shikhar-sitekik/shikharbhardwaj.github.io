"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { saveOpportunityAction } from "@/server/actions/crm";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormMessage, SubmitButton } from "@/components/ui/submit";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { LEAD_SOURCES } from "@/lib/crm-options";

export interface OpportunityFormValues {
  name?: string;
  accountId?: string | null;
  primaryContactId?: string | null;
  ownerId?: string | null;
  pipelineId?: string;
  stageId?: string | null;
  amount?: string | null;
  currency?: string;
  probabilityOverride?: number | null;
  revenueType?: "one_time" | "recurring";
  contractMonths?: number | null;
  expectedCloseDate?: string | null;
  estimatedStartDate?: string | null;
  source?: string | null;
  nextStep?: string | null;
  decisionCriteria?: string | null;
  risks?: string | null;
  technicalRequirements?: string | null;
  procurementRequirements?: string | null;
  competitors?: string[];
  forecastCategory?: string;
}

export function OpportunityForm({
  opportunityId,
  values,
  accounts,
  contacts,
  owners,
  pipelines,
  currencies,
}: {
  opportunityId: string | null;
  values: OpportunityFormValues;
  accounts: { id: string; name: string }[];
  contacts: { id: string; firstName: string | null; lastName: string; accountId: string | null }[];
  owners: { id: string; name: string }[];
  pipelines: { id: string; name: string; stages: { id: string; name: string; probability: number; requiredFields: string[] }[] }[];
  currencies: readonly string[];
}) {
  const [state, action] = useActionState(saveOpportunityAction.bind(null, opportunityId), { status: "idle" });
  const [pipelineId, setPipelineId] = useState(values.pipelineId ?? pipelines[0]?.id ?? "");
  const [accountId, setAccountId] = useState(values.accountId ?? "");
  const [revenueType, setRevenueType] = useState(values.revenueType ?? "one_time");
  const [stageId, setStageId] = useState(values.stageId ?? "");
  const pipeline = pipelines.find((p) => p.id === pipelineId);
  const stage = pipeline?.stages.find((s) => s.id === stageId);
  const accountContacts = useMemo(() => contacts.filter((c) => c.accountId === accountId), [contacts, accountId]);
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  const v = (k: keyof OpportunityFormValues) => {
    const x = values[k];
    return x === null || x === undefined ? "" : String(x);
  };
  const req = (f: string) => (stage?.requiredFields.includes(f) ? " *" : "");
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <Card>
        <CardHeader title="Deal" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Opportunity name *" htmlFor="name" error={fe?.name} className="sm:col-span-2">
            <Input id="name" name="name" defaultValue={v("name")} required />
          </Field>
          <Field label="Account *" htmlFor="accountId" error={fe?.accountId}>
            <Select id="accountId" name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              <option value="">Select account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Primary contact${req("primaryContactId")}`} htmlFor="primaryContactId" error={fe?.primaryContactId}>
            <Select id="primaryContactId" name="primaryContactId" defaultValue={v("primaryContactId")} key={accountId}>
              <option value="">{accountId ? (accountContacts.length ? "—" : "No contacts on this account") : "Select an account first"}</option>
              {accountContacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.firstName, c.lastName].filter(Boolean).join(" ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pipeline" htmlFor="pipelineId">
            <Select
              id="pipelineId"
              name="pipelineId"
              value={pipelineId}
              onChange={(e) => {
                setPipelineId(e.target.value);
                setStageId("");
              }}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stage" htmlFor="stageId" error={fe?.stageId} hint={stage?.requiredFields.length ? "Fields marked * are required at this stage." : undefined}>
            <Select id="stageId" name="stageId" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">{opportunityId ? "Keep current" : "First stage"}</option>
              {pipeline?.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.probability}%)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="ownerId">
            <Select id="ownerId" name="ownerId" defaultValue={v("ownerId")}>
              <option value="">{opportunityId ? "—" : "Me"}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source" htmlFor="source">
            <Select id="source" name="source" defaultValue={v("source")}>
              <option value="">—</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Commercials" description="Amount is the total contract value (TCV). ARR is derived for recurring deals with a known term." />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <Field label={`Amount (TCV)${req("amount")}`} htmlFor="amount" error={fe?.amount}>
            <Input id="amount" name="amount" inputMode="decimal" defaultValue={v("amount") === "0.00" ? "" : v("amount")} />
          </Field>
          <Field label="Currency" htmlFor="currency">
            <Select id="currency" name="currency" defaultValue={v("currency")}>
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Probability override (%)" htmlFor="probabilityOverride" hint={stage ? `Stage default ${stage.probability}%` : "Blank uses stage default"} error={fe?.probabilityOverride}>
            <Input id="probabilityOverride" name="probabilityOverride" type="number" min={0} max={100} defaultValue={v("probabilityOverride")} />
          </Field>
          <Field label="Revenue type" htmlFor="revenueType">
            <Select id="revenueType" name="revenueType" value={revenueType} onChange={(e) => setRevenueType(e.target.value as "one_time" | "recurring")}>
              <option value="one_time">One-time</option>
              <option value="recurring">Recurring</option>
            </Select>
          </Field>
          <Field label={`Contract term (months)${req("contractMonths")}`} htmlFor="contractMonths" error={fe?.contractMonths}>
            <Input id="contractMonths" name="contractMonths" type="number" min={1} max={240} defaultValue={v("contractMonths")} required={revenueType === "recurring" && !!req("contractMonths")} />
          </Field>
          <Field label="Forecast category" htmlFor="forecastCategory" hint="Blank derives it from the stage.">
            <Select id="forecastCategory" name="forecastCategory" defaultValue={opportunityId ? v("forecastCategory") : ""}>
              <option value="">Derive from stage</option>
              <option value="pipeline">Pipeline</option>
              <option value="best_case">Best case</option>
              <option value="commit">Commit</option>
              <option value="closed">Closed</option>
              <option value="omitted">Omitted</option>
            </Select>
          </Field>
          <Field label={`Expected close date${req("expectedCloseDate")}`} htmlFor="expectedCloseDate" error={fe?.expectedCloseDate}>
            <Input id="expectedCloseDate" name="expectedCloseDate" type="date" defaultValue={v("expectedCloseDate")} />
          </Field>
          <Field label="Estimated start date" htmlFor="estimatedStartDate">
            <Input id="estimatedStartDate" name="estimatedStartDate" type="date" defaultValue={v("estimatedStartDate")} />
          </Field>
          <Field label="Competitors" htmlFor="competitors" hint="Comma-separated">
            <Input id="competitors" name="competitors" defaultValue={(values.competitors ?? []).join(", ")} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Deal context" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Next step" htmlFor="nextStep" className="sm:col-span-2">
            <Input id="nextStep" name="nextStep" defaultValue={v("nextStep")} />
          </Field>
          <Field label="Decision criteria" htmlFor="decisionCriteria">
            <Textarea id="decisionCriteria" name="decisionCriteria" defaultValue={v("decisionCriteria")} />
          </Field>
          <Field label="Risks & dependencies" htmlFor="risks">
            <Textarea id="risks" name="risks" defaultValue={v("risks")} />
          </Field>
          <Field label="Technical requirements" htmlFor="technicalRequirements">
            <Textarea id="technicalRequirements" name="technicalRequirements" defaultValue={v("technicalRequirements")} />
          </Field>
          <Field label="Procurement requirements" htmlFor="procurementRequirements">
            <Textarea id="procurementRequirements" name="procurementRequirements" defaultValue={v("procurementRequirements")} />
          </Field>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href={opportunityId ? `/opportunities/${opportunityId}` : "/opportunities"}>Cancel</Link>
        </Button>
        <SubmitButton pendingLabel="Saving…">{opportunityId ? "Save changes" : "Create opportunity"}</SubmitButton>
      </div>
    </form>
  );
}

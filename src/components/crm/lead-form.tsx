"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveLeadAction } from "@/server/actions/crm";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormMessage, SubmitButton } from "@/components/ui/submit";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { EMPLOYEE_RANGES, LEAD_SOURCES } from "@/lib/crm-options";

export interface LeadFormValues {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  company?: string | null;
  website?: string | null;
  industry?: string | null;
  country?: string | null;
  region?: string | null;
  employeeRange?: string | null;
  source?: string | null;
  sourceDetail?: string | null;
  productInterest?: string | null;
  businessProblem?: string | null;
  statusId?: string | null;
  ownerId?: string | null;
  estimatedValue?: string | null;
  currency?: string | null;
  consentEmail?: boolean;
  doNotContact?: boolean;
}


export function LeadForm({
  leadId,
  values,
  statuses,
  owners,
  currencies,
  canAssign,
}: {
  leadId: string | null;
  values: LeadFormValues;
  statuses: { id: string; label: string }[];
  owners: { id: string; name: string }[];
  currencies: readonly string[];
  canAssign: boolean;
}) {
  const [state, action] = useActionState(saveLeadAction.bind(null, leadId), { status: "idle" });
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  const v = (k: keyof LeadFormValues) => (values[k] as string | null | undefined) ?? "";
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <Card>
        <CardHeader title="Person" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName" error={fe?.firstName}>
            <Input id="firstName" name="firstName" defaultValue={v("firstName")} />
          </Field>
          <Field label="Last name *" htmlFor="lastName" error={fe?.lastName}>
            <Input id="lastName" name="lastName" defaultValue={v("lastName")} required aria-invalid={!!fe?.lastName} />
          </Field>
          <Field label="Business email" htmlFor="email" error={fe?.email}>
            <Input id="email" name="email" type="email" defaultValue={v("email")} aria-invalid={!!fe?.email} />
          </Field>
          <Field label="Phone (with country code)" htmlFor="phone" error={fe?.phone}>
            <Input id="phone" name="phone" type="tel" placeholder="+91 98765 43210" defaultValue={v("phone")} />
          </Field>
          <Field label="Job title" htmlFor="jobTitle">
            <Input id="jobTitle" name="jobTitle" defaultValue={v("jobTitle")} />
          </Field>
          <Field label="Department" htmlFor="department">
            <Input id="department" name="department" defaultValue={v("department")} />
          </Field>
          <Field label="Personal email" htmlFor="personalEmail" error={fe?.personalEmail} hint="Only where the person has permitted it.">
            <Input id="personalEmail" name="personalEmail" type="email" defaultValue={v("personalEmail")} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Company" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Company" htmlFor="company">
            <Input id="company" name="company" defaultValue={v("company")} />
          </Field>
          <Field label="Website" htmlFor="website" error={fe?.website}>
            <Input id="website" name="website" placeholder="example.com" defaultValue={v("website")} />
          </Field>
          <Field label="Industry" htmlFor="industry">
            <Input id="industry" name="industry" defaultValue={v("industry")} />
          </Field>
          <Field label="Employees" htmlFor="employeeRange">
            <Select id="employeeRange" name="employeeRange" defaultValue={v("employeeRange")}>
              <option value="">—</option>
              {EMPLOYEE_RANGES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" name="country" defaultValue={v("country")} />
          </Field>
          <Field label="Region" htmlFor="region">
            <Input id="region" name="region" defaultValue={v("region")} />
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Qualification" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="statusId">
            <Select id="statusId" name="statusId" defaultValue={v("statusId")}>
              {leadId ? null : <option value="">Default (New)</option>}
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="ownerId" hint={canAssign ? "Leave blank to apply assignment rules." : "You can only assign leads to yourself."}>
            <Select id="ownerId" name="ownerId" defaultValue={v("ownerId")} disabled={!canAssign}>
              <option value="">{leadId ? "—" : "Assignment rules"}</option>
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
          <Field label="Source detail" htmlFor="sourceDetail">
            <Input id="sourceDetail" name="sourceDetail" placeholder="e.g. Contact form – /contact-centre-ai" defaultValue={v("sourceDetail")} />
          </Field>
          <Field label="Product / service interest" htmlFor="productInterest">
            <Input id="productInterest" name="productInterest" defaultValue={v("productInterest")} />
          </Field>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <Field label="Estimated value" htmlFor="estimatedValue" error={fe?.estimatedValue}>
              <Input id="estimatedValue" name="estimatedValue" inputMode="decimal" defaultValue={v("estimatedValue")} />
            </Field>
            <Field label="Currency" htmlFor="currency">
              <Select id="currency" name="currency" defaultValue={v("currency")}>
                <option value="">—</option>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Business problem / use case" htmlFor="businessProblem" className="sm:col-span-2">
            <Textarea id="businessProblem" name="businessProblem" defaultValue={v("businessProblem")} />
          </Field>
          <div className="flex flex-wrap gap-5 sm:col-span-2">
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="consentEmail" defaultChecked={values.consentEmail} className="size-3.5 accent-[var(--accent)]" />
              Consented to marketing email
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="doNotContact" defaultChecked={values.doNotContact} className="size-3.5 accent-[var(--accent)]" />
              Do not contact
            </label>
          </div>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href={leadId ? `/leads/${leadId}` : "/leads"}>Cancel</Link>
        </Button>
        <SubmitButton pendingLabel="Saving…">{leadId ? "Save changes" : "Create lead"}</SubmitButton>
      </div>
    </form>
  );
}

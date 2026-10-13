"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveAccountAction } from "@/server/actions/crm";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormMessage, SubmitButton } from "@/components/ui/submit";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ACCOUNT_STATUSES, EMPLOYEE_RANGES } from "@/lib/crm-options";

export interface AccountFormValues {
  name?: string;
  website?: string | null;
  industry?: string | null;
  country?: string | null;
  region?: string | null;
  headquarters?: string | null;
  employeeRange?: string | null;
  ownerId?: string | null;
  parentAccountId?: string | null;
  tier?: string | null;
  status?: string;
  isStrategic?: boolean;
  businessChallenges?: string | null;
  description?: string | null;
}

export function AccountForm({
  accountId,
  values,
  owners,
  parents,
}: {
  accountId: string | null;
  values: AccountFormValues;
  owners: { id: string; name: string }[];
  parents: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(saveAccountAction.bind(null, accountId), { status: "idle" });
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  const v = (k: keyof AccountFormValues) => (values[k] as string | null | undefined) ?? "";
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <Card>
        <CardHeader title="Organisation" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Account name *" htmlFor="name" error={fe?.name} className="sm:col-span-2">
            <Input id="name" name="name" defaultValue={v("name")} required />
          </Field>
          <Field label="Website / domain" htmlFor="website" error={fe?.website} hint="Used for duplicate detection and email matching.">
            <Input id="website" name="website" defaultValue={v("website")} placeholder="example.com" />
          </Field>
          <Field label="Industry" htmlFor="industry">
            <Input id="industry" name="industry" defaultValue={v("industry")} />
          </Field>
          <Field label="Headquarters" htmlFor="headquarters">
            <Input id="headquarters" name="headquarters" defaultValue={v("headquarters")} />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" name="country" defaultValue={v("country")} />
          </Field>
          <Field label="Region" htmlFor="region">
            <Input id="region" name="region" defaultValue={v("region")} />
          </Field>
          <Field label="Employees" htmlFor="employeeRange">
            <Select id="employeeRange" name="employeeRange" defaultValue={v("employeeRange")}>
              <option value="">—</option>
              {EMPLOYEE_RANGES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Parent account" htmlFor="parentAccountId">
            <Select id="parentAccountId" name="parentAccountId" defaultValue={v("parentAccountId")}>
              <option value="">None</option>
              {parents.filter((p) => p.id !== accountId).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Relationship" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={v("status") || "prospect"}>
              {ACCOUNT_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="ownerId">
            <Select id="ownerId" name="ownerId" defaultValue={v("ownerId")}>
              <option value="">{accountId ? "—" : "Me"}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tier" htmlFor="tier">
            <Select id="tier" name="tier" defaultValue={v("tier")}>
              <option value="">—</option>
              <option value="tier_1">Tier 1</option>
              <option value="tier_2">Tier 2</option>
              <option value="tier_3">Tier 3</option>
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-1.5 text-[13px]">
            <input type="checkbox" name="isStrategic" defaultChecked={values.isStrategic} className="size-3.5 accent-[var(--accent)]" />
            Strategic account
          </label>
          <Field label="Business challenges" htmlFor="businessChallenges" className="sm:col-span-2">
            <Textarea id="businessChallenges" name="businessChallenges" defaultValue={v("businessChallenges")} />
          </Field>
          <Field label="Description" htmlFor="description" className="sm:col-span-2">
            <Textarea id="description" name="description" defaultValue={v("description")} />
          </Field>
        </CardBody>
      </Card>
      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href={accountId ? `/accounts/${accountId}` : "/accounts"}>Cancel</Link>
        </Button>
        <SubmitButton pendingLabel="Saving…">{accountId ? "Save changes" : "Create account"}</SubmitButton>
      </div>
    </form>
  );
}

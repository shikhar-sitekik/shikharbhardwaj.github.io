"use client";

import Link from "next/link";
import { useActionState } from "react";
import { saveContactAction } from "@/server/actions/crm";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormMessage, SubmitButton } from "@/components/ui/submit";
import { Card, CardBody } from "@/components/ui/card";
import { BUYING_ROLE_LABELS } from "@/lib/crm-options";

export interface ContactFormValues {
  firstName?: string | null;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  seniority?: string | null;
  buyingRole?: string | null;
  accountId?: string | null;
  ownerId?: string | null;
  country?: string | null;
  preferredChannel?: string | null;
  linkedinUrl?: string | null;
  consentEmail?: boolean;
  doNotContact?: boolean;
}

export function ContactForm({
  contactId,
  values,
  owners,
  accounts,
}: {
  contactId: string | null;
  values: ContactFormValues;
  owners: { id: string; name: string }[];
  accounts: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(saveContactAction.bind(null, contactId), { status: "idle" });
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  const v = (k: keyof ContactFormValues) => (values[k] as string | null | undefined) ?? "";
  return (
    <form action={action} className="grid gap-4">
      <FormMessage state={state} />
      <Card>
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName">
            <Input id="firstName" name="firstName" defaultValue={v("firstName")} />
          </Field>
          <Field label="Last name *" htmlFor="lastName" error={fe?.lastName}>
            <Input id="lastName" name="lastName" defaultValue={v("lastName")} required />
          </Field>
          <Field label="Email" htmlFor="email" error={fe?.email}>
            <Input id="email" name="email" type="email" defaultValue={v("email")} />
          </Field>
          <Field label="Phone" htmlFor="phone" error={fe?.phone}>
            <Input id="phone" name="phone" type="tel" defaultValue={v("phone")} placeholder="+44 20 7946 0958" />
          </Field>
          <Field label="Account" htmlFor="accountId" error={fe?.accountId}>
            <Select id="accountId" name="accountId" defaultValue={v("accountId")}>
              <option value="">No account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" htmlFor="ownerId">
            <Select id="ownerId" name="ownerId" defaultValue={v("ownerId")}>
              <option value="">{contactId ? "—" : "Me"}</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Job title" htmlFor="jobTitle">
            <Input id="jobTitle" name="jobTitle" defaultValue={v("jobTitle")} />
          </Field>
          <Field label="Department" htmlFor="department">
            <Input id="department" name="department" defaultValue={v("department")} />
          </Field>
          <Field label="Seniority" htmlFor="seniority">
            <Select id="seniority" name="seniority" defaultValue={v("seniority")}>
              <option value="">—</option>
              {["C-level", "VP", "Director", "Manager", "Individual contributor"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Default buying role" htmlFor="buyingRole">
            <Select id="buyingRole" name="buyingRole" defaultValue={v("buyingRole")}>
              <option value="">—</option>
              {Object.entries(BUYING_ROLE_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Preferred channel" htmlFor="preferredChannel">
            <Select id="preferredChannel" name="preferredChannel" defaultValue={v("preferredChannel")}>
              <option value="">—</option>
              {["email", "phone", "meeting", "whatsapp", "teams"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" name="country" defaultValue={v("country")} />
          </Field>
          <Field label="LinkedIn profile URL" htmlFor="linkedinUrl" error={fe?.linkedinUrl} className="sm:col-span-2">
            <Input id="linkedinUrl" name="linkedinUrl" type="url" defaultValue={v("linkedinUrl")} placeholder="https://www.linkedin.com/in/…" />
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
          <Link href={contactId ? `/contacts/${contactId}` : "/contacts"}>Cancel</Link>
        </Button>
        <SubmitButton pendingLabel="Saving…">{contactId ? "Save changes" : "Create contact"}</SubmitButton>
      </div>
    </form>
  );
}

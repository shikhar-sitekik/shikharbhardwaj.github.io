"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signupAction } from "@/server/actions/auth";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/submit";

export function SignupForm() {
  const [state, action] = useActionState(signupAction, { status: "idle" });
  const fe = state.status === "error" ? state.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-3.5">
      <FormMessage state={state} />
      <Field label="Full name" htmlFor="name" error={fe?.name}>
        <Input id="name" name="name" autoComplete="name" required autoFocus />
      </Field>
      <Field label="Work email" htmlFor="email" error={fe?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" error={fe?.password} hint="At least 12 characters. A passphrase works well.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Workspace name" htmlFor="workspace" error={fe?.workspace}>
          <Input id="workspace" name="workspace" placeholder="Exato" required />
        </Field>
        <Field label="Base currency" htmlFor="currency">
          <Select id="currency" name="currency" defaultValue="USD">
            {["USD", "INR", "EUR", "GBP", "AED", "SGD", "AUD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton className="mt-1 h-9" pendingLabel="Creating workspace…">
        Create workspace
      </SubmitButton>
      <p className="text-center text-[12.5px] text-text-3">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

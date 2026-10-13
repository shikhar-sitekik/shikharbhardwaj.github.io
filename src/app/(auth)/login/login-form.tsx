"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginAction } from "@/server/actions/auth";
import { Field, Input } from "@/components/ui/input";
import { FormMessage, SubmitButton } from "@/components/ui/submit";

export function LoginForm({ next, allowSignup }: { next: string; allowSignup: boolean }) {
  const [state, action] = useActionState(loginAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-3.5">
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="mt-1 h-9" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
      {allowSignup ? (
        <p className="text-center text-[12.5px] text-text-3">
          New to the platform?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Create a workspace
          </Link>
        </p>
      ) : null}
    </form>
  );
}

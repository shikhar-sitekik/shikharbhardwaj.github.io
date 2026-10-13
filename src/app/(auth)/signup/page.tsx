import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@/server/env";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create workspace" };

export default function SignupPage() {
  if (!env().ALLOW_SIGNUP) redirect("/login");
  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-text">Create your workspace</h1>
      <p className="mt-1 mb-6 text-[13px] text-text-3">
        You will be the workspace administrator. Default roles, lead statuses and pipelines are created for you and can be
        changed later.
      </p>
      <SignupForm />
    </div>
  );
}

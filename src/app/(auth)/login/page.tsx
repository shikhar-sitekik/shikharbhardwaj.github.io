import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getContext } from "@/server/auth/context";
import { env } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getContext()) redirect("/");
  const { next } = await searchParams;
  return (
    <div>
      <h1 className="text-[20px] font-semibold tracking-[-0.015em] text-text">Sign in</h1>
      <p className="mt-1 mb-6 text-[13px] text-text-3">Use your work account to access your workspace.</p>
      <LoginForm next={next ?? "/"} allowSignup={env().ALLOW_SIGNUP} />
    </div>
  );
}

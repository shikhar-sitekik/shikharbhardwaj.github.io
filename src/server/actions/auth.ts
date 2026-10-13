"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getAuthState } from "@/server/auth/context";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password";
import {
  SESSION_COOKIE,
  createSession,
  invalidateAllUserSessions,
  invalidateSession,
  isLoginThrottled,
  recordLoginAttempt,
  setSessionTenant,
} from "@/server/auth/session";
import { env } from "@/server/env";
import { logger } from "@/server/lib/logger";
import { createUser, findUserByEmail, listUserWorkspaces, provisionTenant } from "@/server/services/provisioning";
import { normalizeEmail } from "@/server/domain/normalize";
import type { ActionState } from "./result";

async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

async function clientMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  return { ipAddress: ip, userAgent: h.get("user-agent") };
}

/** Only allow same-origin relative redirects. */
function safeNext(next: unknown): string {
  return typeof next === "string" && /^\/(?!\/)[\w\-/?=&%.]*$/.test(next) ? next : "/";
}

const DUMMY_HASH = "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const email = normalizeEmail(String(fd.get("email") ?? ""));
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { status: "error", message: "Enter your email and password." };
  const meta = await clientMeta();
  const keys = [`email:${email}`, ...(meta.ipAddress ? [`ip:${meta.ipAddress}`] : [])];
  if (await isLoginThrottled(keys)) {
    return { status: "error", message: "Too many failed attempts. Try again in 15 minutes." };
  }
  const user = await findUserByEmail(email);
  // Always run a hash comparison to keep timing uniform for unknown accounts.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.disabledAt) {
    await recordLoginAttempt(keys, false);
    logger.info("auth.login_failed", { reason: !user ? "unknown_user" : user.disabledAt ? "disabled" : "bad_password" });
    return { status: "error", message: "Incorrect email or password." };
  }
  await recordLoginAttempt([`email:${email}`], true);
  const workspaces = await listUserWorkspaces(user.id);
  const tenantId = workspaces.length === 1 ? workspaces[0]!.tenantId : null;
  const { token, expiresAt } = await createSession(user.id, tenantId, meta);
  await setSessionCookie(token, expiresAt);
  logger.info("auth.login", { userId: user.id });
  redirect(tenantId ? safeNext(fd.get("next")) : "/select-workspace");
}

const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(200),
  email: z.string().trim(),
  password: z.string(),
  workspace: z.string().trim().min(2, "Enter a workspace name.").max(100),
  currency: z.enum(["USD", "EUR", "GBP", "INR", "AED", "SGD", "AUD"]).default("USD"),
});

export async function signupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (!env().ALLOW_SIGNUP) return { status: "error", message: "Self-service sign-up is disabled. Ask an administrator for access." };
  const parsed = signupSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const i of parsed.error.issues) (fieldErrors[String(i.path[0])] ??= []).push(i.message);
    return { status: "error", message: "Please correct the highlighted fields.", fieldErrors };
  }
  const email = normalizeEmail(parsed.data.email);
  if (!email) return { status: "error", message: "Enter a valid email.", fieldErrors: { email: ["Enter a valid email."] } };
  const policy = passwordPolicyError(parsed.data.password);
  if (policy) return { status: "error", message: policy, fieldErrors: { password: [policy] } };
  if (await findUserByEmail(email)) {
    return { status: "error", message: "An account with this email already exists. Sign in instead.", fieldErrors: { email: ["Already registered."] } };
  }
  const user = await createUser({ email, name: parsed.data.name, passwordHash: await hashPassword(parsed.data.password) });
  const { tenantId } = await provisionTenant({
    workspaceName: parsed.data.workspace,
    baseCurrency: parsed.data.currency,
    owner: { userId: user.id },
  });
  const { token, expiresAt } = await createSession(user.id, tenantId, await clientMeta());
  await setSessionCookie(token, expiresAt);
  logger.info("auth.signup", { userId: user.id, tenantId });
  redirect("/");
}

export async function selectWorkspaceAction(fd: FormData): Promise<void> {
  const auth = await getAuthState();
  if (!auth) redirect("/login");
  const tenantId = String(fd.get("tenantId") ?? "");
  const workspaces = await listUserWorkspaces(auth.userId);
  if (!workspaces.some((w) => w.tenantId === tenantId)) redirect("/select-workspace");
  await setSessionTenant(auth.sessionId, tenantId);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const auth = await getAuthState();
  if (auth) await invalidateSession(auth.sessionId);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function logoutEverywhereAction(): Promise<void> {
  const auth = await getAuthState();
  if (auth) await invalidateAllUserSessions(auth.userId);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/permissions";
import { invalidateAllUserSessions, invalidateSession, listUserSessions } from "@/server/auth/session";
import { addMember, createTeam, updateMember, updateRole, updateTenantSettings } from "@/server/services/admin";
import { recomputeLeadScores } from "@/server/services/leads";
import { formToObject, runAction, type ActionState } from "./result";

export async function addMemberAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    await addMember(ctx, formToObject(fd));
    return { message: "Member added. Share the initial password with them securely; they should change it after signing in." };
  });
  revalidatePath("/settings/users");
  return res;
}

export async function updateMemberAction(membershipId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const roleId = String(fd.get("roleId") ?? "");
    const teamId = String(fd.get("teamId") ?? "");
    const status = String(fd.get("status") ?? "");
    await updateMember(ctx, membershipId, {
      roleId: roleId || undefined,
      teamId: teamId === "" ? null : teamId,
      status: status === "active" || status === "suspended" ? status : undefined,
    });
    return { message: "Member updated." };
  });
  revalidatePath("/settings/users");
  return res;
}

export async function createTeamAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    await createTeam(ctx, String(fd.get("name") ?? ""));
    return { message: "Team created." };
  });
  revalidatePath("/settings/users");
  return res;
}

export async function updateRoleAction(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    await updateRole(ctx, roleId, { permissions: fd.getAll("permissions").map(String), dataScope: String(fd.get("dataScope")) });
    return { message: "Role saved. Changes apply on each member's next request." };
  });
  revalidatePath("/settings/roles");
  return res;
}

const generalSchema = z.object({
  baseCurrency: z.string().length(3),
  timezone: z.string().min(1).max(64),
  staleLeadDays: z.coerce.number().int().min(1).max(365),
  staleOpportunityDays: z.coerce.number().int().min(1).max(365),
  warm: z.coerce.number().int().min(0).max(100),
  hot: z.coerce.number().int().min(0).max(100),
});

export async function updateGeneralSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const parsed = generalSchema.safeParse(Object.fromEntries(fd));
    if (!parsed.success) throw new ValidationError("Check the values entered.");
    const d = parsed.data;
    if (d.warm >= d.hot) throw new ValidationError("The hot threshold must be higher than the warm threshold.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: d.timezone });
    } catch {
      throw new ValidationError("Unknown timezone. Use an IANA name such as Asia/Kolkata.");
    }
    const fxRates: Record<string, number> = {};
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("fx:") || typeof v !== "string" || !v.trim()) continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`Invalid FX rate for ${k.slice(3)}.`);
      fxRates[k.slice(3)] = n;
    }
    const pool = fd.getAll("rr").map(String);
    await updateTenantSettings(ctx, {
      baseCurrency: d.baseCurrency,
      timezone: d.timezone,
      staleLeadDays: d.staleLeadDays,
      staleOpportunityDays: d.staleOpportunityDays,
      scoreThresholds: { warm: d.warm, hot: d.hot },
      fxRates,
      assignment: { mode: fd.get("rrMode") === "round_robin" && pool.length ? "round_robin" : "none", userIds: pool, cursor: 0 },
    });
    return { message: "Settings saved." };
  });
  revalidatePath("/", "layout");
  return res;
}

export async function updateScoringAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  const res = await runAction(async () => {
    const rules = ctx.tenant.settings.scoringRules.map((r) => {
      const raw = fd.get(`points:${r.id}`);
      const n = Number(raw);
      if (raw === null || !Number.isInteger(n) || n < -100 || n > 100) throw new ValidationError(`Points for “${r.label}” must be a whole number between -100 and 100.`);
      return { ...r, points: n };
    });
    await updateTenantSettings(ctx, { scoringRules: rules });
    const fresh = await (await import("@/server/auth/context")).loadTenantContext(ctx.userId, ctx.tenantId);
    const n = fresh ? await recomputeLeadScores(fresh) : 0;
    return { message: `Scoring saved; ${n} open leads re-scored.` };
  });
  revalidatePath("/settings/general");
  return res;
}

export async function revokeSessionAction(sessionId: string): Promise<void> {
  const ctx = await requireContext();
  const mine = await listUserSessions(ctx.userId);
  if (mine.some((s) => s.id === sessionId) && sessionId !== ctx.sessionId) await invalidateSession(sessionId);
  revalidatePath("/settings/profile");
}

export async function revokeOtherSessionsAction(): Promise<void> {
  const ctx = await requireContext();
  await invalidateAllUserSessions(ctx.userId, ctx.sessionId ?? undefined);
  revalidatePath("/settings/profile");
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await requireContext();
  return runAction(async () => {
    const { changePassword } = await import("@/server/services/account");
    await changePassword(ctx.userId, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""), ctx.sessionId);
    return { message: "Password changed. Other sessions have been signed out." };
  });
}


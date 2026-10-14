"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/context";
import {
  createLeadFromCapturedEmail,
  dismissCapturedEmail,
  regenerateMyCaptureAddress,
  rematchCapturedEmail,
} from "@/server/services/email-capture";
import { runAction, type ActionState } from "./result";

export async function regenerateCaptureAddressAction(): Promise<ActionState> {
  const ctx = await requireContext();
  const r = await runAction(async () => {
    await regenerateMyCaptureAddress(ctx);
    return { message: "New address issued. The old one no longer works." };
  });
  revalidatePath("/email");
  return r;
}

export async function dismissEmailAction(id: string): Promise<void> {
  const ctx = await requireContext();
  await runAction(() => dismissCapturedEmail(ctx, id));
  revalidatePath("/email");
}

export async function rematchEmailAction(id: string): Promise<ActionState> {
  const ctx = await requireContext();
  const r = await runAction(async () => {
    const n = await rematchCapturedEmail(ctx, id);
    return { message: n ? `Logged to ${n} record${n === 1 ? "" : "s"}.` : "Still no matching contact, lead or company." };
  });
  revalidatePath("/email");
  return r;
}

export async function createLeadFromEmailAction(id: string): Promise<ActionState> {
  const ctx = await requireContext();
  let leadId: string | null = null;
  const r = await runAction(async () => {
    leadId = (await createLeadFromCapturedEmail(ctx, id)).leadId;
  });
  if (r.status === "success" && leadId) redirect(`/leads/${leadId}`);
  revalidatePath("/email");
  return r;
}

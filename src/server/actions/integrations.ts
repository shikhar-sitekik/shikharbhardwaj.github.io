"use server";

import { revalidatePath } from "next/cache";
import { requireContext } from "@/server/auth/context";
import { createFormConnection, rotateConnectionSecret, setConnectionEnabled } from "@/server/services/integrations";
import { runAction } from "./result";

export type SecretResult = { ok: true; id: string; secret: string } | { ok: false; message: string };

export async function createFormConnectionAction(_prev: SecretResult | null, fd: FormData): Promise<SecretResult> {
  const ctx = await requireContext();
  let out: { id: string; secret: string } | null = null;
  const r = await runAction(async () => {
    out = await createFormConnection(ctx, {
      name: String(fd.get("name") ?? ""),
      defaultSource: String(fd.get("defaultSource") ?? "website"),
      defaultOwnerId: String(fd.get("defaultOwnerId") ?? "") || null,
    });
  });
  revalidatePath("/integrations");
  if (r.status === "error" || !out) return { ok: false, message: r.status === "error" ? r.message : "Failed" };
  const created = out as { id: string; secret: string };
  return { ok: true, id: created.id, secret: created.secret };
}

export async function rotateSecretAction(id: string): Promise<SecretResult> {
  const ctx = await requireContext();
  let secret = "";
  const r = await runAction(async () => {
    secret = await rotateConnectionSecret(ctx, id);
  });
  revalidatePath("/integrations");
  return r.status === "error" ? { ok: false, message: r.message } : { ok: true, id, secret };
}

export async function toggleConnectionAction(id: string, enabled: boolean): Promise<void> {
  const ctx = await requireContext();
  await runAction(() => setConnectionEnabled(ctx, id, enabled));
  revalidatePath("/integrations");
}

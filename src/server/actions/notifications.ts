"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireContext } from "@/server/auth/context";
import { withScope } from "@/server/db/client";
import { notifications } from "@/server/db/schema";

export async function markAllReadAction(): Promise<void> {
  const ctx = await requireContext();
  await withScope(ctx, (tx) =>
    tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt))),
  );
  revalidatePath("/", "layout");
}

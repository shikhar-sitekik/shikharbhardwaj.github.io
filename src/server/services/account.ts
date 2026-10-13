import "server-only";
import { eq } from "drizzle-orm";
import { withScope } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ValidationError } from "@/server/auth/permissions";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password";
import { invalidateAllUserSessions } from "@/server/auth/session";

/** Self-service password change; signs out every other session. */
export async function changePassword(userId: string, current: string, next: string, keepSessionId: string | null): Promise<void> {
  const policy = passwordPolicyError(next);
  if (policy) throw new ValidationError(policy, { next: [policy] });
  await withScope({ tenantId: null, userId }, async (tx) => {
    const [u] = await tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (!u?.hash || !(await verifyPassword(current, u.hash))) throw new ValidationError("Your current password is incorrect.", { current: ["Incorrect password."] });
    await tx.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId));
  });
  await invalidateAllUserSessions(userId, keepSessionId ?? undefined);
}

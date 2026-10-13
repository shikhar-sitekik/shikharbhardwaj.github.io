import "server-only";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/permissions";
import { logger } from "@/server/lib/logger";

export type ActionState =
  | { status: "idle" }
  | { status: "success"; message?: string }
  | { status: "error"; message: string; fieldErrors?: Record<string, string[]> };

export const idle: ActionState = { status: "idle" };

/** Maps domain errors to user-safe action results; logs anything unexpected. */
export async function runAction(fn: () => Promise<{ message?: string } | void>): Promise<ActionState> {
  try {
    const r = (await fn()) ?? {};
    return { status: "success", ...r };
  } catch (err) {
    if (err instanceof ValidationError) return { status: "error", message: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof ForbiddenError || err instanceof NotFoundError) return { status: "error", message: err.message };
    // Next.js control-flow errors (redirect/notFound) must propagate.
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string") {
      const digest = (err as { digest: string }).digest;
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR")) throw err;
    }
    logger.error("action.failed", { error: err });
    return { status: "error", message: "Something went wrong. The error has been logged; please try again." };
  }
}

/** FormData → plain object (last value wins; repeated keys collected when `multi` lists them). */
export function formToObject(fd: FormData, multi: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (typeof v !== "string") continue;
    if (multi.includes(k)) ((out[k] ??= []) as string[]).push(v);
    else out[k] = v;
  }
  return out;
}

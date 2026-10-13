import "server-only";
import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@/server/auth/permissions";

/**
 * Loads a record for a page. Not-found and out-of-scope records both render
 * 404 so the existence of records outside a user's scope is not disclosed.
 */
export async function loadOr404<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound();
    throw err;
  }
}

/** Reads a single string search param. */
export function sp(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v.slice(0, 200) : undefined;
}

export function isUuid(v: string | undefined): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

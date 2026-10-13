/**
 * Structured JSON logger. Never pass secrets or message bodies; errors are
 * reduced to name/message/stack. Ship stdout to the observability provider.
 */
type Level = "debug" | "info" | "warn" | "error";

function serialise(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Error) {
      out[k] = { name: v.name, message: v.message, stack: process.env.NODE_ENV === "production" ? undefined : v.stack, cause: v.cause instanceof Error ? v.cause.message : undefined };
    } else out[k] = v;
  }
  return out;
}

function log(level: Level, event: string, meta: Record<string, unknown> = {}): void {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...serialise(meta) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (e: string, m?: Record<string, unknown>) => log("debug", e, m),
  info: (e: string, m?: Record<string, unknown>) => log("info", e, m),
  warn: (e: string, m?: Record<string, unknown>) => log("warn", e, m),
  error: (e: string, m?: Record<string, unknown>) => log("error", e, m),
};

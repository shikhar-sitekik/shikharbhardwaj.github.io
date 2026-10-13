import "server-only";
import { z } from "zod";
import { appDatabaseUrl } from "@/server/db/urls";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().min(1).default("Exato One"),
  CRON_SECRET: z.string().min(16).optional(),
  /** Allow self-service workspace creation from /signup. Disable in single-tenant production. */
  ALLOW_SIGNUP: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const parsed = schema.safeParse({
      ...process.env,
      DATABASE_URL: appDatabaseUrl(process.env),
      APP_URL: process.env.APP_URL || (vercelUrl ? `https://${vercelUrl}` : undefined),
    });
    if (!parsed.success) {
      const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment configuration: ${keys}`);
    }
    cached = parsed.data;
  }
  return cached;
}

import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";

/** Resets and migrates the dedicated E2E database. */
export default async function globalSetup(): Promise<void> {
  const env = config({ path: ".env.e2e" }).parsed ?? {};
  const url = env.DATABASE_MIGRATION_URL;
  if (!url || !url.includes("exato_e2e")) throw new Error("Refusing to reset a non-E2E database");
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end();
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env: { ...process.env, ...env }, stdio: "inherit" });
}

/**
 * Vercel build step: apply migrations and ensure the exato_app login exists,
 * so a fresh Vercel + Neon project needs no terminal access.
 * Skips database work when no migration URL is configured (e.g. preview without DB).
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import postgres from "postgres";
import { migrationDatabaseUrl } from "../src/server/db/urls";

async function main(): Promise<void> {
  const url = migrationDatabaseUrl();
  if (!url) {
    console.warn("[vercel-build] No database configured; skipping migrations.");
  } else {
    execFileSync("npx", ["tsx", "scripts/migrate.ts"], { stdio: "inherit", env: process.env });
    const pw = process.env.EXATO_APP_DB_PASSWORD;
    if (pw) {
      if (pw.length < 16) throw new Error("EXATO_APP_DB_PASSWORD must be at least 16 characters.");
      const sql = postgres(url, { max: 1, onnotice: () => undefined });
      try {
        // Password is passed as a literal via format(%L) to avoid injection.
        await sql`select set_config('exato.pw', ${pw}, false)`;
        await sql.unsafe(`DO $$ BEGIN EXECUTE format('ALTER ROLE exato_app WITH LOGIN PASSWORD %L', current_setting('exato.pw')); END $$;`);
        console.log("[vercel-build] exato_app login configured.");
      } finally {
        await sql.end();
      }
    }
  }
  execFileSync("npx", ["next", "build"], { stdio: "inherit", env: process.env });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

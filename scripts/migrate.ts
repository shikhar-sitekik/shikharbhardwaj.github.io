/**
 * Applies SQL migrations in ./drizzle using the owner/migration connection.
 * Usage: DATABASE_MIGRATION_URL=... npx tsx scripts/migrate.ts
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { migrationDatabaseUrl } from "../src/server/db/urls";

async function main(): Promise<void> {
  const url = migrationDatabaseUrl();
  if (!url) throw new Error("DATABASE_MIGRATION_URL (or DATABASE_URL_UNPOOLED) is required");
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

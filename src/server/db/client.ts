import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/server/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

const globalForDb = globalThis as unknown as { __exatoSql?: postgres.Sql; __exatoDb?: Database };

function create(): Database {
  const client =
    globalForDb.__exatoSql ??
    postgres(env().DATABASE_URL, {
      max: env().DB_POOL_MAX,
      // Required for transaction-mode poolers (Supabase Supavisor :6543 / PgBouncer).
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 10,
      connection: { statement_timeout: 15_000 },
    });
  if (env().NODE_ENV !== "production") globalForDb.__exatoSql = client;
  return drizzle(client, { schema });
}

/** Raw database handle. Prefer `withTenant` for anything tenant-owned. */
export function db(): Database {
  if (!globalForDb.__exatoDb) globalForDb.__exatoDb = create();
  return globalForDb.__exatoDb;
}

export interface DbScope {
  tenantId: string | null;
  userId: string | null;
}

/**
 * Runs `fn` in a transaction with Postgres RLS context set. Every tenant-owned
 * query must go through here so the database enforces isolation even if
 * application filtering is wrong.
 */
export async function withScope<T>(scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${scope.tenantId ?? ""}, true), set_config('app.user_id', ${scope.userId ?? ""}, true)`,
    );
    return fn(tx);
  });
}

/** Readiness probe used by /api/health and the System health page. */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  try {
    await db().execute(sql`select 1`);
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - started) };
  }
}

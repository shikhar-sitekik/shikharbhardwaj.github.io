/**
 * Resolves database URLs from the environment. Supports two setups:
 *
 * 1. Explicit: DATABASE_URL = app role (exato_app) URL, DATABASE_MIGRATION_URL = owner URL.
 * 2. Vercel + Neon integration: the integration sets DATABASE_URL (owner, pooled)
 *    and DATABASE_URL_UNPOOLED (owner, direct). Set EXATO_APP_DB_PASSWORD and the
 *    app connects as exato_app on the same host; the build step creates that login.
 */
type EnvLike = Record<string, string | undefined>;

export function migrationDatabaseUrl(env: EnvLike = process.env): string | undefined {
  return env.DATABASE_MIGRATION_URL || env.DATABASE_URL_UNPOOLED || (env.EXATO_APP_DB_PASSWORD ? env.DATABASE_URL : undefined);
}

export function appDatabaseUrl(env: EnvLike = process.env): string | undefined {
  if (env.APP_DATABASE_URL) return env.APP_DATABASE_URL;
  const base = env.DATABASE_URL;
  if (!base || !env.EXATO_APP_DB_PASSWORD) return base;
  const u = new URL(base);
  u.username = "exato_app";
  u.password = env.EXATO_APP_DB_PASSWORD;
  return u.toString();
}

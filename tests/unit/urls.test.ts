import { describe, expect, it } from "vitest";
import { appDatabaseUrl, migrationDatabaseUrl } from "@/server/db/urls";

describe("database URL resolution (Vercel + Neon)", () => {
  const env = {
    DATABASE_URL: "postgresql://neondb_owner:ownerpw@ep-x-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    DATABASE_URL_UNPOOLED: "postgresql://neondb_owner:ownerpw@ep-x.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    EXATO_APP_DB_PASSWORD: "app-password-123456",
  };
  it("connects the app as exato_app on the pooled host, without channel_binding", () => {
    const u = new URL(appDatabaseUrl(env)!);
    expect(u.username).toBe("exato_app");
    expect(u.password).toBe("app-password-123456");
    expect(u.hostname).toBe("ep-x-pooler.us-east-1.aws.neon.tech");
    expect(u.searchParams.get("sslmode")).toBe("require");
    expect(u.searchParams.has("channel_binding")).toBe(false);
  });
  it("migrates as the owner over the direct (unpooled) host", () => {
    const u = new URL(migrationDatabaseUrl(env)!);
    expect(u.username).toBe("neondb_owner");
    expect(u.hostname).toBe("ep-x.us-east-1.aws.neon.tech");
    expect(u.searchParams.has("channel_binding")).toBe(false);
  });
  it("leaves explicit setups unchanged", () => {
    expect(appDatabaseUrl({ DATABASE_URL: "postgres://exato_app:x@localhost:5432/db" })).toBe("postgres://exato_app:x@localhost:5432/db");
  });
});

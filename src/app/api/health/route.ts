import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

/** Liveness + database readiness. Exposes no configuration or internals. */
export async function GET() {
  const started = Date.now();
  try {
    await db().execute(sql`select 1`);
    return NextResponse.json(
      { status: "ok", db: "ok", latencyMs: Date.now() - started, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "degraded", db: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

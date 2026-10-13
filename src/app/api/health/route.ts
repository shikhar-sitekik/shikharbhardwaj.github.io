import { NextResponse } from "next/server";
import { pingDatabase } from "@/server/db/client";

/** Liveness + database readiness. Exposes no configuration or internals. */
export async function GET() {
  const db = await pingDatabase();
  return NextResponse.json(
    { status: db.ok ? "ok" : "degraded", db: db.ok ? "ok" : "unreachable", latencyMs: db.latencyMs, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { runJobs } from "@/server/jobs";
import { purgeExpiredAuthRecords } from "@/server/auth/session";

export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = env().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Vercel Cron entry point (see vercel.json). Requires Authorization: Bearer $CRON_SECRET. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runJobs({ maxMs: 50_000 });
  await purgeExpiredAuthRecords();
  return NextResponse.json({ ok: true, ...result });
}

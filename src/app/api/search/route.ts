import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/auth/context";
import { globalSearch } from "@/server/services/search";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const hits = await globalSearch(ctx, q);
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "private, no-store" } });
}

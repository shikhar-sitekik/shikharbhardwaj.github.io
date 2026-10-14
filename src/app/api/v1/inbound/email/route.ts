import { NextResponse, type NextRequest } from "next/server";
import { MAX_INBOUND_BYTES, handleInboundEmail, inboundAuthorized } from "@/server/services/email-capture";
import { logger } from "@/server/lib/logger";

/**
 * Postmark inbound email webhook (HTTP basic auth). Each user BCCs or forwards
 * mail to their personal capture address; see INTEGRATIONS.md → Email capture.
 */
export async function POST(req: NextRequest) {
  if (!inboundAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="inbound"' } });
  }
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_INBOUND_BYTES) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  try {
    const r = await handleInboundEmail(await req.text());
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error("email_capture.error", { error: err });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

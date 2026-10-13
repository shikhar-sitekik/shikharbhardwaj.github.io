import { NextResponse, type NextRequest } from "next/server";
import { handleInboundForm } from "@/server/services/integrations";
import { logger } from "@/server/lib/logger";

/**
 * Public, signature-authenticated endpoint for website form submissions.
 * See INTEGRATIONS.md → Website forms for the signing scheme.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await params;
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 64 * 1024) return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  try {
    const raw = await req.text();
    const r = await handleInboundForm(connectionId, raw, req.headers);
    return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    logger.error("webhook.error", { connectionId, error: err });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

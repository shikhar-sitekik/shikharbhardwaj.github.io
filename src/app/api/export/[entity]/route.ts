import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/server/auth/context";
import { ForbiddenError } from "@/server/auth/permissions";
import { exportRows, toCsv, toXlsx, type ExportEntity } from "@/server/services/exports";

const ENTITIES: ExportEntity[] = ["leads", "accounts", "contacts", "opportunities"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { entity } = await params;
  if (!ENTITIES.includes(entity as ExportEntity)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const sp = req.nextUrl.searchParams;
    const { rows, truncated } = await exportRows(ctx, entity as ExportEntity, sp);
    const stamp = new Date().toISOString().slice(0, 10);
    const headers: Record<string, string> = { "Cache-Control": "private, no-store", "X-Export-Truncated": truncated ? "true" : "false" };
    if (sp.get("format") === "xlsx") {
      const body = await toXlsx(rows, entity);
      return new NextResponse(Buffer.from(body), {
        headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${entity}-${stamp}.xlsx"` },
      });
    }
    return new NextResponse(toCsv(rows), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${entity}-${stamp}.csv"` },
    });
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw err;
  }
}

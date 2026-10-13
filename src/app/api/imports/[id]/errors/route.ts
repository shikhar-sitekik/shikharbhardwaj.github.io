import Papa from "papaparse";
import { NextResponse } from "next/server";
import { getContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/auth/permissions";
import { importErrorRows } from "@/server/services/imports";
import { csvSafe } from "@/server/domain/normalize";

/** Downloads rejected/failed/skipped rows with their original values and reasons. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const { job, rows } = await importErrorRows(ctx, id);
    const data: Record<string, string | number>[] = rows.map((r) => ({
      "Row number": r.rowNumber,
      Status: r.status,
      Errors: r.errors.join(" | "),
      ...Object.fromEntries(job.headers.map((h) => [h, csvSafe(r.raw[h] ?? "")])),
    }));
    const csv = Papa.unparse<Record<string, string | number>>(data.length ? data : [{ "Row number": "", Status: "", Errors: "No rejected rows" }]);
    return new NextResponse(`﻿${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-${id.slice(0, 8)}-errors.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }
}

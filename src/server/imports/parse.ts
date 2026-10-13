import "server-only";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import Papa from "papaparse";

export const IMPORT_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxRows: 20_000,
  maxColumns: 100,
  maxCellChars: 5_000,
};

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

export class ImportFileError extends Error {}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if ("text" in v && typeof v.text === "string") return v.text; // hyperlink
    if ("result" in v) return cellToString((v as { result: ExcelJS.CellValue }).result ?? null); // formula: use cached result only
    if ("error" in v) return "";
    return "";
  }
  return String(v);
}

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}

function clip(s: string): string {
  return s.length > IMPORT_LIMITS.maxCellChars ? s.slice(0, IMPORT_LIMITS.maxCellChars) : s;
}

export function detectFormat(fileName: string, bytes: Uint8Array): "csv" | "xlsx" {
  const lower = fileName.toLowerCase();
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"
  if (lower.endsWith(".xlsx")) {
    if (!isZip) throw new ImportFileError("This .xlsx file is not a valid Excel workbook.");
    return "xlsx";
  }
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    if (isZip) throw new ImportFileError("This file looks like a workbook, not CSV. Save it as .xlsx.");
    return "csv";
  }
  throw new ImportFileError("Unsupported file type. Upload a .csv or .xlsx file.");
}

export function parseCsv(text: string): ParsedSheet {
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<string[]>(clean, { skipEmptyLines: "greedy" });
  const data = result.data;
  if (data.length === 0) throw new ImportFileError("The file is empty.");
  const headerRow = data[0] ?? [];
  if (headerRow.length > IMPORT_LIMITS.maxColumns) throw new ImportFileError(`Too many columns (max ${IMPORT_LIMITS.maxColumns}).`);
  const headers = dedupeHeaders(headerRow.map(String));
  const body = data.slice(1);
  if (body.length > IMPORT_LIMITS.maxRows) throw new ImportFileError(`Too many rows (${body.length}). The limit is ${IMPORT_LIMITS.maxRows} per import; split the file.`);
  const rows = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, clip(String(r[i] ?? "").trim())])));
  return { name: "CSV", headers, rows, rowCount: rows.length };
}

/**
 * Streams an .xlsx workbook. Only cached values are read; formulas are never
 * evaluated, macros are not supported (.xlsm rejected by extension), and
 * row/column/cell caps bound memory use.
 */
export async function parseXlsx(bytes: Uint8Array, wantedSheet?: string | null): Promise<{ sheets: { name: string; rowCount: number }[]; selected: ParsedSheet }> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(Buffer.from(bytes)), {
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    worksheets: "emit",
    entries: "emit",
  });
  const sheets: { name: string; rowCount: number }[] = [];
  let selected: ParsedSheet | null = null;
  let totalRows = 0;
  for await (const ws of reader) {
    const name = (ws as unknown as { name?: string }).name ?? `Sheet ${sheets.length + 1}`;
    let headers: string[] | null = null;
    const rows: Record<string, string>[] = [];
    let count = 0;
    const capture = !selected && (!wantedSheet || wantedSheet === name);
    for await (const row of ws) {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellToString);
      if (values.every((v) => v.trim() === "")) continue;
      if (!headers) {
        if (values.length > IMPORT_LIMITS.maxColumns) throw new ImportFileError(`Sheet "${name}" has too many columns (max ${IMPORT_LIMITS.maxColumns}).`);
        headers = dedupeHeaders(values);
        continue;
      }
      count += 1;
      totalRows += 1;
      if (totalRows > IMPORT_LIMITS.maxRows * 3) throw new ImportFileError("Workbook is too large to process.");
      if (capture) {
        if (count > IMPORT_LIMITS.maxRows) throw new ImportFileError(`Sheet "${name}" has more than ${IMPORT_LIMITS.maxRows} rows; split the file.`);
        rows.push(Object.fromEntries(headers.map((h, i) => [h, clip((values[i] ?? "").trim())])));
      }
    }
    sheets.push({ name, rowCount: count });
    if (capture && headers) selected = { name, headers, rows, rowCount: rows.length };
  }
  if (!selected) {
    if (wantedSheet) throw new ImportFileError(`Sheet "${wantedSheet}" was not found or is empty.`);
    throw new ImportFileError("The workbook has no sheets with data.");
  }
  return { sheets, selected };
}

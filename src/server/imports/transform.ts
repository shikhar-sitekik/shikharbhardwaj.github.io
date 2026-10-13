import {
  cleanText,
  normalizeCurrency,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  parseAmount,
  parseDate,
} from "@/server/domain/normalize";
import { IMPORT_FIELDS, type ImportEntity } from "./fields";

export type RowValues = Record<string, string | number | boolean | null>;

export interface TransformResult {
  values: RowValues;
  errors: string[];
}

const TRUE = new Set(["true", "yes", "y", "1", "opted in", "opt in", "subscribed"]);
const FALSE = new Set(["false", "no", "n", "0", "", "opted out"]);

/** Splits "Priya Shah" → first "Priya", last "Shah"; single token → last name. */
export function splitName(full: string): { firstName: string | null; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: null, lastName: parts[0] ?? "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] ?? "" };
}

/**
 * Applies a column mapping to one raw row, normalising and validating each
 * value. Never throws: problems are returned as human-readable errors so the
 * row can be reported, not silently dropped.
 */
export function transformRow(
  raw: Record<string, string>,
  mapping: Record<string, string>,
  entity: ImportEntity,
  opts: { dateOrder?: "dmy" | "mdy" } = {},
): TransformResult {
  const fields = IMPORT_FIELDS[entity];
  const values: RowValues = {};
  const errors: string[] = [];
  for (const [header, key] of Object.entries(mapping)) {
    if (!key) continue;
    const field = fields.find((f) => f.key === key);
    if (!field) continue;
    const input = (raw[header] ?? "").toString().trim();
    if (input === "") {
      values[key] = values[key] ?? null;
      continue;
    }
    switch (field.type) {
      case "email": {
        const e = normalizeEmail(input);
        if (!e) errors.push(`${field.label}: "${input.slice(0, 60)}" is not a valid email`);
        values[key] = e;
        break;
      }
      case "phone": {
        const p = normalizePhone(input);
        if (!p) errors.push(`${field.label}: "${input.slice(0, 30)}" is not a valid phone number`);
        values[key] = p;
        break;
      }
      case "domain": {
        const d = normalizeDomain(input);
        if (!d) errors.push(`${field.label}: "${input.slice(0, 60)}" is not a valid website`);
        values[key] = d;
        break;
      }
      case "money": {
        const a = parseAmount(input);
        if (a === null) errors.push(`${field.label}: "${input.slice(0, 30)}" is not a valid amount`);
        values[key] = a;
        break;
      }
      case "currency": {
        const c = normalizeCurrency(input);
        if (!c) errors.push(`${field.label}: "${input.slice(0, 10)}" is not a supported currency`);
        values[key] = c;
        break;
      }
      case "date": {
        const d = parseDate(input, opts.dateOrder ?? "dmy");
        if (!d) errors.push(`${field.label}: "${input.slice(0, 30)}" is not a recognised date`);
        values[key] = d;
        break;
      }
      case "boolean": {
        const l = input.toLowerCase();
        if (TRUE.has(l)) values[key] = true;
        else if (FALSE.has(l)) values[key] = false;
        else {
          errors.push(`${field.label}: "${input.slice(0, 20)}" is not yes/no`);
          values[key] = null;
        }
        break;
      }
      case "integer": {
        const n = Number(input);
        if (!Number.isInteger(n) || n < 0) {
          errors.push(`${field.label}: "${input.slice(0, 20)}" is not a whole number`);
          values[key] = null;
        } else values[key] = n;
        break;
      }
      case "enum": {
        const l = input.toLowerCase().replace(/[\s-]+/g, "_");
        const match = field.options?.find((o) => o === l) ?? (l === "one_off" || l === "onetime" ? "one_time" : undefined);
        if (!match) errors.push(`${field.label}: "${input.slice(0, 30)}" must be one of ${field.options?.join(", ")}`);
        values[key] = match ?? null;
        break;
      }
      case "longtext":
        values[key] = cleanText(input, 4000);
        break;
      default:
        values[key] = cleanText(input, 300);
    }
  }
  if (typeof values.fullName === "string" && !values.lastName) {
    const { firstName, lastName } = splitName(values.fullName);
    values.lastName = lastName;
    if (!values.firstName) values.firstName = firstName;
  }
  delete values.fullName;
  for (const f of fields) {
    if (f.required && (values[f.key] === null || values[f.key] === undefined || values[f.key] === "")) {
      if (!errors.some((e) => e.startsWith(f.label))) errors.push(`${f.label} is required`);
    }
  }
  return { values, errors };
}

/** Pure data-normalisation helpers used by forms, imports and dedupe. */

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Consumer mailbox providers: not used for account-domain matching. */
export const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "live.com",
  "msn.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "zoho.com",
  "yandex.com", "rediffmail.com", "mail.com",
]);

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (!v) return null;
  return EMAIL_RE.test(v) && v.length <= 254 ? v : null;
}

export function isValidEmail(input: string): boolean {
  return normalizeEmail(input) !== null;
}

export function emailDomain(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  if (!e) return null;
  return e.slice(e.lastIndexOf("@") + 1);
}

export function isBusinessEmail(email: string | null | undefined): boolean {
  const d = emailDomain(email);
  return d !== null && !FREE_EMAIL_DOMAINS.has(d);
}

/** "https://www.Exato.ai/path?q" → "exato.ai". Returns null when not a plausible host. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  v = v.split(/[/?#]/)[0] ?? "";
  v = v.replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v)) return null;
  return v;
}

export function normalizeWebsite(input: string | null | undefined): string | null {
  const d = normalizeDomain(input);
  return d ? `https://${d}` : null;
}

/**
 * Light E.164-style phone normalisation without a carrier database:
 * keeps a leading "+", strips formatting, converts a leading "00" to "+".
 * Returns null for implausible lengths. Full validation (libphonenumber)
 * is a documented follow-up.
 */
export function normalizePhone(input: string | null | undefined, defaultCountryCode?: string): string | null {
  if (!input) return null;
  let v = input.trim();
  if (!v) return null;
  v = v.replace(/(?:ext\.?|x)\s*\d+$/i, "").trim();
  const plus = v.startsWith("+") || v.startsWith("00");
  let digits = v.replace(/\D/g, "");
  if (v.startsWith("00")) digits = digits.slice(2);
  if (!plus && defaultCountryCode) {
    digits = `${defaultCountryCode.replace(/\D/g, "")}${digits.replace(/^0+/, "")}`;
  }
  if (digits.length < 7 || digits.length > 15) return null;
  return plus || defaultCountryCode ? `+${digits}` : digits;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
}

/**
 * Parses common business date formats to ISO yyyy-mm-dd.
 * Ambiguous numeric dates (03/04/2025) follow `order` (default day-first,
 * matching Exato's primary markets); this is surfaced in the import UI.
 */
export function parseDate(input: unknown, order: "dmy" | "mdy" = "dmy"): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime())
      ? null
      : isoDate(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
  }
  if (typeof input === "number") {
    // Excel serial date (1900 system).
    if (input > 20000 && input < 80000) {
      const ms = Math.round((input - 25569) * 864e5);
      const d = new Date(ms);
      return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(input).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    if (a > 12) return isoDate(y, b, a);
    if (b > 12) return isoDate(y, a, b);
    return order === "dmy" ? isoDate(y, b, a) : isoDate(y, a, b);
  }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]+(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2]!.slice(0, m[2]!.toLowerCase() === "sept" ? 4 : 3).toLowerCase()];
    return mon ? isoDate(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    return mon ? isoDate(Number(m[3]), mon, Number(m[2])) : null;
  }
  return null;
}

/** ISO-4217 currencies supported for deals. Extend via configuration as needed. */
export const CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "AED", "SAR", "SGD", "AUD", "CAD", "JPY", "CHF", "ZAR", "QAR", "MYR", "NZD",
] as const;

export function normalizeCurrency(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim().toUpperCase();
  return (CURRENCIES as readonly string[]).includes(v) ? v : null;
}

/** Parses "1,250,000.50", "$1.2m", "45k" to a fixed 2dp decimal string. */
export function parseAmount(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? input.toFixed(2) : null;
  let s = String(input).trim().toLowerCase().replace(/[\s,$€£₹]/g, "").replace(/^(usd|eur|gbp|inr|aed)/, "");
  let mult = 1;
  if (s.endsWith("k")) { mult = 1e3; s = s.slice(0, -1); }
  else if (s.endsWith("m") || s.endsWith("mn")) { mult = 1e6; s = s.replace(/mn?$/, ""); }
  else if (s.endsWith("bn") || s.endsWith("b")) { mult = 1e9; s = s.replace(/bn?$/, ""); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s) * mult;
  if (!Number.isFinite(n) || n > 1e15) return null;
  return n.toFixed(2);
}

export function cleanText(input: unknown, max = 2000): string | null {
  if (input === null || input === undefined) return null;
  // Strip control characters except tab/newline.
  const s = String(input).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s ? s.slice(0, max) : null;
}

/** Neutralises spreadsheet formula injection when exporting user-controlled text. */
export function csvSafe(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

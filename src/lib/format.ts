/** Locale-aware formatting helpers shared by server and client components. */

export function formatMoney(
  value: string | number | null | undefined,
  currency: string,
  opts: { compact?: boolean; locale?: string } = {},
): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(opts.locale ?? "en-US", {
    style: "currency",
    currency,
    notation: opts.compact ? "compact" : "standard",
    maximumFractionDigits: opts.compact ? 1 : 0,
  }).format(n);
}

export function formatNumber(n: number, locale = "en-US"): string {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatPercent(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDate(
  value: Date | string | null | undefined,
  opts: { timeZone?: string; locale?: string; withTime?: boolean } = {},
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  const dateOnly = typeof value === "string" && value.length === 10;
  return new Intl.DateTimeFormat(opts.locale ?? "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(opts.withTime && !dateOnly ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: dateOnly ? "UTC" : opts.timeZone ?? "UTC",
  }).format(d);
}

export function relativeTime(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  const diff = d.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 864e5],
    ["month", 30 * 864e5],
    ["week", 7 * 864e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

export function personName(first: string | null | undefined, last: string): string {
  return [first, last].filter(Boolean).join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

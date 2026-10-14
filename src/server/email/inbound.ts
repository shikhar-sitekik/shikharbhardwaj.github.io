/*
 * Pure parsing for captured email (no I/O). Input is a Postmark inbound
 * webhook payload: https://postmarkapp.com/developer/webhooks/inbound-webhook
 */
import { normalizeEmail } from "@/server/domain/normalize";

export const MAX_BODY_CHARS = 20_000;
export const CAPTURE_TOKEN_RE = /^[a-f0-9]{24}$/;

export interface Address {
  email: string;
  name: string | null;
}

export interface ParsedEmail {
  messageId: string;
  subject: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  /** Every recipient address Postmark saw, incl. Bcc and the original envelope recipient. */
  recipients: string[];
  sentAt: Date;
  bodyText: string;
  attachmentCount: number;
  mailboxHash: string | null;
}

interface PostmarkAddress {
  Email?: unknown;
  Name?: unknown;
  MailboxHash?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function addr(v: unknown): Address | null {
  if (!v || typeof v !== "object") return null;
  const a = v as PostmarkAddress;
  const email = normalizeEmail(str(a.Email));
  if (!email) return null;
  const name = str(a.Name).trim().replace(/^["']|["']$/g, "");
  return { email, name: name && name.toLowerCase() !== email ? name.slice(0, 200) : null };
}

function addrList(v: unknown): Address[] {
  return Array.isArray(v) ? v.map(addr).filter((a): a is Address => !!a) : [];
}

function header(headers: unknown, name: string): string | null {
  if (!Array.isArray(headers)) return null;
  for (const h of headers) {
    if (h && typeof h === "object" && str((h as { Name?: unknown }).Name).toLowerCase() === name.toLowerCase()) {
      return str((h as { Value?: unknown }).Value) || null;
    }
  }
  return null;
}

/** Converts minimal HTML to text when an email has no plain-text part. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extracts the capture token: Postmark's MailboxHash, else the "+token" of any recipient. */
function findMailboxHash(p: Record<string, unknown>, recipients: string[]): string | null {
  const candidates = [str(p.MailboxHash)];
  for (const list of [p.ToFull, p.CcFull, p.BccFull]) {
    if (Array.isArray(list)) for (const a of list) candidates.push(str((a as PostmarkAddress)?.MailboxHash));
  }
  for (const r of recipients) {
    const m = /^[^@+]+\+([^@]+)@/.exec(r);
    if (m?.[1]) candidates.push(m[1]);
  }
  for (const c of candidates) {
    const t = c.trim().toLowerCase();
    if (CAPTURE_TOKEN_RE.test(t)) return t;
  }
  return null;
}

export function parsePostmarkInbound(payload: unknown): ParsedEmail | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const from = addr(p.FromFull) ?? (normalizeEmail(str(p.From)) ? { email: normalizeEmail(str(p.From))!, name: str(p.FromName) || null } : null);
  const to = addrList(p.ToFull);
  const cc = addrList(p.CcFull);
  const bcc = addrList(p.BccFull);
  const recipients = [...new Set([...to, ...cc, ...bcc].map((a) => a.email).concat(normalizeEmail(str(p.OriginalRecipient)) ?? []))];
  const rawId = header(p.Headers, "Message-ID") ?? str(p.MessageID);
  const messageId = rawId.trim().replace(/^<|>$/g, "").slice(0, 500);
  if (!messageId) return null;
  const date = new Date(str(p.Date));
  const text = str(p.TextBody).trim() || htmlToText(str(p.HtmlBody));
  return {
    messageId,
    subject: (str(p.Subject).trim() || "(no subject)").slice(0, 300),
    from,
    to,
    cc,
    recipients,
    sentAt: Number.isNaN(date.getTime()) ? new Date() : date,
    bodyText: text.slice(0, MAX_BODY_CHARS),
    attachmentCount: Array.isArray(p.Attachments) ? p.Attachments.length : 0,
    mailboxHash: findMailboxHash(p, recipients),
  };
}

const FWD_SUBJECT = /^\s*(fwd?|fw)\s*:\s*/i;
const EMAIL_IN_TEXT = /[^\s<>"'(),;:[\]]+@[^\s<>"'(),;:[\]]+\.[a-z]{2,}/i;

/** Parses "Name <a@b.c>, d@e.f; \"Last, First\" <g@h.i>" into addresses. */
function addressesIn(line: string): Address[] {
  const out: Address[] = [];
  for (const part of line.match(/(?:"[^"]*"|[^,;])+/g) ?? []) {
    const angle = /<([^>]+)>/.exec(part);
    const email = normalizeEmail(angle ? angle[1] : EMAIL_IN_TEXT.exec(part)?.[0]);
    if (!email) continue;
    const name = angle ? part.slice(0, angle.index).trim().replace(/^["']|["']$/g, "").trim() : "";
    out.push({ email, name: name && !name.includes("@") ? name.slice(0, 200) : null });
  }
  return out;
}

export interface ForwardedHeaders {
  from: Address | null;
  to: Address[];
  cc: Address[];
  subject: string | null;
  date: Date | null;
  body: string;
}

/**
 * Finds the original headers in a forwarded message body (Outlook, Gmail and
 * Apple Mail formats). Returns null if the message is not a forward.
 */
export function extractForwarded(subject: string, body: string): ForwardedHeaders | null {
  const marker = /(-{2,}\s*(Forwarded message|Original Message)\s*-{2,}|^_{5,}\s*$|^Begin forwarded message:)/im;
  const m = marker.exec(body);
  if (!m && !FWD_SUBJECT.test(subject)) return null;
  const rest = m ? body.slice(m.index + m[0].length) : body;
  const lines = rest.split(/\r?\n/);
  const out: ForwardedHeaders = { from: null, to: [], cc: [], subject: null, date: null, body: "" };
  let i = 0;
  let seen = 0;
  // Header block: "Key: value" lines (allowing a few leading blank lines, '*' bold markers, '>' quoting).
  for (; i < lines.length && i < 40; i++) {
    const line = lines[i]!.replace(/^[>\s*]+/, "").replace(/\*/g, "").trim();
    if (!line) {
      if (seen > 0) break;
      continue;
    }
    const h = /^(From|To|Cc|Subject|Date|Sent)\s*:\s*(.*)$/i.exec(line);
    if (!h) {
      if (seen > 0) break;
      continue;
    }
    seen++;
    const key = h[1]!.toLowerCase();
    const value = h[2]!.trim();
    if (key === "from") out.from = addressesIn(value)[0] ?? null;
    else if (key === "to") out.to = addressesIn(value);
    else if (key === "cc") out.cc = addressesIn(value);
    else if (key === "subject") out.subject = value.slice(0, 300) || null;
    else {
      const d = new Date(value.replace(/\s+at\s+/i, " "));
      if (!Number.isNaN(d.getTime())) out.date = d;
    }
  }
  if (!out.from) return null;
  out.body = lines.slice(i).join("\n").trim();
  return out;
}

export interface CapturePlan {
  direction: "outbound" | "inbound";
  subject: string;
  sentAt: Date;
  body: string;
  from: Address | null;
  to: Address[];
  cc: Address[];
  /** External people on the thread (not workspace members, not capture addresses). */
  participants: Address[];
}

/**
 * Decides what the captured email represents. A forward from a workspace
 * member is unwrapped to the original message; otherwise the email itself is
 * logged. Direction is outbound when the (original) sender is a member.
 */
export function planCapture(email: ParsedEmail, memberEmails: ReadonlySet<string>, isCaptureAddress: (e: string) => boolean): CapturePlan {
  let from = email.from;
  let to = email.to;
  let cc = email.cc;
  let subject = email.subject;
  let sentAt = email.sentAt;
  let body = email.bodyText;
  if (from && memberEmails.has(from.email)) {
    const fwd = extractForwarded(email.subject, email.bodyText);
    if (fwd?.from) {
      from = fwd.from;
      to = fwd.to;
      cc = fwd.cc;
      subject = fwd.subject ?? subject.replace(FWD_SUBJECT, "");
      sentAt = fwd.date ?? sentAt;
      body = fwd.body || body;
    }
  }
  const internal = (e: string) => memberEmails.has(e) || isCaptureAddress(e);
  const seen = new Set<string>();
  const participants: Address[] = [];
  for (const a of [from, ...to, ...cc]) {
    if (!a || internal(a.email) || seen.has(a.email)) continue;
    seen.add(a.email);
    participants.push(a);
  }
  return {
    direction: from && memberEmails.has(from.email) ? "outbound" : "inbound",
    subject: subject.trim() || "(no subject)",
    sentAt,
    body,
    from,
    to: to.filter((a) => !isCaptureAddress(a.email)),
    cc: cc.filter((a) => !isCaptureAddress(a.email)),
    participants: participants.slice(0, 20),
  };
}

/** Builds the per-user capture address: "<local>+<token>@<domain>" from the server's inbound address. */
export function captureAddress(inboundAddress: string, token: string): string | null {
  const m = /^([^@+\s]+)(?:\+[^@]*)?@([^@\s]+)$/.exec(inboundAddress.trim().toLowerCase());
  return m ? `${m[1]}+${token}@${m[2]}` : null;
}

/** True for the server's inbound address and any "+hash" variant of it. */
export function isCaptureAddressOf(inboundAddress: string | undefined): (e: string) => boolean {
  const m = inboundAddress ? /^([^@+\s]+)(?:\+[^@]*)?@([^@\s]+)$/.exec(inboundAddress.trim().toLowerCase()) : null;
  return (e: string) => {
    if (!m) return /@inbound\.postmarkapp\.com$/i.test(e);
    const x = /^([^@+]+)(?:\+[^@]*)?@(.+)$/.exec(e.toLowerCase());
    return !!x && x[1] === m[1] && x[2] === m[2];
  };
}

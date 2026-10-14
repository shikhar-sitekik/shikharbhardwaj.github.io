import { describe, expect, it } from "vitest";
import { captureAddress, extractForwarded, htmlToText, isCaptureAddressOf, parsePostmarkInbound, planCapture } from "@/server/email/inbound";

const TOKEN = "0123456789abcdef01234567";
const INBOUND = "abc123@inbound.postmarkapp.com";

function payload(over: Record<string, unknown> = {}) {
  return {
    FromFull: { Email: "Rep@Exato.ai", Name: "Rep One" },
    ToFull: [{ Email: "ana@acme.io", Name: "Ana Lopez", MailboxHash: "" }],
    CcFull: [],
    BccFull: [{ Email: `abc123+${TOKEN}@inbound.postmarkapp.com`, Name: "", MailboxHash: TOKEN }],
    Subject: "Proposal follow-up",
    MessageID: "pm-1",
    Headers: [{ Name: "Message-ID", Value: "<CA+abc@mail.gmail.com>" }],
    Date: "Tue, 13 Oct 2026 10:00:00 +0000",
    TextBody: "Hi Ana, attached is the proposal.",
    MailboxHash: TOKEN,
    Attachments: [{ Name: "p.pdf" }],
    ...over,
  };
}

describe("parsePostmarkInbound", () => {
  it("extracts addresses, RFC Message-ID, token and attachments", () => {
    const e = parsePostmarkInbound(payload())!;
    expect(e.messageId).toBe("CA+abc@mail.gmail.com");
    expect(e.from).toEqual({ email: "rep@exato.ai", name: "Rep One" });
    expect(e.to[0]!.email).toBe("ana@acme.io");
    expect(e.mailboxHash).toBe(TOKEN);
    expect(e.attachmentCount).toBe(1);
    expect(e.sentAt.toISOString()).toBe("2026-10-13T10:00:00.000Z");
  });
  it("finds the token from a +address when MailboxHash is missing and rejects bad tokens", () => {
    expect(parsePostmarkInbound(payload({ MailboxHash: "", BccFull: [{ Email: `abc123+${TOKEN}@inbound.postmarkapp.com` }] }))!.mailboxHash).toBe(TOKEN);
    expect(parsePostmarkInbound(payload({ MailboxHash: "x'; drop", BccFull: [] }))!.mailboxHash).toBeNull();
  });
  it("falls back to HTML and rejects payloads without an id", () => {
    expect(parsePostmarkInbound(payload({ TextBody: "", HtmlBody: "<p>Hello<br>there</p><script>x()</script>" }))!.bodyText).toBe("Hello\nthere");
    expect(parsePostmarkInbound(payload({ Headers: [], MessageID: "" }))).toBeNull();
    expect(parsePostmarkInbound("nope")).toBeNull();
  });
  it("strips html entities", () => {
    expect(htmlToText("a &amp; b&nbsp;&lt;c&gt;")).toBe("a & b <c>");
  });
});

describe("forwarded messages", () => {
  const gmail = `FYI\n\n---------- Forwarded message ---------\nFrom: Ana Lopez <ana@acme.io>\nDate: Mon, Oct 12, 2026 at 9:15 AM\nSubject: Pricing question\nTo: Rep One <rep@exato.ai>\nCc: cfo@acme.io\n\nWhat would 500 seats cost?`;
  const outlook = `________________________________\nFrom: Ana Lopez <ana@acme.io>\nSent: Monday, October 12, 2026 9:15 AM\nTo: Rep One <rep@exato.ai>\nSubject: Pricing question\n\nWhat would 500 seats cost?`;
  it.each([["gmail", gmail], ["outlook", outlook]])("parses %s forwards", (_n, body) => {
    const f = extractForwarded("Fwd: Pricing question", body)!;
    expect(f.from).toEqual({ email: "ana@acme.io", name: "Ana Lopez" });
    expect(f.subject).toBe("Pricing question");
    expect(f.body).toBe("What would 500 seats cost?");
    expect(f.date?.getFullYear()).toBe(2026);
  });
  it("ignores non-forwards", () => {
    expect(extractForwarded("Hello", "Just a note")).toBeNull();
  });
});

describe("planCapture", () => {
  const members = new Set(["rep@exato.ai", "boss@exato.ai"]);
  const isCapture = isCaptureAddressOf(INBOUND);
  it("treats BCC'd sends as outbound to external recipients only", () => {
    const e = parsePostmarkInbound(payload({ CcFull: [{ Email: "boss@exato.ai" }, { Email: "cfo@acme.io" }] }))!;
    const p = planCapture(e, members, isCapture);
    expect(p.direction).toBe("outbound");
    expect(p.participants.map((a) => a.email)).toEqual(["ana@acme.io", "cfo@acme.io"]);
  });
  it("unwraps a member's forward into the original inbound email", () => {
    const e = parsePostmarkInbound(
      payload({
        Subject: "Fwd: Pricing question",
        ToFull: [{ Email: `abc123+${TOKEN}@inbound.postmarkapp.com` }],
        TextBody: "---------- Forwarded message ---------\nFrom: Ana Lopez <ana@acme.io>\nSubject: Pricing question\nTo: rep@exato.ai\n\nHow much?",
      }),
    )!;
    const p = planCapture(e, members, isCapture);
    expect(p).toMatchObject({ direction: "inbound", subject: "Pricing question", body: "How much?" });
    expect(p.participants.map((a) => a.email)).toEqual(["ana@acme.io"]);
    expect(p.to.map((a) => a.email)).toEqual(["rep@exato.ai"]);
  });
});

describe("capture addresses", () => {
  it("builds and recognises per-user addresses", () => {
    expect(captureAddress(INBOUND, TOKEN)).toBe(`abc123+${TOKEN}@inbound.postmarkapp.com`);
    expect(isCaptureAddressOf(INBOUND)(`ABC123+${TOKEN}@inbound.postmarkapp.com`)).toBe(true);
    expect(isCaptureAddressOf(INBOUND)("ana@acme.io")).toBe(false);
    expect(captureAddress("not an email", TOKEN)).toBeNull();
  });
});

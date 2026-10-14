import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  createLeadFromCapturedEmail,
  getMyCaptureAddress,
  handleInboundEmail,
  inboundAuthorized,
  listMyCapturedEmails,
  regenerateMyCaptureAddress,
  rematchCapturedEmail,
} from "@/server/services/email-capture";
import { createAccount, createContact } from "@/server/services/accounts";
import { createOpportunity, listPipelines } from "@/server/services/opportunities";
import { timelineFor } from "@/server/services/activities";
import { getLead } from "@/server/services/leads";
import { makeMember, makeTenant, resetDatabase } from "./helpers";

const SECRET = "inbound-test-secret-0123456789";

beforeAll(async () => {
  process.env.POSTMARK_INBOUND_ADDRESS = "srv@inbound.postmarkapp.com";
  process.env.INBOUND_EMAIL_SECRET = SECRET;
  await resetDatabase();
});

let n = 0;
function mail(address: string, over: Record<string, unknown> = {}) {
  n += 1;
  const token = /\+([a-f0-9]{24})@/.exec(address)![1];
  return JSON.stringify({
    FromFull: { Email: "x@x.com", Name: "" },
    ToFull: [],
    CcFull: [],
    BccFull: [{ Email: address, MailboxHash: token }],
    MailboxHash: token,
    Subject: `Subject ${n}`,
    MessageID: `msg-${n}-${Date.now()}`,
    Date: new Date("2026-10-10T10:00:00Z").toUTCString(),
    TextBody: "Body text",
    ...over,
  });
}

describe("email capture", () => {
  it("authenticates the webhook with basic auth", () => {
    const b = (p: string) => `Basic ${Buffer.from(`postmark:${p}`).toString("base64")}`;
    expect(inboundAuthorized(b(SECRET))).toBe(true);
    expect(inboundAuthorized(b("wrong"))).toBe(false);
    expect(inboundAuthorized(null)).toBe(false);
  });

  it("logs BCC'd and forwarded mail on matching records, idempotently, within scope", async () => {
    const { admin } = await makeTenant("Mail");
    const rep = await makeMember(admin, "sales_rep");
    const acc = await createAccount(admin, { name: "Acme", website: "acme.io", ownerId: rep.userId });
    const ana = await createContact(admin, { firstName: "Ana", lastName: "Lopez", email: "ana@acme.io", accountId: acc.id, ownerId: rep.userId });
    const [pipe] = await listPipelines(admin);
    const deal = await createOpportunity(admin, {
      name: "Acme deal", accountId: acc.id, pipelineId: pipe!.id, stageId: pipe!.stages[0]!.id, currency: "USD", ownerId: rep.userId, primaryContactId: ana.id,
    });
    // A contact owned by someone else is outside the rep's "own" scope and must not be touched.
    const hidden = await createContact(admin, { lastName: "Hidden", email: "hidden@other.io" });

    const address = (await getMyCaptureAddress(rep))!;
    expect(address).toMatch(/^srv\+[a-f0-9]{24}@inbound\.postmarkapp\.com$/);
    expect(await getMyCaptureAddress(rep)).toBe(address);

    const sent = mail(address, { FromFull: { Email: rep.user.email }, ToFull: [{ Email: "ana@acme.io" }, { Email: "hidden@other.io" }], Subject: "Proposal" });
    const r1 = await handleInboundEmail(sent);
    expect(r1).toMatchObject({ status: 201, body: { status: "matched" } });
    expect(await handleInboundEmail(sent)).toMatchObject({ status: 200, body: { status: "duplicate" } });

    const tl = await timelineFor(rep, { type: "contact", id: ana.id });
    expect(tl.filter((t) => t.type === "email")).toHaveLength(1);
    expect(tl[0]).toMatchObject({ subject: "Proposal", outcome: "sent" });
    expect((await timelineFor(rep, { type: "opportunity", id: deal.id })).some((t) => t.subject === "Proposal")).toBe(true);
    expect((await timelineFor(admin, { type: "contact", id: hidden.id })).length).toBe(0);

    const fwd = mail(address, {
      FromFull: { Email: rep.user.email },
      ToFull: [{ Email: address }],
      Subject: "Fwd: Pricing",
      TextBody: "---------- Forwarded message ---------\nFrom: Ana Lopez <ana@acme.io>\nSubject: Pricing\nTo: <" + rep.user.email + ">\n\nHow much for 500 seats?",
    });
    expect(await handleInboundEmail(fwd)).toMatchObject({ status: 201, body: { status: "matched" } });
    const tl2 = await timelineFor(rep, { type: "contact", id: ana.id });
    expect(tl2.find((t) => t.subject === "Pricing")).toMatchObject({ outcome: "received" });

    // Unknown and rotated addresses are acknowledged but store nothing.
    await regenerateMyCaptureAddress(rep);
    expect(await handleInboundEmail(mail(address))).toMatchObject({ status: 200, body: { status: "ignored" } });
    expect(await handleInboundEmail(mail("srv+ffffffffffffffffffffffff@inbound.postmarkapp.com"))).toMatchObject({ body: { reason: "unknown_address" } });
  });

  it("queues unmatched mail for review and creates a lead from it", async () => {
    const { admin } = await makeTenant("Review");
    const address = (await getMyCaptureAddress(admin))!;
    const raw = mail(address, { FromFull: { Email: "priya.shah@globex.com", Name: "Priya Shah" }, ToFull: [{ Email: admin.user.email }], Subject: "Intro" });
    expect(await handleInboundEmail(raw)).toMatchObject({ status: 201, body: { status: "unmatched" } });
    const [row] = await listMyCapturedEmails(admin, "unmatched");
    expect(row).toMatchObject({ subject: "Intro", direction: "inbound", fromEmail: "priya.shah@globex.com" });
    expect(await rematchCapturedEmail(admin, row!.id)).toBe(0);

    const { leadId } = await createLeadFromCapturedEmail(admin, row!.id);
    const { lead } = await getLead(admin, leadId);
    expect(lead).toMatchObject({ firstName: "Priya", lastName: "Shah", email: "priya.shah@globex.com", source: "email" });
    expect((await timelineFor(admin, { type: "lead", id: leadId })).map((t) => t.subject)).toContain("Intro");
    expect(await listMyCapturedEmails(admin, "unmatched")).toHaveLength(0);

    // Other users cannot see someone else's captured mail; unscoped SQL sees nothing.
    const other = await makeMember(admin, "sales_manager");
    expect(await listMyCapturedEmails(other)).toHaveLength(0);
    expect(await db().execute(sql`select id from email_messages`)).toHaveLength(0);
  });
});

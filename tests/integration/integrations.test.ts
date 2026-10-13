import { beforeAll, describe, expect, it } from "vitest";
import { signWebhook } from "@/server/lib/crypto";
import { createFormConnection, handleInboundForm, listConnections, rotateConnectionSecret, setConnectionEnabled } from "@/server/services/integrations";
import { listLeads } from "@/server/services/leads";
import { ForbiddenError } from "@/server/auth/permissions";
import { makeMember, makeTenant, resetDatabase } from "./helpers";

beforeAll(async () => {
  await resetDatabase();
});

function post(connId: string, body: object, secret: string, extra: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  const h = new Headers({ "content-type": "application/json", "x-exato-signature": signWebhook(raw, secret), ...extra });
  return handleInboundForm(connId, raw, h);
}

describe("website form webhook connector", () => {
  it("creates leads from signed submissions, dedupes, and rejects forgeries", async () => {
    const { admin } = await makeTenant("Forms");
    const { id, secret } = await createFormConnection(admin, { name: "Contact us" });
    let conns = await listConnections(admin);
    expect(conns[0]).toMatchObject({ status: "configured", receivedCount: 0 });
    expect(JSON.stringify(conns)).not.toContain(secret);

    const r1 = await post(id, { event_id: "evt-1", first_name: "Ana", last_name: "Lopez", email: "ana@acme.io", company: "Acme", message: "Need IVA", utm_campaign: "q4" }, secret);
    expect(r1.status).toBe(201);
    const replay = await post(id, { event_id: "evt-1", first_name: "Ana", last_name: "Lopez", email: "ana@acme.io" }, secret);
    expect(replay).toMatchObject({ status: 200, body: { status: "duplicate" } });
    const sameEmail = await post(id, { event_id: "evt-2", name: "Ana Lopez", email: "ana@acme.io" }, secret);
    expect(sameEmail).toMatchObject({ status: 200, body: { status: "matched_existing" } });

    const forged = await post(id, { event_id: "evt-3", last_name: "Evil" }, "whsec_wrong");
    expect(forged.status).toBe(401);
    const unknown = await post("00000000-0000-0000-0000-000000000000", { last_name: "x" }, secret);
    expect(unknown.status).toBe(401);
    const bad = await post(id, { event_id: "evt-4", company: "No name" }, secret);
    expect(bad.status).toBe(422);

    const leads = await listLeads(admin);
    expect(leads.total).toBe(1);
    expect(leads.rows[0]).toMatchObject({ source: "website", email: "ana@acme.io" });
    conns = await listConnections(admin);
    expect(conns[0]).toMatchObject({ status: "healthy", receivedCount: 2, rejectedCount: 2 });

    // Rotation invalidates the old secret; disabling stops intake.
    const next = await rotateConnectionSecret(admin, id);
    expect((await post(id, { event_id: "evt-5", last_name: "Old" }, secret)).status).toBe(401);
    expect((await post(id, { event_id: "evt-6", last_name: "New" }, next)).status).toBe(201);
    await setConnectionEnabled(admin, id, false);
    expect((await post(id, { event_id: "evt-7", last_name: "Off" }, next)).status).toBe(401);
  });

  it("isolates connections per tenant and requires admin", async () => {
    const t1 = await makeTenant("FormsA");
    const t2 = await makeTenant("FormsB");
    await createFormConnection(t1.admin, { name: "A form" });
    expect(await listConnections(t2.admin)).toHaveLength(0);
    const rep = await makeMember(t1.admin, "sales_rep");
    await expect(createFormConnection(rep, { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, signWebhook, verifyWebhookSignature } from "@/server/lib/crypto";
import { websiteFormsConnector } from "@/server/integrations/website-forms";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
});

describe("secret encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("whsec_abc");
    const b = encryptSecret("whsec_abc");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("whsec_abc");
  });
  it("detects tampering", () => {
    const blob = encryptSecret("x");
    const parts = blob.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"email":"a@b.co"}';
  it("accepts valid signatures", () => {
    expect(verifyWebhookSignature(signWebhook(body, secret), body, secret).ok).toBe(true);
  });
  it("rejects modified bodies, wrong secrets and stale timestamps", () => {
    expect(verifyWebhookSignature(signWebhook(body, secret), body + " ", secret).ok).toBe(false);
    expect(verifyWebhookSignature(signWebhook(body, "other"), body, secret).ok).toBe(false);
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyWebhookSignature(signWebhook(body, secret, old), body, secret)).toEqual({ ok: false, reason: "timestamp outside tolerance" });
    expect(verifyWebhookSignature("garbage", body, secret).ok).toBe(false);
    expect(verifyWebhookSignature(null, body, secret).ok).toBe(false);
  });
});

describe("website form mapping", () => {
  const cfg = websiteFormsConnector.parseConfig({});
  it("maps snake_case, camelCase and nested payloads", () => {
    const a = websiteFormsConnector.mapInbound!({ name: "Priya Shah", email: "p@globex.com", utm_source: "google", utm_campaign: "cx" }, cfg);
    expect(a).toMatchObject({ ok: true, value: { firstName: "Priya", lastName: "Shah", sourceDetail: "google / cx", source: "website" } });
    const b = websiteFormsConnector.mapInbound!({ lead: { firstName: "A", lastName: "B", consentEmail: "yes" }, eventId: "evt_1" }, cfg);
    expect(b).toMatchObject({ ok: true, externalId: "evt_1", value: { firstName: "A", lastName: "B", consentEmail: true } });
  });
  it("rejects payloads without identity", () => {
    expect(websiteFormsConnector.mapInbound!({ company: "X" }, cfg).ok).toBe(false);
    expect(websiteFormsConnector.mapInbound!([], cfg).ok).toBe(false);
  });
});

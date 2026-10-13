import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Application-level encryption for integration credentials (AES-256-GCM).
 * Key: ENCRYPTION_KEY (32 bytes, base64). Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 * Rotation: add the new key as ENCRYPTION_KEY and the old as ENCRYPTION_KEY_PREVIOUS,
 * then re-save connections; decrypt tries both.
 */

function keyFrom(b64: string | undefined): Buffer | null {
  if (!b64) return null;
  const k = Buffer.from(b64, "base64");
  return k.length === 32 ? k : null;
}

function keys(): Buffer[] {
  const primary = keyFrom(process.env.ENCRYPTION_KEY);
  if (!primary) throw new Error("ENCRYPTION_KEY must be set to 32 random bytes (base64) to store integration credentials.");
  const prev = keyFrom(process.env.ENCRYPTION_KEY_PREVIOUS);
  return prev ? [primary, prev] : [primary];
}

export function encryptSecret(plain: string): string {
  const [key] = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key!, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string): string {
  const [v, ivS, tagS, ctS] = blob.split(".");
  if (v !== "v1" || !ivS || !tagS || !ctS) throw new Error("Unsupported secret format");
  for (const key of keys()) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivS, "base64url"));
      d.setAuthTag(Buffer.from(tagS, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ctS, "base64url")), d.final()]).toString("utf8");
    } catch {
      /* try next key */
    }
  }
  throw new Error("Unable to decrypt secret with configured keys");
}

export function generateSigningSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Verifies `X-Exato-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>`.
 * Rejects stale timestamps (replay protection).
 */
export function verifyWebhookSignature(
  header: string | null,
  body: string,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): { ok: true; timestamp: number } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!Number.isInteger(t) || !sig || !/^[0-9a-f]{64}$/i.test(sig)) return { ok: false, reason: "malformed signature" };
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(now - t) > (opts.toleranceSeconds ?? 300)) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  const got = Buffer.from(sig, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "signature mismatch" };
  return { ok: true, timestamp: t };
}

export function signWebhook(body: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

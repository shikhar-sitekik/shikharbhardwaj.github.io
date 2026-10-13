import { describe, expect, it } from "vitest";
import { ROLE_TEMPLATES, can, withinScope, type AccessSubject, type Permission } from "@/server/auth/permissions";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/server/auth/password";

const subject = (scope: AccessSubject["dataScope"], perms: Permission[] = []): AccessSubject => ({
  userId: "u1",
  teamId: "t1",
  permissions: new Set(perms),
  dataScope: scope,
});

describe("RBAC", () => {
  it("checks permissions", () => {
    expect(can(subject("all", ["lead:read"]), "lead:read")).toBe(true);
    expect(can(subject("all", ["lead:read"]), "lead:write")).toBe(false);
  });
  it("own scope only sees own records", () => {
    expect(withinScope(subject("own"), "u1", null)).toBe(true);
    expect(withinScope(subject("own"), "u2", "t1")).toBe(false);
    expect(withinScope(subject("own"), null, null)).toBe(false);
  });
  it("team scope sees own and team records", () => {
    expect(withinScope(subject("team"), "u2", "t1")).toBe(true);
    expect(withinScope(subject("team"), "u3", "t2")).toBe(false);
  });
  it("team scope without a team degrades to own", () => {
    const s = { ...subject("team"), teamId: null };
    expect(withinScope(s, "u2", null)).toBe(false);
  });
  it("only admins hold admin permissions by default", () => {
    for (const r of ROLE_TEMPLATES) {
      if (r.key !== "tenant_admin") expect(r.permissions.some((p) => p.startsWith("admin:"))).toBe(false);
    }
  });
  it("read-only roles hold no write permissions", () => {
    const ro = ROLE_TEMPLATES.find((r) => r.key === "read_only")!;
    expect(ro.permissions.every((p) => p.endsWith(":read"))).toBe(true);
  });
});

describe("password hashing", () => {
  it("hashes and verifies; rejects wrong passwords", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("wrong password here", h)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("enforces minimum length", () => {
    expect(passwordPolicyError("short")).not.toBeNull();
    expect(passwordPolicyError("long enough passphrase")).toBeNull();
  });
});

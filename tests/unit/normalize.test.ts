import { describe, expect, it } from "vitest";
import {
  csvSafe,
  emailDomain,
  isBusinessEmail,
  normalizeCurrency,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  parseAmount,
  parseDate,
} from "@/server/domain/normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims valid emails", () => {
    expect(normalizeEmail("  Priya.Shah@Exato.AI ")).toBe("priya.shah@exato.ai");
  });
  it.each(["", "not-an-email", "a@b", "a b@c.com", "x@-bad.com"])("rejects %s", (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });
  it("classifies free vs business domains", () => {
    expect(emailDomain("a@Gmail.com")).toBe("gmail.com");
    expect(isBusinessEmail("a@gmail.com")).toBe(false);
    expect(isBusinessEmail("a@acme.co.uk")).toBe(true);
  });
});

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Acme.com/about?x=1", "acme.com"],
    ["acme.co.in", "acme.co.in"],
    ["http://sub.acme.io:8080", "sub.acme.io"],
    ["WWW.EXAMPLE.ORG.", "example.org"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
  it("rejects junk", () => {
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("keeps international numbers in E.164 shape", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
  });
  it("applies default country code and strips trunk zero", () => {
    expect(normalizePhone("098765 43210", "+91")).toBe("+919876543210");
  });
  it("rejects implausible lengths", () => {
    expect(normalizePhone("12345")).toBeNull();
  });
});

describe("parseDate", () => {
  it("parses ISO", () => expect(parseDate("2025-03-04")).toBe("2025-03-04"));
  it("defaults ambiguous dates to day-first", () => expect(parseDate("03/04/2025")).toBe("2025-04-03"));
  it("supports month-first when configured", () => expect(parseDate("03/04/2025", "mdy")).toBe("2025-03-04"));
  it("disambiguates by value", () => expect(parseDate("12/31/2025")).toBe("2025-12-31"));
  it("parses month names", () => {
    expect(parseDate("4 Mar 2025")).toBe("2025-03-04");
    expect(parseDate("March 4, 2025")).toBe("2025-03-04");
  });
  it("parses Excel serials", () => {
    expect(parseDate(45720)).toBe("2025-03-04");
    expect(parseDate("45720")).toBe("2025-03-04");
  });
  it("rejects impossible dates", () => {
    expect(parseDate("2025-02-30")).toBeNull();
    expect(parseDate("31/02/2025")).toBeNull();
    expect(parseDate("soon")).toBeNull();
  });
});

describe("amounts and currency", () => {
  it.each([
    ["1,250,000.50", "1250000.50"],
    ["$45k", "45000.00"],
    ["1.2m", "1200000.00"],
    [3000, "3000.00"],
  ])("parseAmount(%s)", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
  it("rejects negative and junk amounts", () => {
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
  it("validates currency codes", () => {
    expect(normalizeCurrency(" inr ")).toBe("INR");
    expect(normalizeCurrency("XYZ")).toBeNull();
  });
});

describe("csvSafe", () => {
  it("neutralises formula injection", () => {
    expect(csvSafe("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(csvSafe("@cmd")).toBe("'@cmd");
    expect(csvSafe("Acme")).toBe("Acme");
  });
});

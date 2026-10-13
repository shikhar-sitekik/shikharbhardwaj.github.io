import { describe, expect, it } from "vitest";
import { missingRequired, suggestMapping } from "@/server/imports/fields";
import { splitName, transformRow } from "@/server/imports/transform";

describe("suggestMapping", () => {
  it("maps common CRM export headers", () => {
    const m = suggestMapping(["First Name", "Last Name", "Email Address", "Company", "Phone", "Lead Source", "Notes", "Unrelated Column"], "leads");
    expect(m).toEqual({
      "First Name": "firstName",
      "Last Name": "lastName",
      "Email Address": "email",
      Company: "company",
      Phone: "phone",
      "Lead Source": "source",
      Notes: "businessProblem",
      "Unrelated Column": "",
    });
  });
  it("uses each field once and prefers last name over full name", () => {
    const m = suggestMapping(["Name", "Surname", "Email", "Work Email"], "contacts");
    expect(m.Name).toBe("");
    expect(m.Surname).toBe("lastName");
    expect(Object.values(m).filter((v) => v === "email")).toHaveLength(1);
  });
  it("reports missing required fields", () => {
    expect(missingRequired({ A: "email" }, "leads").map((f) => f.key)).toEqual(["lastName"]);
    expect(missingRequired({ A: "fullName" }, "leads")).toEqual([]);
    expect(missingRequired({ A: "name" }, "opportunities").map((f) => f.key)).toEqual(["account"]);
  });
});

describe("transformRow", () => {
  it("normalises valid rows", () => {
    const r = transformRow(
      { Name: "Priya  Shah", Email: " PRIYA@Globex.com ", Web: "https://www.globex.com/x", Value: "$45k", Consent: "Yes", Close: "31/12/2026" },
      { Name: "fullName", Email: "email", Web: "website", Value: "estimatedValue", Consent: "consentEmail", Close: "" },
      "leads",
    );
    expect(r.errors).toEqual([]);
    expect(r.values).toMatchObject({ firstName: "Priya", lastName: "Shah", email: "priya@globex.com", website: "globex.com", estimatedValue: "45000.00", consentEmail: true });
  });
  it("reports every problem without throwing", () => {
    const r = transformRow({ L: "", E: "nope", D: "31/02/2026", C: "XYZ" }, { L: "name", E: "owner", D: "expectedCloseDate", C: "currency" }, "opportunities");
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Owner (email)"),
        expect.stringContaining("Expected close date"),
        expect.stringContaining("Currency"),
        "Opportunity name is required",
        "Account (name or domain) is required",
      ]),
    );
  });
  it("splits names", () => {
    expect(splitName("Mary Ann Lee")).toEqual({ firstName: "Mary Ann", lastName: "Lee" });
    expect(splitName("Cher")).toEqual({ firstName: null, lastName: "Cher" });
  });
});

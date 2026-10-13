/** Import field catalogue: what each entity accepts and how columns auto-map. */

export type ImportEntity = "leads" | "accounts" | "contacts" | "opportunities";
export const IMPORT_ENTITIES: ImportEntity[] = ["leads", "accounts", "contacts", "opportunities"];

export type FieldType = "text" | "email" | "phone" | "domain" | "money" | "currency" | "date" | "boolean" | "enum" | "integer" | "longtext";

export interface ImportField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Lower-cased header aliases used for auto-mapping. */
  aliases: string[];
  options?: readonly string[];
  /** Used to match existing records for create/update/skip handling. */
  matchKey?: boolean;
}

const person: ImportField[] = [
  { key: "firstName", label: "First name", type: "text", aliases: ["first name", "firstname", "given name", "first"] },
  { key: "lastName", label: "Last name", type: "text", required: true, aliases: ["last name", "lastname", "surname", "family name", "last"] },
  { key: "fullName", label: "Full name (split automatically)", type: "text", aliases: ["name", "full name", "contact name", "lead name"] },
  { key: "email", label: "Email", type: "email", matchKey: true, aliases: ["email", "e-mail", "email address", "work email", "business email"] },
  { key: "phone", label: "Phone", type: "phone", aliases: ["phone", "phone number", "mobile", "telephone", "tel", "contact number"] },
  { key: "jobTitle", label: "Job title", type: "text", aliases: ["title", "job title", "designation", "position", "role"] },
  { key: "department", label: "Department", type: "text", aliases: ["department", "dept", "function"] },
  { key: "country", label: "Country", type: "text", aliases: ["country", "country/region"] },
];

export const IMPORT_FIELDS: Record<ImportEntity, ImportField[]> = {
  leads: [
    ...person,
    { key: "company", label: "Company", type: "text", aliases: ["company", "company name", "organisation", "organization", "account", "account name"] },
    { key: "website", label: "Website", type: "domain", aliases: ["website", "url", "domain", "company website", "web"] },
    { key: "industry", label: "Industry", type: "text", aliases: ["industry", "sector", "vertical"] },
    { key: "region", label: "Region", type: "text", aliases: ["region", "state", "territory"] },
    { key: "employeeRange", label: "Employees", type: "text", aliases: ["employees", "company size", "employee range", "headcount", "size"] },
    { key: "source", label: "Lead source", type: "text", aliases: ["source", "lead source", "channel"] },
    { key: "sourceDetail", label: "Source detail", type: "text", aliases: ["source detail", "campaign", "utm campaign", "form"] },
    { key: "productInterest", label: "Product interest", type: "text", aliases: ["product interest", "interest", "product", "service", "solution"] },
    { key: "businessProblem", label: "Business problem", type: "longtext", aliases: ["business problem", "requirement", "use case", "message", "comments", "notes", "description"] },
    { key: "status", label: "Status", type: "text", aliases: ["status", "lead status", "stage"] },
    { key: "owner", label: "Owner (email)", type: "email", aliases: ["owner", "lead owner", "owner email", "assigned to"] },
    { key: "estimatedValue", label: "Estimated value", type: "money", aliases: ["estimated value", "value", "deal size", "budget"] },
    { key: "currency", label: "Currency", type: "currency", aliases: ["currency"] },
    { key: "consentEmail", label: "Email consent", type: "boolean", aliases: ["consent", "email consent", "opt in", "opted in", "marketing consent"] },
    { key: "doNotContact", label: "Do not contact", type: "boolean", aliases: ["do not contact", "dnc", "opt out", "unsubscribed"] },
  ],
  contacts: [
    ...person,
    { key: "account", label: "Account (name or domain)", type: "text", aliases: ["account", "company", "company name", "organisation", "organization", "account name"] },
    { key: "seniority", label: "Seniority", type: "text", aliases: ["seniority", "level"] },
    { key: "owner", label: "Owner (email)", type: "email", aliases: ["owner", "contact owner", "owner email"] },
    { key: "linkedinUrl", label: "LinkedIn URL", type: "text", aliases: ["linkedin", "linkedin url", "linkedin profile"] },
    { key: "consentEmail", label: "Email consent", type: "boolean", aliases: ["consent", "email consent", "opt in"] },
    { key: "doNotContact", label: "Do not contact", type: "boolean", aliases: ["do not contact", "dnc", "opt out", "unsubscribed"] },
  ],
  accounts: [
    { key: "name", label: "Account name", type: "text", required: true, matchKey: true, aliases: ["name", "account", "account name", "company", "company name", "organisation", "organization"] },
    { key: "website", label: "Website / domain", type: "domain", matchKey: true, aliases: ["website", "domain", "url", "web"] },
    { key: "industry", label: "Industry", type: "text", aliases: ["industry", "sector", "vertical"] },
    { key: "country", label: "Country", type: "text", aliases: ["country", "hq country"] },
    { key: "region", label: "Region", type: "text", aliases: ["region", "territory"] },
    { key: "headquarters", label: "Headquarters", type: "text", aliases: ["headquarters", "hq", "city", "location"] },
    { key: "employeeRange", label: "Employees", type: "text", aliases: ["employees", "company size", "headcount", "size"] },
    { key: "status", label: "Status", type: "enum", options: ["prospect", "customer", "former_customer", "partner", "other"], aliases: ["status", "type", "account type"] },
    { key: "tier", label: "Tier", type: "text", aliases: ["tier", "segment"] },
    { key: "owner", label: "Owner (email)", type: "email", aliases: ["owner", "account owner", "owner email"] },
    { key: "description", label: "Description", type: "longtext", aliases: ["description", "notes", "about"] },
  ],
  opportunities: [
    { key: "name", label: "Opportunity name", type: "text", required: true, aliases: ["name", "opportunity", "opportunity name", "deal", "deal name"] },
    { key: "account", label: "Account (name or domain)", type: "text", required: true, aliases: ["account", "account name", "company", "customer"] },
    { key: "stage", label: "Stage", type: "text", aliases: ["stage", "deal stage", "sales stage"] },
    { key: "amount", label: "Amount (TCV)", type: "money", aliases: ["amount", "value", "deal value", "tcv", "total contract value"] },
    { key: "currency", label: "Currency", type: "currency", aliases: ["currency", "ccy"] },
    { key: "expectedCloseDate", label: "Expected close date", type: "date", aliases: ["close date", "expected close", "expected close date", "closing date"] },
    { key: "revenueType", label: "Revenue type", type: "enum", options: ["one_time", "recurring"], aliases: ["revenue type", "type", "billing"] },
    { key: "contractMonths", label: "Contract term (months)", type: "integer", aliases: ["term", "contract months", "contract term", "duration"] },
    { key: "source", label: "Source", type: "text", aliases: ["source", "lead source"] },
    { key: "owner", label: "Owner (email)", type: "email", aliases: ["owner", "opportunity owner", "deal owner", "owner email"] },
    { key: "nextStep", label: "Next step", type: "text", aliases: ["next step", "next action"] },
    { key: "lossReason", label: "Loss reason", type: "text", aliases: ["loss reason", "lost reason"] },
  ],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/[^a-z0-9/ ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Suggests header → field mappings. Exact alias matches win; each field is
 * used at most once; unmatched headers map to "" (ignored).
 */
export function suggestMapping(headers: string[], entity: ImportEntity): Record<string, string> {
  const fields = IMPORT_FIELDS[entity];
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const h of headers) out[h] = "";
  // Pass 1: exact alias / key / label matches.
  for (const h of headers) {
    const n = norm(h);
    const f = fields.find((x) => !used.has(x.key) && (x.aliases.includes(n) || norm(x.key) === n || norm(x.label) === n));
    if (f) {
      out[h] = f.key;
      used.add(f.key);
    }
  }
  // Pass 2: containment ("Primary Email Address" → email).
  for (const h of headers) {
    if (out[h]) continue;
    const n = norm(h);
    const f = fields.find((x) => !used.has(x.key) && x.aliases.some((a) => a.length >= 4 && n.includes(a)));
    if (f) {
      out[h] = f.key;
      used.add(f.key);
    }
  }
  // A full-name column is only useful when no separate last-name column exists.
  if (Object.values(out).includes("lastName")) {
    for (const h of headers) if (out[h] === "fullName") out[h] = "";
  }
  return out;
}

export function missingRequired(mapping: Record<string, string>, entity: ImportEntity): ImportField[] {
  const mapped = new Set(Object.values(mapping).filter(Boolean));
  return IMPORT_FIELDS[entity].filter((f) => f.required && !mapped.has(f.key) && !(f.key === "lastName" && mapped.has("fullName")));
}

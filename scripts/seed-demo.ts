/**
 * DEVELOPMENT ONLY: creates a clearly labelled demo workspace with fictional
 * companies and people so screens can be evaluated with realistic volume.
 * Refuses to run when NODE_ENV=production or against a non-local database.
 *
 *   npm run db:seed
 */
import "dotenv/config";

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production.");
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_DEMO_SEED !== "true")
    throw new Error("Refusing to seed a non-local database. Set ALLOW_DEMO_SEED=true for a dedicated demo environment.");

  const { hashPassword } = await import("../src/server/auth/password");
  const { createUser, findUserByEmail, provisionTenant } = await import("../src/server/services/provisioning");
  const { loadTenantContext } = await import("../src/server/auth/context");
  const { addMember, createTeam, listRoles, updateTenantSettings } = await import("../src/server/services/admin");
  const { createLead, listLeadStatuses, setLeadStatus } = await import("../src/server/services/leads");
  const { createAccount, createContact } = await import("../src/server/services/accounts");
  const { createOpportunity, listPipelines, moveOpportunityStage, setOpportunityContact } = await import("../src/server/services/opportunities");
  const { createActivity } = await import("../src/server/services/activities");

  const email = "demo.admin@exato.local";
  const password = "demo-password-change-me";
  if (await findUserByEmail(email)) {
    console.log(`Demo workspace already exists. Sign in as ${email} / ${password}`);
    return;
  }
  const admin = await createUser({ email, name: "Demo Admin", passwordHash: await hashPassword(password) });
  const { tenantId } = await provisionTenant({ workspaceName: "Exato (Demo data)", baseCurrency: "USD", timezone: "Asia/Kolkata", owner: { userId: admin.id } });
  let ctx = (await loadTenantContext(admin.id, tenantId))!;
  await updateTenantSettings(ctx, { fxRates: { INR: 0.012, EUR: 1.08, GBP: 1.27, AED: 0.27 } });
  ctx = (await loadTenantContext(admin.id, tenantId))!;

  const roles = await listRoles(ctx);
  const role = (k: string) => roles.find((r) => r.key === k)!.id;
  const north = await createTeam(ctx, "Enterprise – India & ME");
  const west = await createTeam(ctx, "Enterprise – UK & EU");
  const people = [
    { name: "Ravi Menon", email: "ravi.menon@exato.local", role: "sales_rep", team: north.id },
    { name: "Sara Khan", email: "sara.khan@exato.local", role: "sales_rep", team: north.id },
    { name: "Tom Hughes", email: "tom.hughes@exato.local", role: "sales_rep", team: west.id },
    { name: "Nina Patel", email: "nina.patel@exato.local", role: "sales_manager", team: north.id },
  ];
  const reps: string[] = [];
  for (const p of people) {
    const { userId } = await addMember(ctx, { name: p.name, email: p.email, roleId: role(p.role), teamId: p.team, password });
    reps.push(userId);
  }

  // Fictional organisations (".example" domains are reserved and never real).
  const orgs = [
    ["Northwind Telecom", "northwind.example", "Telecommunications", "India"],
    ["Contoso Bank", "contoso-bank.example", "Banking", "United Arab Emirates"],
    ["Fabrikam Insurance", "fabrikam.example", "Insurance", "United Kingdom"],
    ["Tailspin Airlines", "tailspin.example", "Aviation", "India"],
    ["Wide World Retail", "wideworld.example", "Retail", "Germany"],
    ["Litware Health", "litware.example", "Healthcare", "United Kingdom"],
    ["Adventure Works Energy", "adventureworks.example", "Energy", "Saudi Arabia"],
    ["Proseware Logistics", "proseware.example", "Logistics", "India"],
    ["Woodgrove Capital", "woodgrove.example", "Financial services", "Singapore"],
    ["Coho Hospitality", "coho.example", "Hospitality", "United Arab Emirates"],
  ] as const;
  const firstNames = ["Aarav", "Meera", "James", "Fatima", "Lukas", "Chloe", "Omar", "Priya", "Daniel", "Aisha", "Rohan", "Emma"];
  const lastNames = ["Iyer", "Rahman", "Clarke", "Haddad", "Becker", "Martin", "Nair", "Sharma", "Evans", "Kapoor", "Singh", "Wright"];
  const titles = ["Head of Customer Experience", "CIO", "Director, Contact Centre", "VP Operations", "IT Manager", "Procurement Lead", "CTO"];
  const pick = <T,>(a: readonly T[], i: number) => a[i % a.length]!;
  const pipelines = await listPipelines(ctx);
  const ent = pipelines.find((p) => p.isDefault)!;

  let n = 0;
  for (const [i, [name, domain, industry, country]] of orgs.entries()) {
    const owner = reps[i % 3]!;
    const acc = await createAccount(ctx, { name, website: domain, industry, country, ownerId: owner, status: i < 3 ? "customer" : "prospect", isStrategic: i < 2 ? "on" : undefined, tier: i < 4 ? "tier_1" : "tier_2" });
    const contacts: string[] = [];
    for (let c = 0; c < 3; c += 1) {
      n += 1;
      const ct = await createContact(ctx, {
        firstName: pick(firstNames, n),
        lastName: pick(lastNames, n * 7),
        email: `${pick(firstNames, n).toLowerCase()}.${pick(lastNames, n * 7).toLowerCase()}@${domain}`,
        jobTitle: pick(titles, n),
        accountId: acc.id,
        ownerId: owner,
        buyingRole: ["decision_maker", "champion", "evaluator"][c],
      });
      contacts.push(ct.id);
    }
    const stageIdx = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10][i]!;
    const opp = await createOpportunity(ctx, {
      name: `${name} – ${pick(["Conversational AI", "CCaaS migration", "WFM rollout", "Managed services", "CRM integration"], i)}`,
      accountId: acc.id,
      primaryContactId: contacts[0],
      ownerId: owner,
      pipelineId: ent.id,
      currency: i % 4 === 1 ? "AED" : i % 5 === 3 ? "INR" : "USD",
      amount: String((i % 4 === 1 ? 550000 : i % 5 === 3 ? 9000000 : 60000) + i * 15000),
      expectedCloseDate: `2026-${String(10 + (i % 3)).padStart(2, "0")}-${String(5 + i).padStart(2, "0")}`,
      revenueType: i % 2 ? "recurring" : "one_time",
      contractMonths: i % 2 ? "36" : "",
      nextStep: i % 3 ? "Solution workshop with IT and CX leads" : "",
    });
    await setOpportunityContact(ctx, opp.id, contacts[1]!, "champion");
    const target = ent.stages[Math.min(stageIdx, ent.stages.length - 1)]!;
    if (target.category === "lost") await moveOpportunityStage(ctx, opp.id, { stageId: target.id, lossReason: "Chose incumbent vendor on price" });
    else if (target.id !== ent.stages[0]!.id) await moveOpportunityStage(ctx, opp.id, { stageId: target.id });
    await createActivity(ctx, { type: "meeting", subject: "Discovery workshop", opportunityId: opp.id, occurredAt: new Date(Date.now() - (i + 2) * 864e5).toISOString(), durationMinutes: "60", outcome: "held" });
    await createActivity(ctx, { type: "task", subject: "Share reference architecture", opportunityId: opp.id, ownerId: owner, dueAt: new Date(Date.now() + (i - 3) * 864e5).toISOString() });
  }

  const statuses = await listLeadStatuses(ctx);
  const sources = ["website", "referral", "partner", "webinar", "linkedin", "event", "paid_search"];
  for (let i = 0; i < 36; i += 1) {
    const company = pick(["Initrode", "Globex", "Hooli", "Vandelay", "Stark Industries", "Umbrella", "Soylent", "Pied Piper", "Cyberdyne"], i);
    const lead = await createLead(ctx, {
      firstName: pick(firstNames, i + 3),
      lastName: pick(lastNames, i * 5 + 1),
      email: `${pick(firstNames, i + 3).toLowerCase()}${i}@${company.toLowerCase().replace(/\s/g, "")}.example`,
      company: `${company} (demo)`,
      jobTitle: pick(titles, i + 2),
      source: pick(sources, i),
      employeeRange: pick(["51-200", "201-500", "1001-5000", "10000+"], i),
      businessProblem: i % 2 ? "Wants to reduce average handle time and add self-service." : "",
      ownerId: reps[i % 4],
      country: pick(["India", "United Kingdom", "UAE", "Germany"], i),
    });
    if (i % 5 === 0) await setLeadStatus(ctx, [lead.id], statuses.find((s) => s.key === "qualified")!.id);
    if (i % 7 === 0) await setLeadStatus(ctx, [lead.id], statuses.find((s) => s.key === "working")!.id);
  }
  console.log(`Demo workspace created. Sign in as ${email} / ${password} (reps share the same password).`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });

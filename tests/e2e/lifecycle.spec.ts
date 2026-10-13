import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now();
const PASSWORD = "e2e passphrase long enough";

async function signup(page: Page, who: string, workspace: string) {
  await page.goto("/signup");
  await page.fill("#name", `${who} Tester`);
  await page.fill("#email", `${who.toLowerCase()}-${stamp}@e2e.example`);
  await page.fill("#password", PASSWORD);
  await page.fill("#workspace", workspace);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(who);
}

let leadUrl = "";

test.describe.serial("lead to revenue lifecycle", () => {
  test("sign up, create, qualify, convert, progress and win a deal", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await signup(page, "Alice", "Exato E2E");

    // 1. Create a lead.
    await page.goto("/leads/new");
    await page.fill("#firstName", "Priya");
    await page.fill("#lastName", "Shah");
    await page.fill("#email", "priya.shah@globex.example");
    await page.fill("#company", "Globex");
    await page.fill("#jobTitle", "Head of Customer Experience");
    await page.selectOption("#source", "referral");
    await page.fill("#businessProblem", "Contact-centre AHT is too high.");
    await page.getByRole("button", { name: "Create lead" }).click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
    leadUrl = page.url();
    await expect(page.getByRole("heading", { name: "Priya Shah" })).toBeVisible();

    // 2. Qualify it.
    await page.getByRole("link", { name: "Edit" }).click();
    await page.selectOption("#statusId", { label: "Qualified" });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(leadUrl);
    await expect(page.getByText("Qualified", { exact: true }).first()).toBeVisible();

    // 3. Log a call.
    await page.getByRole("tab", { name: "Call" }).click();
    await page.getByLabel("Subject").fill("Discovery call with Priya");
    await page.getByRole("button", { name: "Log", exact: true }).click();
    await expect(page.getByText("Discovery call with Priya")).toBeVisible();

    // 4. Convert to account + contact + opportunity.
    await page.getByRole("button", { name: "Convert" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Opportunity name").fill("Globex – CX transformation");
    await dialog.getByLabel("Amount").fill("250000");
    await dialog.getByLabel("Expected close").fill("2026-12-15");
    await dialog.getByRole("button", { name: "Convert lead" }).click();
    await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Globex – CX transformation" })).toBeVisible();
    // The lead's call moved with it.
    await expect(page.getByText("Discovery call with Priya")).toBeVisible();

    // 5. Advance through the pipeline via the stage path.
    const path = page.getByRole("list", { name: "Stage path" });
    await path.getByRole("button", { name: "Negotiation" }).click();
    await expect(path.getByRole("button", { name: "Negotiation" })).toHaveAttribute("aria-current", "step");

    // 6. Record a follow-up task.
    await page.getByRole("tab", { name: "Task" }).click();
    await page.getByLabel("Subject").fill("Send revised commercial proposal");
    await page.locator('input[name="dueAt"]').fill("2026-12-01T10:00");
    await page.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Send revised commercial proposal")).toBeVisible();

    // 7. Win it.
    await page.getByRole("button", { name: "Closed Won" }).click();
    await expect(page.getByRole("button", { name: "Closed Won" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "Stage history" }).click();
    await expect(page.getByText("Negotiation →")).toBeVisible();

    // 8. Reporting reflects the win.
    await page.goto("/dashboard?period=ytd");
    await expect(page.getByText("Closed-won ·")).toBeVisible();
    await expect(page.locator("text=$250K").first()).toBeVisible();
    await expect(page.getByText("1 won · 0 lost")).toBeVisible();

    // 9. Account 360 shows the deal and contact.
    await page.goto("/accounts");
    await page.getByRole("link", { name: "Globex" }).click();
    await expect(page.getByRole("cell", { name: "Globex – CX transformation" })).toBeVisible();

    // 10. Global search finds the account.
    await page.keyboard.press("Control+K");
    await page.getByPlaceholder("Search records or jump to…").fill("globex");
    await expect(page.getByRole("option").filter({ hasText: "Globex" }).first()).toBeVisible();
    await page.keyboard.press("Escape");

    expect(errors).toEqual([]);
  });

  test("another tenant cannot access the first tenant's records", async ({ page }) => {
    await signup(page, "Mallory", "Other Co");
    const res = await page.goto(leadUrl);
    expect(res?.status()).toBe(404);
    await page.goto("/leads");
    await expect(page.getByText("No leads yet")).toBeVisible();
    const api = await page.request.get("/api/search?q=globex");
    expect((await api.json()).hits).toEqual([]);
  });

  test("unauthenticated access is redirected and APIs return 401", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/login\?next=%2Fleads/);
    const api = await page.request.get("/api/search?q=a");
    expect(api.status()).toBe(401);
    const cron = await page.request.get("/api/cron/jobs");
    expect(cron.status()).toBe(401);
    await ctx.close();
  });

  test("imports a CSV with an error report", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", `alice-${stamp}@e2e.example`);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/imports/new?entity=leads");
    await page.setInputFiles("#file", {
      name: "leads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("First Name,Last Name,Email,Company\nAna,Lopez,ana@acme.example,Acme\nBob,,bob@acme.example,Acme\n"),
    });
    await page.getByRole("button", { name: "Upload and preview" }).click();
    await expect(page.getByText("1. Map columns")).toBeVisible();
    await page.getByRole("button", { name: "Validate (dry run)" }).click();
    await expect(page.getByText("Row 3")).toBeVisible();
    await page.getByRole("button", { name: "Import 1 valid row" }).click();
    await expect(page.getByText("Result")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /Download error/ })).toBeVisible();
    await page.goto("/leads?q=lopez");
    await expect(page.getByRole("link", { name: "Ana Lopez" })).toBeVisible();
  });

  test("mobile layout keeps core actions reachable", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto("/login");
    await page.fill("#email", `alice-${stamp}@e2e.example`);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL("/tasks");
    await expect(page.getByText("Send revised commercial proposal")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await ctx.close();
  });
});

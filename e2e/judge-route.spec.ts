import { test, expect } from "@playwright/test";

const CLAIM = "A fresh USDC deposit address per invoice, no key to guard, swept in one transaction. Live on Arc mainnet.";

test.describe("/judge — the reviewer page", () => {
  test("renders with no credentials, no session, no wallet — 200 + the claim sentence", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined }); // fresh: no localStorage, no cookies
    const page = await ctx.newPage();
    const res = await page.goto("/#/judge");
    expect(res?.status()).toBe(200);
    await expect(page.locator("#claim")).toHaveText(CLAIM);
    await expect(page.getByRole("heading", { name: "The 60-second path (one Arc wallet, ≤ $0.10)" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Honest limitations" })).toBeVisible();
    await expect(page.getByText("37 (12 Foundry + 25 vitest)")).toBeVisible();
    await ctx.close();
  });

  test("every explorer link on the page points at Arc's explorer and every repo link at the public repo", async ({ page }) => {
    await page.goto("/#/judge");
    const hrefs = await page.locator("#app a[target=_blank]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThan(8);
    for (const h of hrefs) expect(h).toMatch(/^https:\/\/(explorer\.arc\.io|github\.com\/edycutjong\/pigeonhole-arc)/);
  });

  test("is reachable from the top bar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "For reviewers" }).click();
    await expect(page).toHaveURL(/#\/judge$/);
    await expect(page.locator("#claim")).toBeVisible();
  });
});

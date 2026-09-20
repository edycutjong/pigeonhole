import { test, expect } from "@playwright/test";

// Zero-config smoke: the static bundle loads with no keys, no wallet, no backend.
test.describe("smoke — the page loads on its own", () => {
  test("title, description, OG card and favicon are set", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Pigeonhole — keyless USDC deposit addresses on Arc");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /no private key to guard/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /og-image\.png/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const og = await page.locator('meta[property="og:image"]').getAttribute("content");
    const r = await page.request.get(new URL(og!).pathname);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("image/png");
  });

  test("home renders the invoice form and no uncaught errors are thrown", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("no key to guard");
    await expect(page.getByPlaceholder("e.g. acme-2026-0042")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create deposit address →" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Factory ↗" })).toHaveAttribute("href", /explorer\.arc\.io\/address\/0x942b8c10/);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("footer states the no-backend claim and the chain", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("footer")).toContainText("chain 5042");
    await expect(page.locator("footer")).toContainText("no backend, no database");
  });
});

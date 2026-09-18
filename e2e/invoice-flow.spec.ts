import { test, expect } from "@playwright/test";

// The core flow: invoice id → CREATE2 address (offline, no tx) → live state from eth_getLogs.
// `demo-paid` is the seeded first cycle on the production factory (deployments/arc-mainnet.json), so its address
// is known and its chain state is SWEPT forever — the ideal read-only E2E fixture.
const DEMO_PAID = "0xb356C620E45d8d8C884a6235dD660c32f0a1F26b";

test.describe("invoice flow", () => {
  test("typing an id yields the deterministic CREATE2 address, a QR code, and a disabled Sweep at 0 unswept", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("e.g. acme-2026-0042").fill("demo-paid");
    await page.getByPlaceholder("e.g. 0.02").fill("0.02");
    await page.getByRole("button", { name: "Create deposit address →" }).click();
    await expect(page).toHaveURL(/#\/i\/demo-paid\?amt=0\.02&from=\d+/);
    await expect(page.locator(".addr")).toContainText(DEMO_PAID);
    await expect(page.locator("#qr canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: /Pay with wallet \(0\.02 USDC\)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sweep → treasury" })).toBeDisabled();
    await expect(page.locator(".filter")).toContainText("eth_getLogs");
  });

  test("Enter in the id field submits too, and an empty id does nothing", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("e.g. acme-2026-0042").press("Enter");
    await expect(page).toHaveURL(/\/$|#\/$/);
    await page.getByPlaceholder("e.g. acme-2026-0042").fill("acme-1");
    await page.getByPlaceholder("e.g. acme-2026-0042").press("Enter");
    await expect(page).toHaveURL(/#\/i\/acme-1\?from=\d+/);
  });

  test("a malformed ?amt= is ignored instead of throwing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/#/i/x?amt=not-a-number");
    await expect(page.locator(".addr")).toContainText(/^0x[0-9a-fA-F]{40}/);
    await expect(page.getByRole("button", { name: "Pay with wallet" })).toBeVisible();
    expect(errors).toEqual([]);
  });
});

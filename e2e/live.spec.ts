import { test, expect } from "@playwright/test";
import { rpcReachable } from "./_rpc";

// Read-only against Arc mainnet. These are the tests that prove the page's state really comes from eth_getLogs:
// `demo-paid` is the seeded first cycle on the production factory (deployments/arc-mainnet.json) and is SWEPT forever.
// The treasury view walks from the factory's deploy block in 9,000-block chunks, so it gets slower every day — hence
// the long timeout. Both skip themselves when the runner cannot reach the public RPC.
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.describe("live — state read from Arc mainnet", () => {
  test("live: the seeded demo-paid invoice reads SWEPT from the system emitter and invariant I2 holds", async ({ page }) => {
    test.skip(!(await rpcReachable()), "Arc public RPC not reachable from this runner");
    await page.goto("/#/i/demo-paid?from=21337182");
    await expect(page.locator("#st")).toContainText("SWEPT", { timeout: 60_000 });
    await expect(page.locator("#i2")).toContainText("holds", { timeout: 60_000 });
    await expect(page.locator("#paidin")).toHaveText("0.020000 USDC");
    await expect(page.locator("#unswept")).toHaveText("0.000000 USDC");
    const rows = page.locator("#moves tbody tr");
    await expect(rows).toHaveCount(2); // one ↓ pay, one ↑ sweep
    await expect(rows.nth(1).locator("a")).toHaveAttribute("href", /0xe639255a/);
  });

  test("live: the treasury view lists sweeps from the factory's Swept events", async ({ page }) => {
    test.skip(!(await rpcReachable()), "Arc public RPC not reachable from this runner");
    await page.goto("/#/treasury");
    await expect(page.locator("#tbl tbody tr").first()).toBeVisible({ timeout: 90_000 });
    expect(await page.locator("#tbl tbody tr").count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#tbl")).toContainText("USDC");
  });
});

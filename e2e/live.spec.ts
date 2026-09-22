import { test, expect } from "@playwright/test";
import { rpcReachable } from "./_rpc";

// Read-only against Arc mainnet. These are the tests that prove the page's state really comes from eth_getLogs:
// `demo-paid` is the seeded first cycle on the production factory (deployments/arc-mainnet.json) and is SWEPT forever.
// Both views walk from the factory's deploy block in 9,000-block chunks, sequentially, paced to the public RPC's ≈3
// getLogs/s (2026-09-20) — so they get slower every day; hence the long timeouts. Both skip when the RPC is unreachable.
test.describe.configure({ mode: "serial" });
test.setTimeout(320_000);

test.describe("live — state read from Arc mainnet", () => {
  test("live: the seeded demo-paid invoice reads SWEPT from the system emitter and invariant I2 holds", async ({ page }) => {
    test.skip(!(await rpcReachable()), "Arc public RPC not reachable from this runner");
    await page.goto("/#/i/demo-paid?from=21337182");
    await expect(page.locator("#st")).toContainText("SWEPT", { timeout: 280_000 });
    await expect(page.locator("#i2")).toContainText("holds", { timeout: 30_000 });
    await expect(page.locator("#paidin")).toHaveText("0.020000 USDC");
    await expect(page.locator("#unswept")).toHaveText("0.000000 USDC");
    await expect(page.locator("#next")).toContainText("reusable"); // a swept invoice tells the reader what to do next
    const rows = page.locator("#moves tbody tr");
    await expect(rows).toHaveCount(2); // one ↓ pay, one ↑ sweep
    await expect(rows.nth(1).locator("a")).toHaveAttribute("href", /0xe639255a/);
  });

  test("live: the treasury view lists sweeps from the factory's Swept events", async ({ page }) => {
    test.skip(!(await rpcReachable()), "Arc public RPC not reachable from this runner");
    await page.goto("/#/treasury");
    await expect(page.locator("#tbl tbody tr").first()).toBeVisible({ timeout: 280_000 });
    expect(await page.locator("#tbl tbody tr").count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator("#tbl")).toContainText("USDC");
    // Milestone 1: every Swept address is re-read for its live balance; the bench batches (many-*) were swept to 0, so the
    // open set is whatever is funded right now — the button's state must agree with the table, whichever way it is.
    await expect(page.locator("#open-n")).toContainText("known addresses hold funds", { timeout: 60_000 });
    const open = await page.locator("#open tbody tr").count();
    if (open === 0) { await expect(page.locator("#sweep-all")).toBeDisabled(); await expect(page.locator("#open")).toContainText("Nothing to sweep"); }
    else { await expect(page.locator("#sweep-all")).toBeEnabled(); await expect(page.locator("#sweep-all")).toContainText(`${open} address`); }
    expect(await page.locator("#tr-open").textContent()).toMatch(/^\d+\.\d{6}$/);
  });
});

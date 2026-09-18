import { test, expect } from "@playwright/test";

const viewports = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const vp of viewports) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("no horizontal overflow on home, invoice and judge pages", async ({ page }) => {
      for (const path of ["/", "/#/i/demo-paid?amt=0.02&from=21337182", "/#/judge"]) {
        await page.goto(path);
        await page.waitForSelector("#app h1");
        const [scrollW, innerW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
        expect(scrollW, `${path} overflows at ${vp.width}px`).toBeLessThanOrEqual(innerW + 1);
      }
    });

    test("header fits the viewport and primary controls are touch-sized (≥ 36px)", async ({ page }) => {
      await page.goto("/");
      const header = await page.locator("header.topbar").boundingBox();
      expect(header!.width).toBeLessThanOrEqual(vp.width + 1);
      const btn = await page.getByRole("button", { name: "Create deposit address →" }).boundingBox();
      expect(btn!.height).toBeGreaterThanOrEqual(36);
      const input = await page.getByPlaceholder("e.g. acme-2026-0042").boundingBox();
      expect(input!.height).toBeGreaterThanOrEqual(36);
    });
  });
}

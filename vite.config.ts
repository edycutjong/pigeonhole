import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The release stamp shown in the footer: the git tag on the built commit (release.yml tags every releasable push, so the
 *  Pages deploy — which checks out with full history — sees it), else `v<package.json>-dev` for a local or tagless build. */
function appVersion(): string {
  try { return execSync("git describe --tags --abbrev=0", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return `v${JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version}-dev`; }
}
/** Inline the (single, small) stylesheet into index.html instead of emitting a render-blocking <link>: GitHub Pages caps
 *  cache-control at 10 minutes, so a separate CSS file costs a round-trip on the first-paint path and buys almost no reuse. */
function inlineCss(): Plugin {
  return {
    name: "pigeonhole:inline-css",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        for (const [name, asset] of Object.entries(bundle)) {
          if (asset.type !== "asset" || !name.endsWith(".css")) continue;
          const tag = new RegExp(`<link[^>]*href="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
          if (!tag.test(html)) continue;
          html = html.replace(tag, `<style>${String(asset.source)}</style>`);
          delete bundle[name];
        }
        return html;
      },
    },
  };
}
export default defineConfig({
  plugins: [inlineCss()],
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  build: { target: "esnext", outDir: "dist" },
  // Playwright specs live in e2e/ and must never be collected by vitest.
  test: { include: ["test/**/*.{test,spec}.ts"], exclude: ["e2e/**", "node_modules/**", "dist/**"], testTimeout: 60_000 },
});

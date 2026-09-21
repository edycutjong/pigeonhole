import { defineConfig } from "vitest/config";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The release stamp shown in the footer: the git tag on the built commit (release.yml tags every releasable push, so the
 *  Pages deploy — which checks out with full history — sees it), else `v<package.json>-dev` for a local or tagless build. */
function appVersion(): string {
  try { return execSync("git describe --tags --abbrev=0", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return `v${JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version}-dev`; }
}
export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  build: { target: "esnext", outDir: "dist" },
  // Playwright specs live in e2e/ and must never be collected by vitest.
  test: { include: ["test/**/*.{test,spec}.ts"], exclude: ["e2e/**", "node_modules/**", "dist/**"], testTimeout: 60_000 },
});

import { defineConfig } from "vitest/config";
export default defineConfig({
  base: "./",
  build: { target: "esnext", outDir: "dist" },
  // Playwright specs live in e2e/ and must never be collected by vitest.
  test: { include: ["test/**/*.{test,spec}.ts"], exclude: ["e2e/**", "node_modules/**", "dist/**"] },
});

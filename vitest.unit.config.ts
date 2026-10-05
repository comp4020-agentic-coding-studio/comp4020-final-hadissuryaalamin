import { defineConfig } from "vitest/config";

// Colocated unit tests (src/**/*.test.ts): pure logic and DB-layer tests that
// don't need a running app, unlike spec/ (see vitest.config.ts) which waits
// for one via spec/global-setup.ts. Kept as a separate config so these never
// block on, or require, a live server.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});

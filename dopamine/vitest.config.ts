import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-logic units only (color / tempo / mood). The WebGL renderer and DOM
    // overlay are validated by the Playwright recording, not unit tests.
    include: ["packages/core/test/**/*.test.ts"],
    environment: "node",
  },
});

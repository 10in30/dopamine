import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (p: string): string =>
  fileURLToPath(new URL(`./packages/${p}`, import.meta.url));

export default defineConfig({
  // Resolve every @dopamine/* package to its TS SOURCE so the suite runs against
  // source (no pre-build needed) — mirrors the demo's Vite aliases.
  resolve: {
    alias: [
      { find: /^@dopamine\/core$/, replacement: pkg("core/src/index.ts") },
      { find: /^@dopamine\/effects$/, replacement: pkg("effects/src/index.ts") },
      { find: /^@dopamine\/effect-(.*)$/, replacement: pkg("effect-$1/src/index.ts") },
    ],
  },
  test: {
    // Pure-logic units across every package (core runtime + each effect package
    // + the umbrella). The WebGL renderer and DOM overlay are validated by the
    // Playwright recording, not unit tests. `tools/*/test` covers the
    // cross-platform build toolchain (single-folder → platform artifacts).
    include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.mjs"],
    environment: "node",
  },
});

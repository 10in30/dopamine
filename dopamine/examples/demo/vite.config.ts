import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const src = (p: string): string =>
  fileURLToPath(new URL(`../../packages/core/src/${p}`, import.meta.url));

// Resolve @dopamine/core (and its subpath exports) straight to source so the demo
// needs no pre-build during `dev`, `build`, or the Playwright recording. The
// subpath aliases mirror the package's `exports` map so the demo can import the
// lean runtime (`@dopamine/core/core`) + only the effects it needs
// (`@dopamine/core/effects/<name>`), which Vite then code-splits into per-effect
// chunks (see the dynamic imports in src/main.ts).
export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      { find: /^@dopamine\/core\/core$/, replacement: src("core.ts") },
      { find: /^@dopamine\/core\/effects\/(.*)$/, replacement: src("effects/$1.ts") },
      { find: /^@dopamine\/core$/, replacement: src("index.ts") },
    ],
  },
});

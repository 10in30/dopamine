import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const pkg = (p: string): string =>
  fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// Resolve @dopamine/core + every @dopamine/effect-* package + the @dopamine/effects
// umbrella straight to SOURCE so the demo needs no pre-build during `dev`,
// `build`, or the Playwright recording. The demo imports the lean runtime from
// `@dopamine/core` and pulls only the effects it needs from their own packages
// (`@dopamine/effect-<name>`), which Vite then code-splits into per-effect chunks
// (see the dynamic imports in src/main.ts).
export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      { find: /^@dopamine\/core$/, replacement: pkg("core/src/index.ts") },
      { find: /^@dopamine\/effects$/, replacement: pkg("effects/src/index.ts") },
      // comic moved to the single-folder model (effects/comic/web) — resolve it
      // there, BEFORE the generic packages/effect-* alias below.
      { find: /^@dopamine\/effect-comic$/, replacement: fileURLToPath(new URL("../../effects/comic/web/src/index.ts", import.meta.url)) },
      { find: /^@dopamine\/effect-(.*)$/, replacement: pkg("effect-$1/src/index.ts") },
    ],
  },
});

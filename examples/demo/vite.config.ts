import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

const pkg = (p: string): string =>
  fileURLToPath(new URL(`../../packages/${p}`, import.meta.url));

// Effects migrated to the single-folder model (effects/<name>/web) resolve there;
// the rest still resolve to packages/effect-<name>. Auto-discovered so a freshly
// moved effect needs no alias edit (mirrors vitest.config.ts).
const movedEffectAliases = (() => {
  let names: string[] = [];
  try {
    names = readdirSync(fileURLToPath(new URL("../../effects/", import.meta.url))).filter((n) =>
      existsSync(fileURLToPath(new URL(`../../effects/${n}/web/src/index.ts`, import.meta.url))),
    );
  } catch { /* no effects/ yet */ }
  return names.map((n) => ({
    find: new RegExp(`^@dopamine\\/effect-${n}$`),
    replacement: fileURLToPath(new URL(`../../effects/${n}/web/src/index.ts`, import.meta.url)),
  }));
})();

// Resolve @dopaminefx/core + every @dopaminefx/effect-* package + the @dopaminefx/effects
// umbrella straight to SOURCE so the demo needs no pre-build during `dev`,
// `build`, or the Playwright recording. The demo imports the lean runtime from
// `@dopaminefx/core` and pulls only the effects it needs from their own packages
// (`@dopaminefx/effect-<name>`), which Vite then code-splits into per-effect chunks
// (see the dynamic imports in src/main.ts).
export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      { find: /^@dopamine\/core$/, replacement: pkg("core/src/index.ts") },
      { find: /^@dopamine\/effects$/, replacement: pkg("effects/src/index.ts") },
      // Moved effects (effects/<name>/web) resolve here, BEFORE the generic alias.
      ...movedEffectAliases,
      { find: /^@dopamine\/effect-(.*)$/, replacement: pkg("effect-$1/src/index.ts") },
    ],
  },
});

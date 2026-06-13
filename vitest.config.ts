import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

const pkg = (p: string): string =>
  fileURLToPath(new URL(`./packages/${p}`, import.meta.url));

// Effects migrated to the single-folder model (effects/<name>/web) resolve there;
// the rest still resolve to packages/effect-<name>. Auto-discovered so a freshly
// moved effect needs no alias edit — its `effects/<name>/web/src/index.ts` is
// placed BEFORE the generic packages/effect-* alias below, so it wins.
const movedEffectAliases = (() => {
  let names: string[] = [];
  try {
    names = readdirSync(fileURLToPath(new URL("./effects/", import.meta.url))).filter((n) =>
      existsSync(fileURLToPath(new URL(`./effects/${n}/web/src/index.ts`, import.meta.url))),
    );
  } catch { /* no effects/ yet */ }
  return names.map((n) => ({
    find: new RegExp(`^@dopamine\\/effect-${n}$`),
    replacement: fileURLToPath(new URL(`./effects/${n}/web/src/index.ts`, import.meta.url)),
  }));
})();

export default defineConfig({
  // Resolve every @dopaminefx/* package to its TS SOURCE so the suite runs against
  // source (no pre-build needed) — mirrors the demo's Vite aliases.
  resolve: {
    alias: [
      { find: /^@dopamine\/core$/, replacement: pkg("core/src/index.ts") },
      { find: /^@dopamine\/effects$/, replacement: pkg("effects/src/index.ts") },
      // Moved effects (effects/<name>/web) resolve here, BEFORE the generic alias.
      ...movedEffectAliases,
      { find: /^@dopamine\/effect-(.*)$/, replacement: pkg("effect-$1/src/index.ts") },
    ],
  },
  test: {
    // Pure-logic units across every package (core runtime + each effect package
    // + the umbrella). The WebGL renderer and DOM overlay are validated by the
    // Playwright recording, not unit tests. `tools/*/test` covers the
    // cross-platform build toolchain (single-folder → platform artifacts).
    include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.mjs", "effects/*/web/test/**/*.test.ts"],
    environment: "node",
  },
});

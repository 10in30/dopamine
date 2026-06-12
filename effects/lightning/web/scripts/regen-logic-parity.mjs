#!/usr/bin/env node --experimental-strip-types
/**
 * Regenerate the lightning logic-parity fixture from the WEB logic (ground
 * truth) — the per-frame-geometry analog of swift/Scripts/regen-parity.sh.
 *
 *   node --experimental-strip-types effects/lightning/web/scripts/regen-logic-parity.mjs
 *
 * Writes web/test/lightning-logic-parity.json (COMMITTED). The vitest gate
 * (lightning-logic-parity.test.ts) fails if the committed fixture drifts from
 * the current logic; the generated Kotlin/Swift parity tests replay the same
 * fixture against the transpiled renderers. Requires Node >= 22 (the logic
 * module is imported as TypeScript via --experimental-strip-types; it is
 * self-contained, so no staging/rewriting is needed).
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildFixtureText } from "../test/logic-parity-grid.mjs";
import { computeLightningArrays } from "../src/lightning-logic.ts";

const out = fileURLToPath(new URL("../test/lightning-logic-parity.json", import.meta.url));
await writeFile(out, buildFixtureText(computeLightningArrays));
console.log(`wrote ${out}`);

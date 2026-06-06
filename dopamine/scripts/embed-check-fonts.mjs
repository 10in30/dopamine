/**
 * Regenerate packages/core/src/engine/check-fonts.ts from the CHECK-GLYPH woff2
 * subsets in packages/core/assets/fonts. Solarbloom's checkmark is a REAL font
 * glyph (✓ U+2713 / ✔ U+2714) drawn into an offscreen canvas and uploaded as a
 * texture; the face + codepoint are chosen by whimsy. The subsets carry only the
 * two check codepoints (a few hundred bytes each) so the effect ships its own
 * glyphs and never fetches an asset at runtime.
 *
 * The subsets were produced from the full SIL OFL faces (fonttools) with:
 *   pyftsubset Noto-Sans-Symbols-2.ttf --unicodes=2713,2714 --flavor=woff2
 *   pyftsubset Source-Sans-3.ttf       --unicodes=2713,2714 --flavor=woff2
 *
 * Usage: node scripts/embed-check-fonts.mjs
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fontDir = join(root, "packages", "core", "assets", "fonts");
const outFile = join(root, "packages", "core", "src", "engine", "check-fonts.ts");

const FACES = [
  { family: "Dopamine Check Sans", file: "SourceSans3-Check.woff2" },
  { family: "Dopamine Check Symbols", file: "NotoSansSymbols2-Check.woff2" },
];

const header = `/**
 * Generated module: CHECK-GLYPH woff2 subsets bundled as base64 so the Solarbloom
 * success effect renders its checkmark from a REAL typeface glyph (✓ U+2713 /
 * ✔ U+2714) and never silently depends on a host font being installed.
 * Regenerate with scripts/embed-check-fonts.mjs.
 *
 * Faces (SIL Open Font License 1.1 — see assets/fonts/OFL.txt), subset to the two
 * check codepoints only:
 *   Dopamine Check Sans     — Source Sans 3 (humanist, refined ✓ / clean ✔)
 *   Dopamine Check Symbols  — Noto Sans Symbols 2 (calligraphic ✓ / fat playful ✔)
 *
 * Solarbloom selects (face, codepoint) by WHIMSY (see CHECK_GLYPHS in
 * engine/mood.ts): low whimsy = a refined/elegant check, high = a bold/playful one.
 */

export interface CheckFace {
  /** CSS font-family name to register + use. */
  readonly family: string;
  /** base64-encoded woff2 payload (subset to U+2713 / U+2714 only). */
  readonly base64: string;
}

`;

const entries = FACES.map(({ family, file }) => {
  const b64 = readFileSync(join(fontDir, file)).toString("base64");
  return `  { family: ${JSON.stringify(family)}, base64: ${JSON.stringify(b64)} },`;
});

const body = `export const CHECK_FACES: readonly CheckFace[] = [\n${entries.join("\n")}\n];\n`;
writeFileSync(outFile, header + body);
console.log(`wrote ${outFile} (${statSync(outFile).size} bytes)`);

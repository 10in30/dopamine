/**
 * Regenerate packages/core/src/engine/comic-fonts.ts from the bundled woff2
 * faces in packages/core/assets/fonts. The Comic Impact effect ships its own
 * SIL OFL display faces as base64 so it never depends on a host-installed font.
 *
 * Usage: node scripts/embed-fonts.mjs
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fontDir = join(root, "packages", "core", "assets", "fonts");
const outFile = join(root, "packages", "core", "src", "engine", "comic-fonts.ts");

const FACES = [
  { family: "Bangers", file: "Bangers-Regular.woff2" },
  { family: "Anton", file: "Anton-Regular.woff2" },
  { family: "Luckiest Guy", file: "LuckiestGuy-Regular.woff2" },
];

const header = `/**
 * Generated module: SIL OFL display faces bundled as base64 woff2 so the Comic
 * Impact effect carries its OWN lettering and never silently depends on a host
 * font being installed. Regenerate with scripts/embed-fonts.mjs.
 *
 * Faces (all SIL Open Font License 1.1 — see assets/fonts/OFL.txt):
 *   Bangers      — exuberant comic brush caps (celebratory)
 *   Anton        — heavy condensed grotesque (electric / aggressive)
 *   Luckiest Guy — rounded bouncy balloon caps (serene / pop-art inflate)
 */

export interface EmbeddedFace {
  /** CSS font-family name to register + use. */
  readonly family: string;
  /** base64-encoded woff2 payload. */
  readonly base64: string;
}

`;

const entries = FACES.map(({ family, file }) => {
  const b64 = readFileSync(join(fontDir, file)).toString("base64");
  return `  { family: ${JSON.stringify(family)}, base64: ${JSON.stringify(b64)} },`;
});

const body = `export const EMBEDDED_FACES: readonly EmbeddedFace[] = [\n${entries.join("\n")}\n];\n`;
writeFileSync(outFile, header + body);
console.log(`wrote ${outFile} (${statSync(outFile).size} bytes)`);

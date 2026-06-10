/**
 * dopamine toolchain — woff2 → ttf font conversion.
 *
 * The single STORED font format is SIL-OFL woff2 (effects/<id>/fonts). The web
 * embeds those bytes base64 (comic-fonts.ts); Swift (Core Text) and Android
 * (Typeface) want a plain ttf, so the toolchain converts woff2→ttf at BUILD time
 * (no .ttf is committed) and the platform emitters bundle the result.
 *
 * Conversion is the verified fonttools snippet (`f.flavor = None; f.save(...)`),
 * invoked via `python3`; it needs `fonttools` + `brotli` (provisioned in
 * scripts/web-env-setup.sh + the CI font-prep step). `SOURCE_DATE_EPOCH=0` pins
 * the `head` table timestamps so the bytes are REPRODUCIBLE — otherwise every run
 * would differ and the `dopamine build --check` staleness gate would be flaky.
 *
 * Gated: an effect with no `x-build.fonts` block converts nothing, so `dopamine
 * build` still works for fontless effects.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The verified woff2→ttf snippet: strip the woff2 flavor, save a bare ttf. */
const PY_CONVERT = `
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
f.flavor = None
f.save(sys.argv[2])
`;

/**
 * Convert an effect's `x-build.fonts` woff2 faces to ttf Buffers.
 * @returns {Array<{ name: string, content: Buffer }>} `name` is the basename with
 *          a `.ttf` extension; empty when the effect declares no fonts.
 */
export function convertFonts({ dir, doc }) {
  const cfg = doc["x-build"]?.fonts;
  if (!cfg || !Array.isArray(cfg.files) || cfg.files.length === 0) return [];
  const srcDir = join(dir, cfg.source ?? "fonts");

  const work = mkdtempSync(join(tmpdir(), "dope-fonts-"));
  try {
    return cfg.files.map((file) => {
      const src = join(srcDir, file);
      const ttfName = file.replace(/\.woff2$/i, ".ttf");
      const dst = join(work, ttfName);
      execFileSync("python3", ["-c", PY_CONVERT, src, dst], {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, SOURCE_DATE_EPOCH: "0" },
      });
      return { name: ttfName, content: readFileSync(dst) };
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

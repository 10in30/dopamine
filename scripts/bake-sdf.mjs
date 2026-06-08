/**
 * Bake the `geometry.outlines.*.svgPath` of a `.dope` into inline SDF blobs.
 *
 * This is the build-time half of the geometry seam (docs/effect-format.md §2b):
 * the authored `.dope` carries human-editable SVG path strings; this step
 * rasterizes each into a small, self-contained signed-distance field and writes
 * it back INLINE under `geometry.outlines.<name>.sdf` (base64, no remote ref —
 * the standalone guard still passes). At runtime the effect only samples the SDF.
 *
 * It rewrites the `.dope` IN PLACE (idempotent: re-baking the same path yields
 * the same bytes), so the bundled `.dope` shipped in the repo already carries its
 * baked icon. Phase 2's pack-dope reuses this same baker.
 *
 * Usage: node scripts/bake-sdf.mjs <path-to.dope.json> [size] [range]
 *        node scripts/bake-sdf.mjs --all            (re-bake every bundled .dope)
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { importTs } from "./lib/load-ts.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sdf = await importTs(join(root, "packages/core/src/engine/sdf.ts"));

/** Bake every outline that declares an svgPath; mutate `doc` in place. */
export function bakeDoc(doc, size = 64, range = 18) {
  const geo = doc.geometry;
  if (!geo?.outlines) return 0;
  const viewBox = geo.viewBox ?? [0, 0, 100, 100];
  let n = 0;
  for (const [name, outline] of Object.entries(geo.outlines)) {
    if (typeof outline?.svgPath !== "string") continue;
    outline.sdf = sdf.bakeSdf(outline.svgPath, viewBox, size, range);
    n++;
    console.log(`  baked "${name}" (${outline.svgPath}) → ${size}^2 SDF, range ${range}`);
  }
  return n;
}

async function bakeFile(file, size, range) {
  const doc = JSON.parse(await readFile(file, "utf8"));
  console.log(`baking ${file}`);
  const n = bakeDoc(doc, size, range);
  if (n > 0) await writeFile(file, JSON.stringify(doc, null, 2) + "\n");
  console.log(`  → ${n} outline(s) baked`);
}

async function main() {
  const arg = process.argv[2];
  const size = Number(process.argv[3] ?? 64);
  const range = Number(process.argv[4] ?? 18);
  if (!arg) {
    console.error("usage: node scripts/bake-sdf.mjs <file.dope.json | --all> [size] [range]");
    process.exit(1);
  }
  if (arg === "--all") {
    // Each effect ships its own .dope in its package's src dir.
    for (const [pkg, f] of [
      ["effect-solarbloom", "solarbloom.dope.json"],
      ["effect-fail", "fail.dope.json"],
    ]) {
      try {
        await bakeFile(join(root, "packages", pkg, "src", f), size, range);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return;
  }
  await bakeFile(arg, size, range);
}

// Only run as a CLI (not when imported by pack-dope).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

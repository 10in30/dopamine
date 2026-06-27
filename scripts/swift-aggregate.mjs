/**
 * Write the AGGREGATE root `Package.swift` — the single, git-URL-installable
 * SwiftPM package exposing `DopamineCore` + every `DopamineEffect<Name>` product.
 *
 *   node scripts/swift-aggregate.mjs            # write ./Package.swift (repo root)
 *   node scripts/swift-aggregate.mjs --out DIR  # write DIR/Package.swift
 *
 * Run AFTER `node tools/dopamine/src/cli.mjs build` (the target paths point into
 * the generated `dist/swift/` trees). The release workflow runs both, then commits
 * the manifest + `dist/swift/` onto the tagged release tree — see
 * `.github/workflows/swift-release.yml`. The emitted bytes are gated by
 * `tools/dopamine/test/aggregate.test.mjs`.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEffect } from "../tools/dopamine/src/build.mjs";
import { emitAggregateSwiftPackage } from "../tools/dopamine/src/aggregate.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Effect folders under `effects/` that build a Swift package, sorted by slug. */
async function swiftEffects() {
  const base = join(ROOT, "effects");
  const entries = await readdir(base, { withFileTypes: true });
  const out = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory()) continue;
    const files = await readdir(join(base, e.name));
    if (!files.some((f) => f.endsWith(".dope.json"))) continue;
    const eff = await loadEffect(ROOT, join("effects", e.name));
    const sw = eff.doc["x-build"]?.swift;
    if (!sw) continue;
    out.push({
      module: sw.module ?? `DopamineEffect${pascal(eff.slug)}`,
      slug: eff.slug,
      hasFonts: !!eff.doc["x-build"]?.fonts?.files?.length,
      platforms: sw.platforms,
    });
  }
  return out.sort((a, b) => a.module.localeCompare(b.module));
}

async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : ROOT;
  const dir = isAbsolute(outDir) ? outDir : join(ROOT, outDir);

  const entries = await swiftEffects();
  // Every effect declares the same platforms today; take the first effect's clause
  // so a future bump in the `.dope` flows through without editing this script.
  const platforms = entries[0]?.platforms;
  const content = emitAggregateSwiftPackage(entries, platforms ? { platforms } : undefined);

  const dest = join(dir, "Package.swift");
  const prev = await readFile(dest, "utf8").catch(() => null);
  if (prev === content) {
    console.log(`ok     ${dest} (${entries.length} effect products)`);
    return;
  }
  await writeFile(dest, content);
  console.log(`${prev === null ? "created" : "wrote  "} ${dest} (${entries.length} effect products)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

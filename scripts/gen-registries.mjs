/**
 * Regenerate every effect REGISTRY from the one canonical, folder-discovered list
 * (scripts/lib/effects.mjs) so no list can drift from the effects on disk — the
 * web umbrella + demo, the README gallery, and the Swift + Android demo
 * registries + their dependency manifests all derive from the SAME source.
 *
 *   node scripts/gen-registries.mjs           # rewrite the generated blocks in place
 *   node scripts/gen-registries.mjs --check    # CI gate: fail if anything is stale
 *
 * Each target carries a `dopamine:effects:<id>` … `:end` marker pair; only the
 * lines BETWEEN the markers are generated — the surrounding hand-written code is
 * untouched. Add `effects/<name>/` + re-run and the effect appears everywhere.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { discoverEffects, ROOT } from "./lib/effects.mjs";

const CHECK = process.argv.includes("--check");
const EFFECTS = discoverEffects(ROOT);
const hasMedia = (sub, slug) => existsSync(join(ROOT, "docs", "media", sub, `${slug}.gif`));

/** Replace the lines strictly between the `<id>` start/end markers with `body`. */
function fill(text, id, body) {
  const lines = text.split("\n");
  const tag = `dopamine:effects:${id}`;
  const startIdx = lines.findIndex((l) => l.includes(tag) && !l.includes(`${tag}:end`));
  const endIdx = lines.findIndex((l) => l.includes(`${tag}:end`));
  if (startIdx < 0 || endIdx < 0 || endIdx < startIdx) {
    throw new Error(`gen-registries: markers for "${id}" not found (start=${startIdx} end=${endIdx})`);
  }
  const out = [...lines.slice(0, startIdx + 1), ...body, ...lines.slice(endIdx)];
  return out.join("\n");
}

/** Apply a set of {id, body} blocks to a file; returns the new text. */
function render(path, blocks) {
  let text = readFileSync(path, "utf8");
  for (const [id, body] of Object.entries(blocks)) text = fill(text, id, body);
  return text;
}

// --- the generated bodies, per target -------------------------------------
const slugs = EFFECTS.map((e) => e.slug);

const targets = {
  // The README gallery table + still-frame strip.
  "README.md": render(join(ROOT, "README.md"), {
    gallery: EFFECTS.map((e) => {
      const web = `<img src="docs/media/${e.slug}.gif" width="380" alt="${e.slug} — web">`;
      const ios = hasMedia("ios", e.slug) ? `<img src="docs/media/ios/${e.slug}.gif" width="380" alt="${e.slug} — iOS">` : "_pending_";
      const and = hasMedia("android", e.slug) ? `<img src="docs/media/android/${e.slug}.gif" width="380" alt="${e.slug} — Android">` : "_pending_";
      return `| **${e.slug}**<br>${e.category} | ${web} | ${ios} | ${and} |`;
    }),
    stills: EFFECTS.map((e) => `<img src="docs/media/${e.slug}.png" width="240" alt="${e.slug}">`),
  }),

  // The web umbrella: per-effect imports + the BUILTINS array + the EffectName union.
  "packages/effects/src/index.ts": render(join(ROOT, "packages/effects/src/index.ts"), {
    imports: EFFECTS.map((e) => `import { ${e.slug} as ${e.slug}Effect } from "${e.webPackage}";`),
    builtins: EFFECTS.map((e) => `  ${e.slug}Effect,`),
    names: [`  | ${slugs.map((s) => `"${s}"`).join(" | ")};`],
  }),

  // The demo: the lazy per-effect import map + the EffectName union.
  "examples/demo/src/main.ts": render(join(ROOT, "examples/demo/src/main.ts"), {
    loaders: EFFECTS.map((e) => `  ${e.slug}: () => import("${e.webPackage}"),`),
    names: [`  | ${slugs.map((s) => `"${s}"`).join(" | ")};`],
  }),

  // The demo effect-picker buttons (label = the actual effect name; loopers tagged).
  "examples/demo/index.html": render(join(ROOT, "examples/demo/index.html"), {
    buttons: EFFECTS.map((e) => `            <button data-effect="${e.slug}"${e.loop ? " data-loop" : ""}>${e.slug}</button>`),
  }),

  // Swift demo registry: per-effect imports + the `all` DemoEffect array.
  "swift/Demo/Sources/EffectRegistry.swift": render(join(ROOT, "swift/Demo/Sources/EffectRegistry.swift"), {
    imports: EFFECTS.map((e) => `import ${e.swiftModule}`),
    all: EFFECTS.flatMap((e) => {
      // A hand-written Swift factory (effects/<slug>/swift/<Name>.swift) uses
      // <Name>Config(); a generated factory uses <Name>.passConfig().
      const hand = existsSync(join(ROOT, "effects", e.slug, "swift", `${e.Name}.swift`));
      const config = hand ? `${e.Name}Config()` : `${e.Name}.passConfig()`;
      return [
        `        DemoEffect(name: "${e.slug}") { device in`,
        `            guard let lib = try? device.makeDefaultLibrary(bundle: ${e.Name}Resources.bundle),`,
        `                  let host = try? MetalOverlayHost(config: ${config}, device: device,`,
        `                                                   library: lib, wantsShadow: false),`,
        `                  let fx = try? ${e.Name}() else { return nil }`,
        `            return (host, { (try? fx.resolve($0)) ?? [:] })`,
        `        },`,
      ];
    }),
  }),

  // Swift demo XcodeGen manifest: the SwiftPM package paths + the target deps.
  "swift/Demo/project.yml": render(join(ROOT, "swift/Demo/project.yml"), {
    packages: EFFECTS.flatMap((e) => [
      `  ${e.swiftModule}:`,
      `    path: "../../dist/swift/${e.swiftModule}"`,
    ]),
    deps: EFFECTS.flatMap((e) => [
      `      - package: ${e.swiftModule}`,
      `        product: ${e.swiftModule}`,
    ]),
  }),

  // Android umbrella: per-effect imports + the registerAll() body.
  "android/dopamine-effects/src/main/kotlin/ai/dopamine/effects/Dopamine.kt": render(
    join(ROOT, "android/dopamine-effects/src/main/kotlin/ai/dopamine/effects/Dopamine.kt"),
    {
      imports: EFFECTS.map((e) => `import ${e.androidPackage}.${e.Name}`),
      register: EFFECTS.map((e) => `        ${e.Name}.register(app)`),
    },
  ),

  // Android umbrella build deps.
  "android/dopamine-effects/build.gradle.kts": render(join(ROOT, "android/dopamine-effects/build.gradle.kts"), {
    deps: EFFECTS.map((e) => `    api(project(":${e.androidModule}"))`),
  }),
};

let stale = 0;
for (const [rel, text] of Object.entries(targets)) {
  const path = join(ROOT, rel);
  const current = readFileSync(path, "utf8");
  if (current === text) continue;
  stale++;
  if (CHECK) {
    console.error(`stale: ${rel}`);
  } else {
    writeFileSync(path, text);
    console.log(`updated: ${rel}`);
  }
}

if (CHECK && stale) {
  console.error(`\n${stale} registr${stale === 1 ? "y" : "ies"} out of date — run: node scripts/gen-registries.mjs`);
  process.exit(1);
}
console.log(CHECK ? "registries up to date." : `done (${Object.keys(targets).length} targets).`);

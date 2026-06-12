/**
 * dopamine toolchain — the build orchestrator.
 *
 * The single file `effects/<id>/<slug>.dope.json` is the source of truth: the
 * portable runtime data (including the cross-platform `binding` contract the
 * runtimes derive their uniform bindings from) + the `x-build` per-platform
 * config, in ONE document. This loads it and produces:
 *
 *   • dist artifacts  — the standalone, installable platform packages under
 *     `dist/<platform>/` (a SwiftPM package, an npm package; Android next).
 *   • sync artifacts  — files written back INTO the source tree (gitignored) that
 *     the in-repo workspace packages need to build/test against source — today
 *     just the portable `.dope` the web workspace package imports (`./<slug>.dope.json`).
 *
 * The `.dope` EMBEDDED everywhere is the PORTABLE subset (`portableDope`): the
 * source minus the toolchain-only keys, so the shipped runtime doc is
 * standalone-safe and identical across platforms.
 */

import { join, isAbsolute, relative } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { generateSwiftPackage } from "./swift.mjs";
import { generateNpmPackage } from "./web.mjs";
import { generateAndroidLibrary } from "./android.mjs";
import { convertFonts } from "./fonts.mjs";
import { loadLogic, emitKotlinLogicParityTest } from "./logic.mjs";

/**
 * Top-level `.dope` keys that are TOOLCHAIN-only — consumed here, never shipped.
 * NOTE: `binding` is NOT in this list — it SHIPS in the portable doc, because the
 * runtimes derive their uniform bindings from it (the toolchain also consumes it
 * for the Metal struct codegen).
 */
export const TOOLCHAIN_KEYS = ["slug", "kind", "x-build"];

/**
 * The portable runtime `.dope` (the embedded resource): the source document minus
 * the toolchain-only keys, re-serialized with stable 2-space formatting + trailing
 * newline. Identical bytes on every platform → the md5 parity gate stays green.
 */
export function portableDope(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!TOOLCHAIN_KEYS.includes(k)) out[k] = v;
  }
  return JSON.stringify(out, null, 2) + "\n";
}

/** Load an effect folder: find its unified `*.dope.json`, parse it, derive slug. */
export async function loadEffect(root, effectDir) {
  const dir = isAbsolute(effectDir) ? effectDir : join(root, effectDir);
  const dopeName = (await readdir(dir)).find((f) => f.endsWith(".dope.json"));
  if (!dopeName) throw new Error(`dopamine: no *.dope.json found in ${dir}`);
  const sourceText = await readFile(join(dir, dopeName), "utf8");
  const doc = JSON.parse(sourceText);
  const slug = doc.slug ?? dopeName.replace(/\.dope\.json$/, "");
  return { dir, dopeName, doc, slug, sourceText, dope: portableDope(doc) };
}

/**
 * Build every configured platform package for one effect folder.
 * @returns {Promise<{ dist: Array<{path,content}>, sync: Array<{path,content}> }>}
 *          `dist` paths are relative to the dist output root; `sync` paths are
 *          relative to the repo root (in-source generated files, gitignored).
 */
export async function buildEffect({ root, effectDir, outDir }) {
  const eff = await loadEffect(root, effectDir);
  const build = eff.doc["x-build"] ?? {};
  const dist = [];
  const sync = [];

  // Convert the shared woff2 faces to ttf ONCE (gated: no `x-build.fonts` ⇒ []),
  // then hand the same Buffers to the Swift + Android emitters so each platform
  // package bundles its own lettering. The web embeds them base64 separately.
  const fonts = convertFonts(eff);

  // Transpile the CPU-precomputed per-frame GEOMETRY logic ONCE (gated: no
  // `x-build.logic` ⇒ null): the single web TS module → the generated Swift +
  // Kotlin renderers the platform emitters embed (logic.mjs).
  const logic = await loadLogic(eff);

  if (build.swift) {
    dist.push(...(await generateSwiftPackage({ root, eff, outDir, fonts, logic })));
  }
  if (build.web) {
    dist.push(...(await generateNpmPackage({ eff })));
    // The in-repo workspace package imports `./<slug>.dope.json`; write the portable
    // copy into its src (gitignored) so it builds/tests against source.
    const webSrc = build.web.sources ?? "web";
    sync.push({
      path: join(relative(root, eff.dir), webSrc, "src", `${eff.slug}.dope.json`),
      content: eff.dope,
    });
  }
  if (build.android) {
    dist.push(...(await generateAndroidLibrary({ root, eff, fonts, logic })));
    // The pure-JVM numeric parity gate for the generated Kotlin: sync the
    // generated renderer + a generated JUnit grid test + the committed web-dumped
    // fixture into dopamine-core's `testGenerated` test source set (gitignored),
    // so `:dopamine-core:test` COMPILES the generated Kotlin and replays the grid
    // on a plain JVM with no Android SDK (CI runs `dopamine build` first).
    if (logic?.fixture) {
      const Name = eff.slug.charAt(0).toUpperCase() + eff.slug.slice(1);
      const gen = join("android", "dopamine-core", "src", "testGenerated");
      sync.push({ path: join(gen, "kotlin", `${Name}Renderer.kt`), content: logic.kotlin });
      sync.push({
        path: join(gen, "kotlin", `${Name}LogicParityTest.kt`),
        content: emitKotlinLogicParityTest(logic.model, eff.slug, logic.namespace),
      });
      sync.push({ path: join(gen, "resources", `${eff.slug}-logic-parity.json`), content: logic.fixture });
    }
  }

  return { dist, sync };
}

/**
 * dopamine toolchain — the build orchestrator.
 *
 * The single file `effects/<id>/<slug>.dope.json` is the source of truth: the
 * portable runtime data + the cross-platform `binding` contract + the `x-build`
 * per-platform config, in ONE document. This loads it, and produces the artifacts
 * for every configured platform — each a `{ path, content }` relative to the
 * `dist/` output root. The CLI writes them; the test inspects them (no disk
 * writes), so building is pure + testable.
 *
 * Crucially, the `.dope` the toolchain EMBEDS in each platform package is the
 * PORTABLE subset (`portableDope`): the source minus the toolchain-only keys, so
 * the shipped runtime doc stays standalone-safe (no build URLs/paths trip the
 * `assertStandalone` guard) and identical across platforms.
 */

import { join, isAbsolute } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { generateSwiftPackage } from "./swift.mjs";

/** Top-level `.dope` keys that are TOOLCHAIN-only — consumed here, never shipped. */
export const TOOLCHAIN_KEYS = ["slug", "kind", "binding", "x-build"];

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
 * @returns {Promise<Array<{ path: string, content: string }>>} dist-relative paths.
 */
export async function buildEffect({ root, effectDir, outDir }) {
  const eff = await loadEffect(root, effectDir);
  const build = eff.doc["x-build"] ?? {};
  const artifacts = [];

  if (build.swift) {
    artifacts.push(...(await generateSwiftPackage({ root, eff, outDir })));
  }
  // TODO: build.android → generateAndroidLibrary(...)
  // TODO: build.web     → generateNpmPackage(...)

  return artifacts;
}

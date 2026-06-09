/**
 * dopamine toolchain — the build orchestrator.
 *
 * Loads a single effect folder (`effects/<id>/`: the manifest `effect.json`, the
 * `.dope` data spine, and the per-platform sources) and produces the list of
 * artifacts for every configured platform — each a `{ path, content }` where the
 * path is relative to the `dist/` output root. The CLI writes them; the toolchain
 * test inspects them directly (no disk writes), so building is pure + testable.
 *
 * Today it emits the SwiftPM package; the Android (Gradle library) and web (npm)
 * generators slot in here next, behind the same `manifest.platforms` config.
 */

import { join, isAbsolute } from "node:path";
import { readFile } from "node:fs/promises";
import { generateSwiftPackage } from "./swift.mjs";

/** Load an effect folder: its manifest + the referenced `.dope` (parsed + raw). */
export async function loadEffect(root, effectDir) {
  const dir = isAbsolute(effectDir) ? effectDir : join(root, effectDir);
  const manifest = JSON.parse(await readFile(join(dir, "effect.json"), "utf8"));
  const dataText = await readFile(join(dir, manifest.data), "utf8");
  const dope = JSON.parse(dataText);
  return { dir, manifest, dope, dataText };
}

/**
 * Build every configured platform package for one effect folder.
 * @returns {Promise<Array<{ path: string, content: string }>>} dist-relative paths.
 */
export async function buildEffect({ root, effectDir, outDir }) {
  const { dir, manifest, dope, dataText } = await loadEffect(root, effectDir);
  const artifacts = [];

  if (manifest.platforms?.swift) {
    artifacts.push(
      ...(await generateSwiftPackage({ root, effectDirAbs: dir, manifest, dope, dataText, outDir })),
    );
  }
  // TODO: manifest.platforms.android → generateAndroidLibrary(...)
  // TODO: manifest.platforms.web     → generateNpmPackage(...)

  return artifacts;
}

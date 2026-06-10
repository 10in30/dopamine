#!/usr/bin/env node
/**
 * dopamine — cross-platform effect build CLI.
 *
 *   dopamine build [effectDir ...] [--out <dir>] [--check] [--root <path>]
 *
 * Writes each effect's standalone, installable platform packages into the output
 * dir (default `dist/`, gitignored), plus any in-source generated files (the web
 * workspace's portable `.dope`, also gitignored). With `--check` it diffs against
 * disk and exits non-zero if stale (a CI gate) instead of writing.
 */

import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { buildEffect } from "./build.mjs";

/**
 * Discover every effect folder under `effects/` — a subdirectory holding a unified
 * `*.dope.json`. This is the default build set when no effect is named, so
 * `dopamine build` (+ `--check`) covers ALL migrated effects as they land in the
 * single-folder model, with zero per-effect wiring in package.json / CI.
 */
async function discoverEffects(root) {
  const base = join(root, "effects");
  let entries = [];
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return []; }
  const found = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const files = await readdir(join(base, e.name));
    if (files.some((f) => f.endsWith(".dope.json"))) found.push(join("effects", e.name));
  }
  return found.sort();
}

const toolDir = dirname(dirname(fileURLToPath(import.meta.url))); // tools/dopamine
const repoRoot = dirname(dirname(toolDir)); // <repo>

function parseArgs(argv) {
  let check = false, out = null, root = repoRoot;
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") check = true;
    else if (a === "--out") out = argv[++i];
    else if (a === "--root") root = argv[++i];
    else positionals.push(a);
  }
  return { check, out, root, positionals };
}

async function emit(label, absPath, content, check, state) {
  // Artifacts are either text (string) or binary (Buffer — e.g. the converted
  // ttf faces); compare + write each in its own encoding so binary stays intact.
  const binary = Buffer.isBuffer(content);
  let prev = null;
  try { prev = await readFile(absPath, binary ? undefined : "utf8"); } catch { /* new */ }
  const same = prev !== null && (binary ? prev.equals(content) : prev === content);
  if (!same) {
    state.stale = true;
    if (check) {
      console.error(`STALE: ${label}`);
    } else {
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content);
      console.log(`${prev === null ? "created" : "wrote  "} ${label}`);
    }
  } else if (!check) {
    console.log(`ok     ${label}`);
  }
}

async function main() {
  const { check, out, root, positionals } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0] ?? "build";
  if (cmd !== "build") {
    console.error(`dopamine: unknown command '${cmd}' (try: build)`);
    process.exit(2);
  }
  const outDir = out ? (isAbsolute(out) ? out : join(root, out)) : join(root, "dist");
  const named = positionals.slice(1);
  const targets = named.length ? named : await discoverEffects(root);

  const state = { stale: false };
  for (const effectDir of targets) {
    const { dist, sync } = await buildEffect({ root, effectDir, outDir });
    for (const a of dist) await emit(`dist/${a.path}`, join(outDir, a.path), a.content, check, state);
    for (const a of sync) await emit(a.path, join(root, a.path), a.content, check, state);
  }

  if (check && state.stale) {
    console.error("\ndopamine: artifacts are stale. Run `npm run dopamine -- build`.");
    process.exit(1);
  }
  if (check) console.log("dopamine: all artifacts up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

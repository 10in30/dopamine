#!/usr/bin/env node
/**
 * dopamine — cross-platform effect build CLI.
 *
 *   dopamine build [effectDir ...] [--out <dir>] [--check] [--root <path>]
 *
 * Reads each effect folder and writes its standalone, installable platform
 * packages into the output dir (default `dist/`, which is gitignored). With
 * `--check` it diffs against what's on disk and exits non-zero if stale (a CI
 * gate) instead of writing. Default target is `effects/comic` for now.
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { buildEffect } from "./build.mjs";

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

async function main() {
  const { check, out, root, positionals } = parseArgs(process.argv.slice(2));
  const cmd = positionals[0] ?? "build";
  if (cmd !== "build") {
    console.error(`dopamine: unknown command '${cmd}' (try: build)`);
    process.exit(2);
  }
  const outDir = out ? (isAbsolute(out) ? out : join(root, out)) : join(root, "dist");
  const targets = positionals.slice(1).length ? positionals.slice(1) : ["effects/comic"];

  let anyStale = false;
  for (const effectDir of targets) {
    const artifacts = await buildEffect({ root, effectDir, outDir });
    for (const a of artifacts) {
      const path = join(outDir, a.path);
      let prev = null;
      try { prev = await readFile(path, "utf8"); } catch { /* new */ }
      if (prev !== a.content) {
        anyStale = true;
        if (check) {
          console.error(`STALE: ${a.path}`);
        } else {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, a.content);
          console.log(`${prev === null ? "created" : "wrote  "} dist/${a.path}`);
        }
      } else if (!check) {
        console.log(`ok     dist/${a.path}`);
      }
    }
  }

  if (check && anyStale) {
    console.error("\ndopamine: dist artifacts are stale. Run `npm run dopamine -- build`.");
    process.exit(1);
  }
  if (check) console.log("dopamine: dist up to date.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

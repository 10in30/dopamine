/**
 * Decide WHICH effect clips the reel needs to (re)render this run, for the
 * incremental web-reel CI. Prints a space-separated list of REEL effect names to
 * STDOUT (empty = nothing to render, just re-stitch the cached clips).
 *
 * Policy:
 *   • A change under `effects/<name>/**` (the single-folder model) re-renders just
 *     that effect.
 *   • A change to anything SHARED — the core runtime, the effects umbrella, the
 *     demo the reel drives, or the reel pipeline itself (render-clips / stitch /
 *     lib/reel) — re-renders EVERY effect (they could all look different).
 *   • Any clip MISSING from the restored cache is always rendered (first run /
 *     partial cache), regardless of the diff.
 *   • No base ref (manual dispatch / shallow history / diff failure) ⇒ render all.
 *
 * The diff base is `REEL_BASE` (a git sha): the PR base on pull_request, the
 * previous tip on push. Logs go to STDERR so STDOUT stays just the name list.
 *
 *   REEL_BASE=<sha> node scripts/reel-changed.mjs   # → "comic heartburst"
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REEL, CLIPS_DIR } from "./lib/reel.mjs";

const names = REEL.map((s) => s.name);
const base = process.env.REEL_BASE?.trim();

/** Files that, when touched, invalidate EVERY clip (shared/core/pipeline/demo). */
function isShared(f) {
  return (
    f.startsWith("packages/core/") ||
    f.startsWith("packages/effects/") ||
    f.startsWith("examples/") ||
    f === "scripts/render-clips.mjs" ||
    f === "scripts/stitch.mjs" ||
    f === "scripts/reel-changed.mjs" ||
    f.startsWith("scripts/lib/") ||
    f === "package.json" ||
    f === "package-lock.json"
  );
}

function changedFiles() {
  if (!base) return null;
  try {
    return execSync(`git diff --name-only ${base} HEAD`, { encoding: "utf8" })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return null; // base not fetched / invalid (e.g. 000…0 on first push)
  }
}

function plan() {
  // Clips absent from the restored cache must always be (re)rendered.
  const missing = new Set(names.filter((n) => !existsSync(join(CLIPS_DIR, `${n}.mp4`))));

  const files = changedFiles();
  if (files === null) {
    console.error("reel-changed: no usable diff base → rendering ALL effects");
    return names;
  }
  if (files.some(isShared)) {
    console.error("reel-changed: shared/core/pipeline change → rendering ALL effects");
    return names;
  }
  const want = new Set(missing);
  for (const f of files) {
    // Effects now live in the single-folder model at effects/<name>/**.
    const m = f.match(/^effects\/([^/]+)\//);
    if (m && names.includes(m[1])) want.add(m[1]);
  }
  console.error(
    `reel-changed: base=${base.slice(0, 8)} changed effects=${[...want].join(", ") || "(none)"}`
    + (missing.size ? ` (incl. missing: ${[...missing].join(", ")})` : ""),
  );
  return names.filter((n) => want.has(n)); // keep REEL order
}

process.stdout.write(plan().join(" "));

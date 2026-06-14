/**
 * Decide WHICH effects the unified capture needs to (re)render this run, for the
 * incremental web-reel CI. Prints a space-separated list of effect names to
 * STDOUT (empty = nothing to render, just re-stitch the cached clips + reuse the
 * cached gif/png).
 *
 * Policy:
 *   • A change under `effects/<name>/**` (the single-folder model) re-renders just
 *     that effect.
 *   • A change to anything SHARED — the core runtime, the effects umbrella, the
 *     demo the capture drives, or the capture pipeline itself (render-clips /
 *     media / stitch / lib/*) — re-renders EVERY effect (they could all differ).
 *   • Any effect MISSING an expected output from the restored cache (its mp4 for a
 *     one-shot, or its gif/png) is always rendered (first run / partial cache).
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
import { EFFECTS, CLIPS_DIR, MEDIA_DIR } from "./lib/reel.mjs";

const names = EFFECTS.map((s) => s.name);
const base = process.env.REEL_BASE?.trim();

/** Files that, when touched, invalidate EVERY effect (shared/core/pipeline/demo). */
function isShared(f) {
  return (
    f.startsWith("packages/core/") ||
    f.startsWith("packages/effects/") ||
    f.startsWith("examples/") ||
    f === "scripts/render-clips.mjs" ||
    f === "scripts/media.mjs" ||
    f === "scripts/stitch.mjs" ||
    f === "scripts/reel-changed.mjs" ||
    f.startsWith("scripts/lib/") ||
    f === "package.json" ||
    f === "package-lock.json"
  );
}

/** An effect's expected cached outputs: mp4 (one-shots only) + gif + png. */
function outputsFor(seg) {
  const outs = [join(MEDIA_DIR, `${seg.name}.gif`), join(MEDIA_DIR, `${seg.name}.png`)];
  if (!seg.loop) outs.push(join(CLIPS_DIR, `${seg.name}.mp4`));
  return outs;
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
  // Effects missing ANY expected output from the restored cache must (re)render.
  const missing = new Set(
    EFFECTS.filter((s) => outputsFor(s).some((p) => !existsSync(p))).map((s) => s.name),
  );

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
    // Effects live in the single-folder model at effects/<name>/**.
    const m = f.match(/^effects\/([^/]+)\//);
    if (m && names.includes(m[1])) want.add(m[1]);
  }
  console.error(
    `reel-changed: base=${base.slice(0, 8)} changed effects=${[...want].join(", ") || "(none)"}`
    + (missing.size ? ` (incl. missing: ${[...missing].join(", ")})` : ""),
  );
  return names.filter((n) => want.has(n)); // keep manifest order
}

process.stdout.write(plan().join(" "));

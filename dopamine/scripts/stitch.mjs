/**
 * Stitch the per-effect clips (e2e/output/clips/<name>.mp4) into the suite reel
 * e2e/output/dopamine-suite.mp4, in REEL order. Skips effects whose clip hasn't
 * been rendered yet (so you can stitch a partial reel as effects land).
 *
 *   node scripts/render-clips.mjs   # render the clips first
 *   node scripts/stitch.mjs         # then concatenate them
 */
import { existsSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { REEL, CLIPS_DIR, OUT_DIR, ffmpeg } from "./lib/reel.mjs";

const clips = REEL.map((s) => join(CLIPS_DIR, `${s.name}.mp4`)).filter((p) => existsSync(p));
const missing = REEL.filter((s) => !existsSync(join(CLIPS_DIR, `${s.name}.mp4`))).map((s) => s.name);
if (missing.length) console.warn(`! missing clips (run render-clips for these): ${missing.join(", ")}`);
if (!clips.length) {
  console.error(`no clips in ${CLIPS_DIR} — run: node scripts/render-clips.mjs`);
  process.exit(1);
}

const listFile = join(OUT_DIR, "reel.txt");
await writeFile(listFile, clips.map((c) => `file '${c}'`).join("\n"));
const out = join(OUT_DIR, "dopamine-suite.mp4");
await ffmpeg([
  "-y", "-f", "concat", "-safe", "0", "-i", listFile,
  "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
]);
await rm(listFile, { force: true });
console.log(`✓ stitched ${clips.length} clip(s) → ${out}`);

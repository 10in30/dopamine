/**
 * Render per-effect media via the UNIFIED capture pass (one render → all formats):
 *   • the smooth mp4 reel clip   → e2e/output/clips/<name>.mp4
 *   • the README looping GIF      → docs/media/<name>.gif
 *   • the README still PNG        → docs/media/<name>.png
 *
 *   node scripts/render-clips.mjs            # every effect in the manifest
 *   node scripts/render-clips.mjs fail aurora  # only these (incremental)
 *
 * Then `node scripts/stitch.mjs` concatenates the mp4 clips into the suite reel.
 */
import { runCapture } from "./lib/capture.mjs";

await runCapture({ names: process.argv.slice(2), formats: { mp4: true, gif: true, png: true } });

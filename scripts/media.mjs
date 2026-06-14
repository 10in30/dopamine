/**
 * Render the README media — a still PNG + a downscaled looping GIF per effect,
 * into docs/media/ — via the UNIFIED capture pass (shared manifest + encoders in
 * scripts/lib/). This is the gif/png-only view of the same pipeline the reel uses
 * (no mp4), so the effect list never drifts from the reel or the demo.
 *
 *   node scripts/media.mjs            # every effect in the manifest
 *   node scripts/media.mjs comic fail # only these
 */
import { runCapture } from "./lib/capture.mjs";

await runCapture({ names: process.argv.slice(2), formats: { mp4: false, gif: true, png: true } });

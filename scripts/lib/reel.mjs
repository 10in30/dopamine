/**
 * Shared config + helpers for the UNIFIED capture pipeline (mp4 reel clips +
 * README gif/png), so there is ONE source of truth for the effect list and the
 * encoders — no more drifting lists where a new effect (e.g. checkmate) is added
 * to the demo but forgotten in the reel or the README media.
 *
 * One render pass per effect (see scripts/lib/capture.mjs → captureEffect)
 * produces every format: a smooth per-effect mp4 clip (`e2e/output/clips/<name>.mp4`,
 * concatenated by stitch.mjs into the suite reel), a downscaled palette-optimized
 * looping GIF and a still PNG (`docs/media/<name>.{gif,png}`, the README gallery).
 *
 * Frame-perfect fixed-timestep capture (see the offline renderer): each frame is
 * computed at an explicit time and screenshotted, so the result is smooth
 * regardless of software-WebGL speed.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { discoverEffects } from "./effects.mjs";

const require = createRequire(import.meta.url);

// scripts/lib/reel.mjs → up three = the repo root.
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const DEMO_DIR = join(ROOT, "examples", "demo");
export const OUT_DIR = join(ROOT, "e2e", "output");
export const CLIPS_DIR = join(OUT_DIR, "clips");
export const MEDIA_DIR = join(ROOT, "docs", "media");

export const FPS = 30;
export const TAIL = 16; // hold frames so the fade resolves (one-shot clips)
export const VIEWPORT = { width: 1100, height: 720 };
export const CHROMIUM_ARGS = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--enable-webgl",
];

// README gif/png derivation (downscaled from the captured frames; small files).
export const GIF_FPS = 11;     // playback rate of the looping GIF
export const GIF_WIDTH = 400;  // downscaled GIF width
export const PNG_WIDTH = 600;  // downscaled still PNG width

/**
 * THE capture segments — derived from the canonical folder-discovered manifest
 * (scripts/lib/effects.mjs), so the reel/media list can never drift from the set
 * of effects on disk. `mood`/`intensity`/`whimsy` drive the capture; `still` is
 * the life FRACTION (0..1) for the README PNG; `loop` marks a CONTINUOUS effect
 * (halo, dots) — it still gets a gif/png (one period) but is left OUT of the
 * stitched suite reel (a looper has no natural end to sequence).
 */
export const EFFECTS = discoverEffects(ROOT).map((e) => ({
  name: e.slug,
  mood: e.mood,
  intensity: e.intensity,
  whimsy: e.whimsy,
  still: e.still,
  loop: e.loop,
}));

/** Look up an effect's capture config by name. */
export const effectByName = (name) => EFFECTS.find((e) => e.name === name);

/**
 * The stitched suite reel: the one-shot effects in manifest order (loopers have
 * no natural end to sequence, so they're excluded from the concatenated reel —
 * they still get a gif/png from the same manifest).
 */
export const REEL = EFFECTS.filter((e) => !e.loop);

/**
 * Resolve the ffmpeg binary. Prefer `$FFMPEG_PATH`, then the bundled
 * `ffmpeg-static` (an OPTIONAL dep — its install downloads a binary from GitHub
 * releases, which sometimes 504s), then the system `ffmpeg` on PATH (present on
 * the CI runners). So a flaky/unavailable ffmpeg-static download no longer blocks
 * the capture.
 */
function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const p = require("ffmpeg-static");
    if (p) return p;
  } catch { /* optional dep absent — fall through to system ffmpeg */ }
  return "ffmpeg";
}

export function ffmpeg(args) {
  const bin = ffmpegBin();
  return new Promise((res, reject) => {
    const p = spawn(bin, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? res() : reject(new Error(`ffmpeg exited ${c}`))));
  });
}

/** Encode a frame dir → an h264 mp4 (the smooth per-effect clip). */
export async function encodeClip(framesDir, outPath) {
  await ffmpeg([
    "-y", "-framerate", String(FPS), "-i", join(framesDir, "f_%05d.png"),
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
  ]);
}

/**
 * Encode a frame dir → a downscaled, palette-optimized, infinitely-looping GIF.
 * The `fps` filter resamples the FPS-rate frames down to GIF_FPS, so the GIF is
 * derived from the SAME frames as the mp4 (one render pass, two formats).
 */
export async function encodeGif(framesDir, outPath) {
  await ffmpeg([
    "-y", "-framerate", String(FPS), "-i", join(framesDir, "f_%05d.png"),
    "-vf",
    `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];`
      + `[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
    "-loop", "0", outPath,
  ]);
}

/** Downscale a single captured frame → the still PNG (the gallery screenshot). */
export async function encodeStill(framePath, outPath) {
  await ffmpeg(["-y", "-i", framePath, "-vf", `scale=${PNG_WIDTH}:-1:flags=lanczos`, outPath]);
}

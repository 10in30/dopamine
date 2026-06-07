/**
 * Shared config + helpers for the per-effect render → stitch pipeline.
 *
 * Each effect renders to its OWN cached clip (`e2e/output/clips/<name>.mp4`) via
 * `render-clips.mjs`; `stitch.mjs` concatenates the clips (in REEL order) into
 * `e2e/output/dopamine-suite.mp4`. Decoupling them means adding/changing one
 * effect only re-renders that one clip — the rest are reused — then re-stitch.
 *
 * Frame-perfect fixed-timestep capture (see the offline renderer): each frame is
 * computed at an explicit time and screenshotted, so the result is smooth
 * regardless of software-WebGL speed.
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, rm } from "node:fs/promises";

const require = createRequire(import.meta.url);

// scripts/lib/reel.mjs → up three = the `dopamine/` package root.
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const DEMO_DIR = join(ROOT, "examples", "demo");
export const OUT_DIR = join(ROOT, "e2e", "output");
export const CLIPS_DIR = join(OUT_DIR, "clips");

export const FPS = 30;
export const TAIL = 16; // hold frames so the fade resolves
export const VIEWPORT = { width: 1100, height: 720 };
export const CHROMIUM_ARGS = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--enable-webgl",
];

/**
 * The reel: ordered segments, one per effect. `mood` uses the demo's
 * success-mood toggle names (the demo maps them onto each effect's own
 * registers, e.g. fail: electric → denied). ADD NEW EFFECTS HERE as they land.
 */
export const REEL = [
  { name: "solarbloom", mood: "celebratory", intensity: 0.85, whimsy: 0.35 },
  { name: "inkstroke", mood: "celebratory", intensity: 0.85, whimsy: 0.45 },
  { name: "comic", mood: "celebratory", intensity: 0.85, whimsy: 0.5 },
  { name: "fail", mood: "electric", intensity: 0.9, whimsy: 0.4 },
  // --- new effects (uncomment as each is integrated + wired into the demo) ---
  // { name: "aurora",     mood: "serene",      intensity: 0.85, whimsy: 0.4 },
  // { name: "ripple",     mood: "celebratory", intensity: 0.85, whimsy: 0.4 },
  // { name: "confetti",   mood: "celebratory", intensity: 0.9,  whimsy: 0.4 },
  // { name: "heartburst", mood: "celebratory", intensity: 0.85, whimsy: 0.4 },
  // { name: "lightning",  mood: "electric",    intensity: 0.95, whimsy: 0.4 },
];

export function ffmpeg(args) {
  const bin = require("ffmpeg-static");
  return new Promise((res, reject) => {
    const p = spawn(bin, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? res() : reject(new Error(`ffmpeg exited ${c}`))));
  });
}

/** Encode a frame dir → an h264 mp4. */
export async function encodeClip(framesDir, outPath) {
  await ffmpeg([
    "-y", "-framerate", String(FPS), "-i", join(framesDir, "f_%05d.png"),
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
  ]);
}

/**
 * Render one segment to `clips/<name>.mp4` using an already-open Playwright page
 * with the demo loaded + ready. Returns the clip path.
 */
export async function renderClip(page, seg) {
  await mkdir(CLIPS_DIR, { recursive: true });
  const framesDir = join(CLIPS_DIR, `_frames-${seg.name}`);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const durationMs = await page.evaluate((s) => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      if (el) { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }
    };
    set("#whimsy", s.whimsy);
    set("#intensity", s.intensity);
    document.querySelector(`button[data-mood="${s.mood}"]`)?.click();
    document.querySelector(`button[data-effect="${s.name}"]`)?.click();
    window.__cap = window.__dopamine.prepare({
      effect: s.name, mood: s.mood, intensity: s.intensity, whimsy: s.whimsy,
    });
    if (!window.__cap) throw new Error(`prepare returned null for effect "${s.name}" (registered + in the demo?)`);
    return window.__cap.durationMs;
  }, seg);

  const n = Math.ceil((durationMs / 1000) * FPS) + TAIL;
  for (let i = 0; i < n; i++) {
    const t = (i / FPS) * 1000;
    await page.evaluate(
      (ms) => new Promise((r) => {
        requestAnimationFrame(() => { window.__cap.renderAt(ms); requestAnimationFrame(() => r()); });
      }),
      t,
    );
    await page.screenshot({ path: join(framesDir, `f_${String(i).padStart(5, "0")}.png`) });
  }
  await page.evaluate(() => { window.__cap.dispose(); window.__cap = null; });

  const clip = join(CLIPS_DIR, `${seg.name}.mp4`);
  await encodeClip(framesDir, clip);
  await rm(framesDir, { recursive: true, force: true });
  return clip;
}

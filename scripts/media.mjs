/**
 * Render README media: for each effect, a still PNG (screenshot) + a downscaled,
 * palette-optimized looping GIF (the inline "demo video"), into docs/media/.
 *
 *   node scripts/media.mjs            # all effects below
 *   node scripts/media.mjs comic fail # only these
 *
 * Reuses the demo's headless capture API (window.__dopamine.prepare/renderAt) +
 * the shared SwiftShader Chromium args, exactly like the reel pipeline. ffmpeg
 * (bundled ffmpeg-static or system) encodes the GIF.
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { DEMO_DIR, ROOT, CHROMIUM_ARGS } from "./lib/reel.mjs";

const require = createRequire(import.meta.url);
const MEDIA_DIR = join(ROOT, "docs", "media");
const VIEWPORT = { width: 760, height: 500 };
const GIF_FPS = 11;        // playback rate of the looping GIF
const GIF_FRAMES = 28;     // frames sampled evenly across the effect's life
const GIF_WIDTH = 400;     // downscaled GIF width (keeps the files small)
const PNG_WIDTH = 600;     // downscaled still PNG width

// Per-effect capture config. `still` is the life FRACTION (0..1) for the PNG —
// tuned to each effect's most photogenic moment.
const EFFECTS = [
  { name: "solarbloom", mood: "celebratory", intensity: 0.85, whimsy: 0.35, still: 0.32 },
  { name: "aurora", mood: "serene", intensity: 0.85, whimsy: 0.4, still: 0.5 },
  { name: "comic", mood: "celebratory", intensity: 0.85, whimsy: 0.5, still: 0.3 },
  { name: "confetti", mood: "celebratory", intensity: 0.9, whimsy: 0.4, still: 0.4 },
  { name: "fail", mood: "electric", intensity: 0.9, whimsy: 0.4, still: 0.45 },
  { name: "heartburst", mood: "celebratory", intensity: 0.85, whimsy: 0.4, still: 0.32 },
  { name: "inkstroke", mood: "celebratory", intensity: 0.85, whimsy: 0.45, still: 0.6 },
  { name: "lightning", mood: "electric", intensity: 0.95, whimsy: 0.4, still: 0.3 },
  { name: "ripple", mood: "celebratory", intensity: 0.85, whimsy: 0.4, still: 0.4 },
  { name: "halo", mood: "serene", intensity: 0.8, whimsy: 0.45, still: 0.5 },
  { name: "dots", mood: "celebratory", intensity: 0.8, whimsy: 0.4, still: 0.5 },
];

function ffmpegBin() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { const p = require("ffmpeg-static"); if (p) return p; } catch { /* fall through */ }
  return "ffmpeg";
}
function ffmpeg(args) {
  return new Promise((res, reject) => {
    const p = spawn(ffmpegBin(), args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? res() : reject(new Error(`ffmpeg exited ${c}`))));
  });
}

const only = process.argv.slice(2);
const targets = only.length ? EFFECTS.filter((e) => only.includes(e.name)) : EFFECTS;

await mkdir(MEDIA_DIR, { recursive: true });
console.log("• building demo…");
await build({ root: DEMO_DIR, logLevel: "warn" });
const server = await preview({ root: DEMO_DIR, preview: { port: 5240, strictPort: false } });
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error("preview server did not report a URL");

let browser;
try {
  browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("  page error:", e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.documentElement.dataset.dopamineReady === "true",
    { timeout: 30000 },
  );

  for (const eff of targets) {
    process.stdout.write(`• ${eff.name} … `);
    const durationMs = await page.evaluate((s) => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        if (el) { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }
      };
      set("#whimsy", s.whimsy);
      set("#intensity", s.intensity);
      document.querySelector(`button[data-mood="${s.mood}"]`)?.click();
      document.querySelector(`button[data-effect="${s.name}"]`)?.click();
      // The demo's prepare() keys the effect off `effect` (NOT `name`).
      window.__cap = window.__dopamine.prepare({
        effect: s.name, mood: s.mood, intensity: s.intensity, whimsy: s.whimsy,
      });
      return window.__cap ? window.__cap.durationMs : null;
    }, eff);
    if (!durationMs) { console.log("✗ not preparable — skipped"); continue; }

    const framesDir = join(MEDIA_DIR, `_frames-${eff.name}`);
    await rm(framesDir, { recursive: true, force: true });
    await mkdir(framesDir, { recursive: true });

    const stillFrame = Math.round(eff.still * (GIF_FRAMES - 1));
    for (let i = 0; i < GIF_FRAMES; i++) {
      const t = (i / (GIF_FRAMES - 1)) * durationMs;
      await page.evaluate(
        (ms) => new Promise((r) => {
          requestAnimationFrame(() => { window.__cap.renderAt(ms); requestAnimationFrame(() => r()); });
        }),
        t,
      );
      const frame = join(framesDir, `f_${String(i).padStart(5, "0")}.png`);
      await page.screenshot({ path: frame });
      if (i === stillFrame) {
        // Downscaled still PNG (the "screenshot") — keeps the gallery files small.
        await ffmpeg(["-y", "-i", frame, "-vf", `scale=${PNG_WIDTH}:-1:flags=lanczos`, join(MEDIA_DIR, `${eff.name}.png`)]);
      }
    }
    await page.evaluate(() => { window.__cap.dispose(); window.__cap = null; });

    // Frames → palette-optimized, downscaled, infinitely-looping GIF.
    await ffmpeg([
      "-y", "-framerate", String(GIF_FPS), "-i", join(framesDir, "f_%05d.png"),
      "-vf", `scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
      "-loop", "0", join(MEDIA_DIR, `${eff.name}.gif`),
    ]);
    await rm(framesDir, { recursive: true, force: true });
    console.log("✓ png + gif");
  }
} finally {
  if (browser) await browser.close();
  await new Promise((res) => server.httpServer.close(res));
}

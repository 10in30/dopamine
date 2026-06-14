/**
 * The UNIFIED capture pass: render each effect ONCE in headless Chromium
 * (WebGL via SwiftShader) and emit every requested format from the same frames —
 * the smooth mp4 reel clip, the README looping GIF, and the README still PNG.
 *
 * One browser, one render per effect, driven by the shared manifest in reel.mjs.
 * `render-clips.mjs` (the reel) and `media.mjs` (README assets) are thin wrappers
 * over `runCapture`, so the effect list + encoders never drift between them.
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import {
  EFFECTS, effectByName, DEMO_DIR, CLIPS_DIR, MEDIA_DIR, FPS, TAIL, VIEWPORT,
  CHROMIUM_ARGS, encodeClip, encodeGif, encodeStill,
} from "./reel.mjs";

/**
 * Capture one effect with an already-open, demo-loaded Playwright page, emitting
 * the requested formats from a single render pass. Returns the written paths.
 */
export async function captureEffect(page, seg, formats = {}) {
  const { mp4 = true, gif = true, png = true } = formats;
  await mkdir(CLIPS_DIR, { recursive: true });
  await mkdir(MEDIA_DIR, { recursive: true });
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

  // FAST TEST MODE: `REEL_FRAMES=N` renders just N frames evenly spaced across
  // the effect's life — enough to validate each effect renders without producing
  // the full ~FPS×duration frame count. Unset = the real capture (FPS sampling).
  const fast = Number(process.env.REEL_FRAMES) || 0;
  // A looper has no fade tail to hold; one-shots hold TAIL frames so the fade resolves.
  const fullN = Math.ceil((durationMs / 1000) * FPS) + (seg.loop ? 0 : TAIL);
  const n = fast > 0 ? Math.min(fast, fullN) : fullN;
  const stillFrame = Math.round((seg.still ?? 0.4) * (n - 1));
  let stillPath = null;
  for (let i = 0; i < n; i++) {
    const t = fast > 0 ? (i / Math.max(n - 1, 1)) * durationMs : (i / FPS) * 1000;
    await page.evaluate(
      (ms) => new Promise((r) => {
        requestAnimationFrame(() => { window.__cap.renderAt(ms); requestAnimationFrame(() => r()); });
      }),
      t,
    );
    const frame = join(framesDir, `f_${String(i).padStart(5, "0")}.png`);
    await page.screenshot({ path: frame });
    if (i === stillFrame) stillPath = frame;
  }
  await page.evaluate(() => { window.__cap.dispose(); window.__cap = null; });

  const out = [];
  // Loopers aren't sequenced into the stitched suite, so they get gif/png only.
  if (mp4 && !seg.loop) { const p = join(CLIPS_DIR, `${seg.name}.mp4`); await encodeClip(framesDir, p); out.push(p); }
  if (gif) { const p = join(MEDIA_DIR, `${seg.name}.gif`); await encodeGif(framesDir, p); out.push(p); }
  if (png && stillPath) { const p = join(MEDIA_DIR, `${seg.name}.png`); await encodeStill(stillPath, p); out.push(p); }

  await rm(framesDir, { recursive: true, force: true });
  return out;
}

/**
 * Build the demo, open one browser, and capture the named effects (default: all
 * in the manifest) in the requested formats. Shared by render-clips.mjs + media.mjs.
 */
export async function runCapture({ names = [], formats = {} } = {}) {
  for (const n of names) {
    if (!effectByName(n)) console.warn(`! "${n}" is not in the manifest (scripts/lib/reel.mjs)`);
  }
  const segs = names.length ? EFFECTS.filter((e) => names.includes(e.name)) : EFFECTS;
  if (!segs.length) {
    console.error("nothing to capture");
    process.exitCode = 1;
    return [];
  }

  console.log("• building demo…");
  await build({ root: DEMO_DIR, logLevel: "warn" });
  const server = await preview({ root: DEMO_DIR, preview: { port: 5230, strictPort: false } });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("preview server did not report a URL");

  const written = [];
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
    for (const seg of segs) {
      process.stdout.write(`• ${seg.name} … `);
      const paths = await captureEffect(page, seg, formats);
      console.log(`✓ ${paths.map((p) => p.split("/").pop()).join(" + ")}`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
  return written;
}

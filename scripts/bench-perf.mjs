/**
 * Throwaway perf probe: measures mean ms/frame for selected effects under the
 * SAME SwiftShader (software-GL) path the reel uses — the worst case that
 * surfaces heavy per-fragment shader cost. Forces GPU completion each frame by
 * reading back a pixel from every live canvas so the timing reflects real draw
 * work, not just queue submission.
 *
 *   node scripts/bench-perf.mjs                 # default set
 *   node scripts/bench-perf.mjs lightning ripple
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { DEMO_DIR, VIEWPORT, CHROMIUM_ARGS } from "./lib/reel.mjs";

const WARMUP = 20;
const FRAMES = 150;
const SET = process.argv.slice(2);
const EFFECTS = SET.length
  ? SET
  : ["ripple", "confetti", "solarbloom", "lightning"];

// effect → demo mood (mirrors REEL).
const MOOD = {
  ripple: "celebratory", confetti: "celebratory",
  solarbloom: "celebratory", lightning: "electric",
  aurora: "serene", heartburst: "celebratory",
};

console.log("• building demo…");
await build({ root: DEMO_DIR, logLevel: "warn" });
const server = await preview({ root: DEMO_DIR, preview: { port: 5231, strictPort: false } });
const url = server.resolvedUrls?.local?.[0];

let browser;
try {
  browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("  page error:", e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.dopamineReady === "true", { timeout: 30000 });

  for (const name of EFFECTS) {
    const mood = MOOD[name] ?? "celebratory";
    const res = await page.evaluate(async ({ name, mood, WARMUP, FRAMES }) => {
      // Force every live webgl2 canvas to finish its queue (readPixels stalls
      // until the GPU/software backend has actually drawn the frame).
      const flush = () => {
        for (const c of document.querySelectorAll("canvas")) {
          const gl = c.getContext("webgl2");
          if (gl) { const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
        }
      };
      const cap = window.__dopamine.prepare({ effect: name, mood, intensity: 0.9, whimsy: 0.4 });
      if (!cap) return { error: `prepare null for ${name}` };
      const dur = cap.durationMs;
      const step = dur / 60; // sweep across the effect's life
      for (let i = 0; i < WARMUP; i++) { cap.renderAt((i * step) % dur); flush(); }
      const t0 = performance.now();
      for (let i = 0; i < FRAMES; i++) { cap.renderAt((i * step) % dur); flush(); }
      const elapsed = performance.now() - t0;
      cap.dispose();
      return { perFrameMs: elapsed / FRAMES, durationMs: dur };
    }, { name, mood, WARMUP, FRAMES });
    if (res.error) { console.log(`  ${name.padEnd(12)} ERROR ${res.error}`); continue; }
    console.log(`  ${name.padEnd(12)} ${res.perFrameMs.toFixed(2)} ms/frame`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

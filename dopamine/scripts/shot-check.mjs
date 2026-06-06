/**
 * Validation: Solarbloom checkmark GLYPH across whimsy 0 / 0.5 / 1.
 * Captures a fully-drawn peak frame and a mid-draw frame, CLIPPED to a box
 * around the bloom origin, to confirm the checkmark is a font glyph whose SHAPE
 * changes with whimsy and draws itself.
 * Usage: node scripts/shot-check.mjs
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demoDir = join(root, "examples", "demo");
const outDir = join(root, "e2e", "output");
const VIEWPORT = { width: 1100, height: 720 };

const CHROMIUM_ARGS = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--enable-webgl",
];

const SHOTS = [
  { whimsy: 0.0, ms: 320, tag: "w0-peak" },
  { whimsy: 0.5, ms: 320, tag: "w50-peak" },
  { whimsy: 1.0, ms: 320, tag: "w100-peak" },
  { whimsy: 0.0, ms: 110, tag: "w0-mid" },
  { whimsy: 1.0, ms: 110, tag: "w100-mid" },
];

async function main() {
  await mkdir(outDir, { recursive: true });
  await build({ root: demoDir, logLevel: "warn" });
  const server = await preview({ root: demoDir, preview: { port: 5194, strictPort: false } });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("no preview url");
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("  page error:", e.message));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      () => document.documentElement.dataset.dopamineReady === "true",
      { timeout: 15000 },
    );
    // Locate the fire button = bloom origin, build a clip box around it.
    const r = await page.evaluate(() => {
      const b = document.querySelector("#fire");
      const rc = b.getBoundingClientRect();
      return { cx: rc.left + rc.width / 2, cy: rc.top + rc.height / 2 };
    });
    const HALF = 200;
    const clip = {
      x: Math.max(0, r.cx - HALF), y: Math.max(0, r.cy - HALF),
      width: HALF * 2, height: HALF * 2,
    };
    for (const s of SHOTS) {
      await page.evaluate((c) => {
        window.__cap = window.__dopamine.prepare(c);
      }, { mood: "celebratory", intensity: 0.85, whimsy: s.whimsy, effect: "solarbloom", seed: 7 });
      await page.evaluate(
        (ms) => new Promise((resolve) => {
          requestAnimationFrame(() => { window.__cap.renderAt(ms); requestAnimationFrame(() => resolve()); });
        }), s.ms);
      const out = join(outDir, `solarbloom-check-${s.tag}.png`);
      await page.screenshot({ path: out, clip });
      await page.evaluate(() => { window.__cap.dispose(); window.__cap = null; });
      console.log(`wrote ${out}`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

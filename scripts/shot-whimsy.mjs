/**
 * Whimsy-axis validation: capture the SAME mood at whimsy 0 and 1 to show the
 * photoreal-ink ↔ cel/neon stylization axis. Usage: node scripts/shot-whimsy.mjs [ms]
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
const peakMs = Number(process.argv[2] ?? 430);

const CONFIGS = [
  { mood: "serene", intensity: 0.75, whimsy: 0.0, tag: "serene-w0" },
  { mood: "serene", intensity: 0.75, whimsy: 1.0, tag: "serene-w1" },
  { mood: "celebratory", intensity: 0.85, whimsy: 0.0, tag: "celebratory-w0" },
  { mood: "celebratory", intensity: 0.85, whimsy: 1.0, tag: "celebratory-w1" },
  { mood: "electric", intensity: 0.95, whimsy: 0.0, tag: "electric-w0" },
  { mood: "electric", intensity: 0.95, whimsy: 1.0, tag: "electric-w1" },
];

const CHROMIUM_ARGS = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--enable-webgl",
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
      () => document.documentElement.dataset.dopamineReady === "true", { timeout: 15000 });
    for (const cfg of CONFIGS) {
      await page.evaluate((c) => { window.__cap = window.__dopamine.prepare(c); }, cfg);
      await page.evaluate((ms) => new Promise((resolve) => {
        requestAnimationFrame(() => { window.__cap.renderAt(ms); requestAnimationFrame(() => resolve()); });
      }), peakMs);
      const out = join(outDir, `ink-${cfg.tag}.png`);
      await page.screenshot({ path: out });
      await page.evaluate(() => { window.__cap.dispose(); window.__cap = null; });
      console.log(`✓ ${out}`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

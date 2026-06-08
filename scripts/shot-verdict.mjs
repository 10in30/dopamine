/**
 * Verdict checkmark validation shots. Captures mid-draw + settled for
 * celebratory, plus one settled each for serene/electric, at low + high whimsy.
 * Usage: node scripts/shot-verdict.mjs
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

// effect, mood, intensity, whimsy, ms, label
const SHOTS = [
  ["inkstroke", "celebratory", 0.85, 0.15, 170, "celebratory-w15-mid"],
  ["inkstroke", "celebratory", 0.85, 0.15, 900, "celebratory-w15-settled"],
  ["inkstroke", "celebratory", 0.85, 0.9, 170, "celebratory-w90-mid"],
  ["inkstroke", "celebratory", 0.85, 0.9, 900, "celebratory-w90-settled"],
  ["inkstroke", "serene", 0.7, 0.15, 1000, "serene-w15-settled"],
  ["inkstroke", "serene", 0.7, 0.9, 1000, "serene-w90-settled"],
  ["inkstroke", "electric", 0.95, 0.15, 700, "electric-w15-settled"],
  ["inkstroke", "electric", 0.95, 0.9, 700, "electric-w90-settled"],
];

const CHROMIUM_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--enable-webgl",
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

    for (const [effect, mood, intensity, whimsy, ms, label] of SHOTS) {
      await page.evaluate((c) => {
        window.__cap = window.__dopamine.prepare(c);
      }, { effect, mood, intensity, whimsy, seed: 42 });
      await page.evaluate(
        (ms) =>
          new Promise((resolve) => {
            requestAnimationFrame(() => {
              window.__cap.renderAt(ms);
              requestAnimationFrame(() => resolve());
            });
          }),
        ms,
      );
      const out = join(outDir, `verdict-${label}.png`);
      await page.screenshot({ path: out });
      await page.evaluate(() => {
        window.__cap.dispose();
        window.__cap = null;
      });
      console.log(`OK ${out}`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

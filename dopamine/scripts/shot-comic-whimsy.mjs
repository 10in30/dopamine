/**
 * Comic Impact whimsy-axis validation: one mood, fixed seed, four whimsy steps
 * (noir 0 → pop-art 1), one settled frame each. Confirms the NOIR ↔ POP-ART
 * interpolation is continuous. Usage: node scripts/shot-comic-whimsy.mjs [peakMs]
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
const peakMs = Number(process.argv[2] ?? 340);

const STEPS = [0.0, 0.33, 0.66, 1.0];
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
    for (const whimsy of STEPS) {
      const cfg = { mood: "celebratory", intensity: 0.85, whimsy, effect: "comic", seed: 1337 };
      await page.evaluate((c) => {
        window.__cap = window.__dopamine.prepare(c);
      }, cfg);
      await page.evaluate(
        (ms) =>
          new Promise((resolve) => {
            requestAnimationFrame(() => {
              window.__cap.renderAt(ms);
              requestAnimationFrame(() => resolve());
            });
          }),
        peakMs,
      );
      const tag = String(Math.round(whimsy * 100)).padStart(3, "0");
      const out = join(outDir, `shot-comic-whimsy-${tag}.png`);
      await page.screenshot({ path: out });
      await page.evaluate(() => {
        window.__cap.dispose();
        window.__cap = null;
      });
      console.log(`✓ ${out}`);
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

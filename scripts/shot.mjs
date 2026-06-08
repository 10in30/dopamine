/**
 * Single-frame validation screenshot. Builds the demo, previews it, and for each
 * mood renders one peak frame (default 320 ms) inside a double-rAF then screenshots.
 * Usage: node scripts/shot.mjs [peakMs] [suffix]
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

const peakMs = Number(process.argv[2] ?? 320);
const suffix = process.argv[3] ?? "";
// Optional 4th arg / DOPAMINE_EFFECT env selects the effect for every shot.
const effect = process.argv[4] ?? process.env.DOPAMINE_EFFECT ?? undefined;

const MOODS = [
  { mood: "celebratory", intensity: 0.85, whimsy: 0.6 },
  { mood: "electric", intensity: 0.95, whimsy: 0.85 },
  { mood: "serene", intensity: 0.7, whimsy: 0.4 },
].map((c) => (effect ? { ...c, effect } : c));

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
  const server = await preview({ root: demoDir, preview: { port: 5193, strictPort: false } });
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

    for (const cfg of MOODS) {
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
      const out = join(outDir, `shot-${cfg.mood}${suffix}.png`);
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

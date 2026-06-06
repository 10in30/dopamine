/**
 * Phase 0 validation: render the FAIL effect across its OWN moods
 * (try-again / error / denied) — the moods the resolve bug broke.
 * Usage: node scripts/shot-fail.mjs [peakMs]
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
const peakMs = Number(process.argv[2] ?? 180);

// The demo maps the shared success-mood toggle onto the fail moods
// (serene→try-again, celebratory→error, electric→denied), so driving the demo
// `prepare` with these success moods exercises the fail effect across ALL THREE
// of its own moods — the resolve path the Phase 0 bug broke.
const SHOTS = [
  { effect: "fail", mood: "serene", intensity: 0.6, whimsy: 0.3, seed: 7, label: "try-again" },
  { effect: "fail", mood: "celebratory", intensity: 0.8, whimsy: 0.3, seed: 7, label: "error" },
  { effect: "fail", mood: "electric", intensity: 0.95, whimsy: 0.3, seed: 7, label: "denied" },
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

    for (const cfg of SHOTS) {
      const err = await page.evaluate((c) => {
        try {
          window.__cap = window.__dopamine.prepare(c);
          return null;
        } catch (e) {
          return String(e && e.message ? e.message : e);
        }
      }, cfg);
      if (err) {
        console.error(`✗ prepare threw for ${cfg.mood}: ${err}`);
        process.exitCode = 1;
        continue;
      }
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
      const out = join(outDir, `shot-fail-${cfg.label}.png`);
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

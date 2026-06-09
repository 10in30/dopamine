/**
 * Throwaway: capture a single mid-effect frame of an effect to a PNG so we can
 * eyeball the look. Uses the same SwiftShader path as the reel.
 *   node scripts/capture-frame.mjs lightning 0.45 /tmp/lightning.png
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { DEMO_DIR, VIEWPORT, CHROMIUM_ARGS } from "./lib/reel.mjs";

const name = process.argv[2] ?? "lightning";
const lifeFrac = parseFloat(process.argv[3] ?? "0.45");
const out = process.argv[4] ?? `/tmp/${name}.png`;
const mood = process.argv[5] ?? (name === "lightning" ? "electric" : "celebratory");

await build({ root: DEMO_DIR, logLevel: "warn" });
const server = await preview({ root: DEMO_DIR, preview: { port: 5232, strictPort: false } });
const url = server.resolvedUrls?.local?.[0];
let browser;
try {
  browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.dataset.dopamineReady === "true", { timeout: 30000 });
  await page.evaluate(({ name, mood, lifeFrac }) => {
    const cap = window.__dopamine.prepare({ effect: name, mood, intensity: 0.9, whimsy: 0.35 });
    window.__cap = cap;
    cap.renderAt(cap.durationMs * lifeFrac);
  }, { name, mood, lifeFrac });
  await page.screenshot({ path: out });
  console.log("wrote", out);
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

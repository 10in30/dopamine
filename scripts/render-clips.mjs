/**
 * Render per-effect clips into e2e/output/clips/<name>.mp4 (one reusable browser).
 *
 *   node scripts/render-clips.mjs            # render every effect in the REEL
 *   node scripts/render-clips.mjs fail aurora  # render only these (incremental)
 *
 * Then `node scripts/stitch.mjs` concatenates the clips into the suite reel.
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { REEL, DEMO_DIR, VIEWPORT, CHROMIUM_ARGS, renderClip } from "./lib/reel.mjs";

const only = process.argv.slice(2);
for (const n of only) {
  if (!REEL.some((s) => s.name === n)) console.warn(`! "${n}" is not in the REEL (scripts/lib/reel.mjs)`);
}
const segs = only.length ? REEL.filter((s) => only.includes(s.name)) : REEL;
if (!segs.length) {
  console.error("nothing to render");
  process.exit(1);
}

console.log("• building demo…");
await build({ root: DEMO_DIR, logLevel: "warn" });
const server = await preview({ root: DEMO_DIR, preview: { port: 5230, strictPort: false } });
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
  for (const seg of segs) {
    process.stdout.write(`• ${seg.name} … `);
    const clip = await renderClip(page, seg);
    console.log(`✓ ${clip}`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise((res) => server.httpServer.close(res));
}

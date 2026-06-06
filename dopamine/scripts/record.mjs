/**
 * Build the demo, serve it, and record Solarbloom firing across all three moods
 * into e2e/output/solarbloom.webm — entirely headless, no GPU required.
 *
 * WebGL is forced through SwiftShader (software) so this runs in a plain Linux
 * container. Visuals are faithful; framerate may trail real hardware.
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, rename, rm, readdir } from "node:fs/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demoDir = join(root, "examples", "demo");
const outDir = join(root, "e2e", "output");
const VIEWPORT = { width: 1100, height: 720 };

const CHROMIUM_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--enable-webgl",
];

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  console.log("• building demo…");
  await build({ root: demoDir, logLevel: "warn" });

  console.log("• starting preview server…");
  const server = await preview({ root: demoDir, preview: { port: 5191, strictPort: false } });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("preview server did not report a URL");
  console.log(`  ${url}`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      recordVideo: { dir: outDir, size: VIEWPORT },
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => console.error("  page error:", err.message));

    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      () => document.documentElement.dataset.dopamineReady === "true",
      { timeout: 15000 },
    );

    const hasWebGL2 = await page.evaluate(
      () => !!document.createElement("canvas").getContext("webgl2"),
    );
    if (!hasWebGL2) throw new Error("WebGL2 unavailable in headless Chromium");
    console.log("• WebGL2 OK — recording…");

    // Fire without awaiting the returned promise (page.evaluate would otherwise
    // block for the whole animation); we pace the recording with explicit waits.
    const fire = (opts) =>
      page.evaluate((o) => {
        window.__dopamine.fire(o);
      }, opts);

    await page.waitForTimeout(400);
    await fire({ mood: "celebratory", intensity: 0.85, whimsy: 0.6 });
    await page.waitForTimeout(2100);
    await fire({ mood: "electric", intensity: 0.95, whimsy: 0.85 });
    await page.waitForTimeout(1500);
    await fire({ mood: "serene", intensity: 0.7, whimsy: 0.4 });
    await page.waitForTimeout(2900);

    const video = page.video();
    await context.close(); // flush video to disk
    if (video) {
      const tmp = await video.path();
      await rename(tmp, join(outDir, "solarbloom.webm"));
    } else {
      const files = await readdir(outDir);
      const webm = files.find((f) => f.endsWith(".webm"));
      if (webm) await rename(join(outDir, webm), join(outDir, "solarbloom.webm"));
    }
    console.log(`✓ saved ${join(outDir, "solarbloom.webm")}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

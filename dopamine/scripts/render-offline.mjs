/**
 * Frame-perfect offline render. Drives the effect by an explicit fixed timestep
 * (not the wall clock), screenshots each frame, and muxes to a true 60fps video.
 *
 * Because we wait for each frame to finish computing before capturing it, the
 * output is buttery-smooth and pixel-identical to GPU hardware — only the
 * wall-clock time to PRODUCE it differs. This is how we judge the look without
 * a GPU. (Real-time perf is a separate question; see scripts/record.mjs.)
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demoDir = join(root, "examples", "demo");
const outDir = join(root, "e2e", "output");
const VIEWPORT = { width: 1100, height: 720 };
const FPS = 60;
const TAIL_FRAMES = 14; // hold past the end so the fade fully resolves

const MOODS = [
  { mood: "celebratory", intensity: 0.85, whimsy: 0.6 },
  { mood: "electric", intensity: 0.95, whimsy: 0.85 },
  { mood: "serene", intensity: 0.7, whimsy: 0.4 },
];

const CHROMIUM_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--enable-webgl",
];

function ffmpeg(args) {
  const bin = require("ffmpeg-static");
  return new Promise((res, reject) => {
    const proc = spawn(bin, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? res() : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  console.log("• building demo…");
  await build({ root: demoDir, logLevel: "warn" });
  const server = await preview({ root: demoDir, preview: { port: 5192, strictPort: false } });
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
      { timeout: 15000 },
    );
    if (!(await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2")))) {
      throw new Error("WebGL2 unavailable in headless Chromium");
    }

    const clips = [];
    for (const cfg of MOODS) {
      const framesDir = join(outDir, `frames-${cfg.mood}`);
      await mkdir(framesDir, { recursive: true });

      const durationMs = await page.evaluate((c) => {
        window.__cap = window.__dopamine.prepare(c);
        return window.__cap.durationMs;
      }, cfg);
      const frameCount = Math.ceil((durationMs / 1000) * FPS) + TAIL_FRAMES;
      process.stdout.write(`• ${cfg.mood}: ${frameCount} frames @ ${FPS}fps `);

      for (let i = 0; i < frameCount; i++) {
        const t = (i / FPS) * 1000;
        // Render inside RAF and wait one more RAF so the frame is committed
        // before we screenshot it.
        await page.evaluate(
          (ms) =>
            new Promise((resolve) => {
              requestAnimationFrame(() => {
                window.__cap.renderAt(ms);
                requestAnimationFrame(() => resolve());
              });
            }),
          t,
        );
        await page.screenshot({
          path: join(framesDir, `f_${String(i).padStart(5, "0")}.png`),
        });
        if (i % 25 === 0) process.stdout.write(".");
      }
      process.stdout.write(" done\n");
      await page.evaluate(() => {
        window.__cap.dispose();
        window.__cap = null;
      });

      const clip = join(outDir, `solarbloom-${cfg.mood}.mp4`);
      await ffmpeg([
        "-y", "-framerate", String(FPS),
        "-i", join(framesDir, "f_%05d.png"),
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", clip,
      ]);
      clips.push(clip);
      await rm(framesDir, { recursive: true, force: true });
      console.log(`  ✓ ${clip}`);
    }

    // Stitch the three clips into one montage.
    const listFile = join(outDir, "clips.txt");
    await writeFile(listFile, clips.map((c) => `file '${c}'`).join("\n"));
    const combined = join(outDir, "solarbloom-smooth.mp4");
    await ffmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", combined,
    ]);
    await rm(listFile, { force: true });
    console.log(`✓ saved ${combined}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

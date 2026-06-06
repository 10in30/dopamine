/**
 * Smooth 30fps render of the WHIMSY axis (photoreal → cel/hand-drawn).
 *
 * Plays the celebratory success at several whimsy levels and stitches them into
 * one montage so you can see the same effect morph from true volumetric light
 * into flat cel-shaded, neon, "animate on twos" hand-drawn style. The on-screen
 * Whimsy readout is set to match each segment, so the clip is self-labeling.
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
const FPS = 30;
const TAIL_FRAMES = 14;
const LEVELS = [0.0, 0.5, 1.0];
const MOOD = "celebratory";
const INTENSITY = 0.85;

const CHROMIUM_ARGS = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--enable-webgl",
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
  const server = await preview({ root: demoDir, preview: { port: 5197, strictPort: false } });
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

    const clips = [];
    for (const whimsy of LEVELS) {
      const framesDir = join(outDir, `frames-w${whimsy}`);
      await mkdir(framesDir, { recursive: true });

      // Reflect this level in the on-screen controls (self-labeling video).
      await page.evaluate(({ whimsy, intensity }) => {
        const set = (sel, v) => {
          const el = document.querySelector(sel);
          el.value = String(v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        set("#whimsy", whimsy);
        set("#intensity", intensity);
        document.querySelector('button[data-mood="celebratory"]').click();
      }, { whimsy, intensity: INTENSITY });

      const durationMs = await page.evaluate(
        (o) => {
          window.__cap = window.__dopamine.prepare(o);
          return window.__cap.durationMs;
        },
        { mood: MOOD, intensity: INTENSITY, whimsy },
      );
      const frameCount = Math.ceil((durationMs / 1000) * FPS) + TAIL_FRAMES;
      process.stdout.write(`• whimsy ${whimsy}: ${frameCount} frames `);

      for (let i = 0; i < frameCount; i++) {
        const t = (i / FPS) * 1000;
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
        await page.screenshot({ path: join(framesDir, `f_${String(i).padStart(5, "0")}.png`) });
        if (i % 25 === 0) process.stdout.write(".");
      }
      process.stdout.write(" done\n");
      await page.evaluate(() => {
        window.__cap.dispose();
        window.__cap = null;
      });

      const clip = join(outDir, `whimsy-${whimsy}.mp4`);
      await ffmpeg([
        "-y", "-framerate", String(FPS), "-i", join(framesDir, "f_%05d.png"),
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip,
      ]);
      clips.push(clip);
      await rm(framesDir, { recursive: true, force: true });
    }

    const listFile = join(outDir, "clips.txt");
    await writeFile(listFile, clips.map((c) => `file '${c}'`).join("\n"));
    const combined = join(outDir, "solarbloom-whimsy.mp4");
    await ffmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", combined,
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

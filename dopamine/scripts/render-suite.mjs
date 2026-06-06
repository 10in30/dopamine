/**
 * Render a montage of ALL three success effects over the depthy, shadow-casting
 * demo scene, at 30fps, into one mp4 (e2e/output/dopamine-suite.mp4).
 * Frame-perfect fixed-timestep capture (see render-offline.mjs) so it's smooth
 * regardless of software-WebGL speed. On-screen controls are set to match each
 * segment so the clip is self-labeling.
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
const TAIL = 16;

const SEGMENTS = [
  { effect: "solarbloom", mood: "celebratory", intensity: 0.85, whimsy: 0.35 },
  { effect: "inkstroke", mood: "celebratory", intensity: 0.85, whimsy: 0.45 },
  { effect: "comic", mood: "celebratory", intensity: 0.85, whimsy: 0.5 },
  // Fail: the demo maps the success-mood toggle → fail registers (electric → denied).
  { effect: "fail", mood: "electric", intensity: 0.9, whimsy: 0.4 },
];

const ARGS = [
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist", "--enable-webgl",
];

function ffmpeg(args) {
  const bin = require("ffmpeg-static");
  return new Promise((res, reject) => {
    const p = spawn(bin, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? res() : reject(new Error(`ffmpeg ${c}`))));
  });
}

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  console.log("• building demo…");
  await build({ root: demoDir, logLevel: "warn" });
  const server = await preview({ root: demoDir, preview: { port: 5204, strictPort: false } });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("no preview url");

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ARGS });
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("  page error:", e.message));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(
      () => document.documentElement.dataset.dopamineReady === "true",
      { timeout: 15000 },
    );

    const clips = [];
    for (let s = 0; s < SEGMENTS.length; s++) {
      const seg = SEGMENTS[s];
      const fdir = join(outDir, `suite-${s}`);
      await mkdir(fdir, { recursive: true });
      await page.evaluate((cfg) => {
        const set = (sel, v) => {
          const el = document.querySelector(sel);
          el.value = String(v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        set("#whimsy", cfg.whimsy);
        set("#intensity", cfg.intensity);
        document.querySelector(`button[data-mood="${cfg.mood}"]`).click();
        const ev = document.querySelector(`button[data-effect="${cfg.effect}"]`);
        if (ev) ev.click();
      }, seg);

      const dur = await page.evaluate((cfg) => {
        window.__cap = window.__dopamine.prepare(cfg);
        return window.__cap.durationMs;
      }, seg);
      const n = Math.ceil((dur / 1000) * FPS) + TAIL;
      process.stdout.write(`• ${seg.effect}: ${n} frames `);
      for (let i = 0; i < n; i++) {
        const t = (i / FPS) * 1000;
        await page.evaluate(
          (ms) =>
            new Promise((r) => {
              requestAnimationFrame(() => {
                window.__cap.renderAt(ms);
                requestAnimationFrame(() => r());
              });
            }),
          t,
        );
        await page.screenshot({ path: join(fdir, `f_${String(i).padStart(5, "0")}.png`) });
        if (i % 25 === 0) process.stdout.write(".");
      }
      process.stdout.write(" done\n");
      await page.evaluate(() => {
        window.__cap.dispose();
        window.__cap = null;
      });
      const clip = join(outDir, `suite-${seg.effect}.mp4`);
      await ffmpeg([
        "-y", "-framerate", String(FPS), "-i", join(fdir, "f_%05d.png"),
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip,
      ]);
      clips.push(clip);
      await rm(fdir, { recursive: true, force: true });
    }

    const lf = join(outDir, "suite.txt");
    await writeFile(lf, clips.map((c) => `file '${c}'`).join("\n"));
    const out = join(outDir, "dopamine-suite.mp4");
    await ffmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", lf,
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out,
    ]);
    await rm(lf, { force: true });
    console.log(`✓ saved ${out}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

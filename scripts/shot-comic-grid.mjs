/**
 * Comic Impact mood × whimsy validation grid. Captures one settled peak frame
 * for every mood × {whimsy 0 (noir), whimsy 1 (pop-art)} with a word seed, plus
 * a CHECKMARK tile, then montages them into one grid PNG.
 *
 * Usage: node scripts/shot-comic-grid.mjs [peakMs]
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const demoDir = join(root, "examples", "demo");
const outDir = join(root, "e2e", "output");
const VIEWPORT = { width: 720, height: 480 };
const peakMs = Number(process.argv[2] ?? 340);

const WORD_SEED = 1337; // -> "DONE!"
const CHECK_SEED = 4; //   -> checkmark
const MOODS = ["serene", "celebratory", "electric"];

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
  const server = await preview({ root: demoDir, preview: { port: 5195, strictPort: false } });
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error("no preview url");

  const tiles = [];
  // mood x whimsy {0,1} word tiles
  for (const mood of MOODS) {
    for (const whimsy of [0, 1]) {
      tiles.push({
        cfg: { mood, intensity: 0.85, whimsy, effect: "comic", seed: WORD_SEED },
        label: `${mood} · whimsy ${whimsy} · DONE!`,
        file: `shot-comic-grid-${mood}-w${whimsy}.png`,
      });
    }
  }
  // a checkmark tile (pop-art celebratory so the ✓ shows boldest)
  tiles.push({
    cfg: { mood: "celebratory", intensity: 0.85, whimsy: 1, effect: "comic", seed: CHECK_SEED },
    label: "celebratory · whimsy 1 · CHECKMARK",
    file: "shot-comic-grid-checkmark.png",
  });
  // and a noir checkmark so both whimsy ends of the ✓ are visible
  tiles.push({
    cfg: { mood: "electric", intensity: 0.85, whimsy: 0, effect: "comic", seed: CHECK_SEED },
    label: "electric · whimsy 0 · CHECKMARK",
    file: "shot-comic-grid-checkmark-noir.png",
  });

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

    for (const t of tiles) {
      await page.evaluate((c) => {
        window.__cap = window.__dopamine.prepare(c);
      }, t.cfg);
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
      t.path = join(outDir, t.file);
      await page.screenshot({ path: t.path });
      await page.evaluate(() => {
        window.__cap.dispose();
        window.__cap = null;
      });
      console.log(`✓ ${t.path}`);
    }

    // Montage all tiles into one labelled grid via an HTML page.
    const imgs = await Promise.all(
      tiles.map(async (t) => ({
        label: t.label,
        data: "data:image/png;base64," + (await readFile(t.path)).toString("base64"),
      })),
    );
    const cells = imgs
      .map(
        (im) =>
          `<figure><img src="${im.data}"/><figcaption>${im.label}</figcaption></figure>`,
      )
      .join("");
    const html = `<!doctype html><meta charset=utf8><style>
      body{margin:0;background:#111;font:14px/1.3 system-ui,sans-serif;color:#eee}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:12px}
      figure{margin:0;border:1px solid #333}
      img{display:block;width:100%}
      figcaption{padding:6px 8px;background:#1c1c1c}
    </style><div class=grid>${cells}</div>`;
    const gridHtml = join(outDir, "comic-grid.html");
    await writeFile(gridHtml, html);
    const gp = await browser.newPage({ viewport: { width: 1480, height: 1500 }, deviceScaleFactor: 1 });
    await gp.goto("file://" + gridHtml, { waitUntil: "load" });
    await gp.waitForTimeout(200);
    const gridPath = join(outDir, "shot-comic-grid.png");
    await gp.screenshot({ path: gridPath, fullPage: true });
    console.log(`✓ GRID ${gridPath}`);
  } finally {
    if (browser) await browser.close();
    await new Promise((res) => server.httpServer.close(res));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

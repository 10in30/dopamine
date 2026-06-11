/**
 * Golden mid-frame shader gate.
 *
 * Renders a representative middle-of-the-effect frame of each effect's canonical
 * GLSL through headless Chromium + SwiftShader (WebGL2 == GLSL ES 3.00, the exact
 * dialect ANDROID uses), and gates it against a committed golden PNG. Because the
 * web GLSL is the SINGLE SOURCE the Android (and, via the transpiler, the MSL)
 * shaders are generated from, a stable golden proves the shared shader body for
 * every platform — the pixel safety-net that lets the generated-shader work land.
 *
 * It also renders the LITERAL Android variant (the same body + `dopLightOut`, the
 * premultiplied light-out emit) and asserts its RGB matches the web byte-for-byte
 * (they share `max(col, 0)`), with alpha == the per-pixel max channel — so the
 * Android emit path is covered too, not just the shared body.
 *
 *   node scripts/shader-goldens.mjs              # CHECK against e2e/goldens/*.png
 *   node scripts/shader-goldens.mjs --update     # (re)write the goldens
 *   node scripts/shader-goldens.mjs aurora       # only these effects
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DEMO_DIR, VIEWPORT, CHROMIUM_ARGS, ROOT } from "./lib/reel.mjs";
import { loadShaderSources } from "./lib/shader-src.mjs";

const GOLDEN_DIR = join(ROOT, "e2e", "goldens");
const TOLERANCE = 4; // max per-channel delta (SwiftShader is near-deterministic)

// Representative fixtures: a fixed (mood, intensity, whimsy, seed, lifeFrac) so the
// frame is reproducible. lifeFrac 0.45 ≈ just past the envelope peak (the effect at
// its fullest), the most representative single frame.
const FIXTURES = {
  aurora: { mood: "serene", intensity: 0.85, whimsy: 0.4, seed: 12345, lifeFrac: 0.45 },
  ripple: { mood: "celebratory", intensity: 0.85, whimsy: 0.4, seed: 12345, lifeFrac: 0.45 },
};

/** Derive the Android fragment from the web GLSL: add dopLightOut + swap the emit. */
function toAndroid(frag) {
  const LIGHT_OUT =
    "\nvec4 dopLightOut(vec3 col){\n" +
    "  col = max(col, 0.0);\n" +
    "  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);\n" +
    "  return vec4(col, a);\n}\n";
  let f = frag.replace(/\nvoid main\(/, LIGHT_OUT + "\nvoid main(");
  f = f.replace("fragColor = vec4(max(col, 0.0), 1.0);", "fragColor = dopLightOut(col);");
  return f;
}

// ---- in-page: render one effect via the runtime, capture its uniform bag ----
async function captureUniforms({ effect, mood, intensity, whimsy, seed, lifeFrac }) {
  const cap = window.__dopamine.prepare({ effect, mood, intensity, whimsy, seed });
  if (!cap) throw new Error("prepare() returned null for " + effect);
  cap.renderAt(cap.durationMs * lifeFrac);
  let found = null;
  for (const c of document.querySelectorAll("canvas")) {
    const gl = c.getContext("webgl2");
    if (!gl) continue;
    const prog = gl.getParameter(gl.CURRENT_PROGRAM);
    if (prog) { found = { c, gl, prog }; break; }
  }
  if (!found) throw new Error("no webgl2 canvas with a current program for " + effect);
  const { c, gl, prog } = found;
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  const uniforms = [];
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const loc = gl.getUniformLocation(prog, info.name);
    if (!loc) continue;
    const v = gl.getUniform(prog, loc);
    uniforms.push({ name: info.name, type: info.type, value: v && v.length != null ? Array.from(v) : v });
  }
  return { uniforms, width: c.width, height: c.height };
}

// ---- in-page: render an arbitrary fragment string with a captured uniform bag ----
async function renderFrag({ vertex, fragment, uniforms, width, height, force }) {
  const cv = document.createElement("canvas");
  cv.width = width; cv.height = height;
  const gl = cv.getContext("webgl2", { preserveDrawingBuffer: true, alpha: false, premultipliedAlpha: false, antialias: false });
  if (!gl) throw new Error("no webgl2 for offscreen render");
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("compile: " + gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  for (const u of uniforms) {
    const loc = gl.getUniformLocation(prog, u.name);
    if (!loc) continue;
    if (u.type === gl.FLOAT) gl.uniform1f(loc, u.value);
    else if (u.type === gl.FLOAT_VEC2) gl.uniform2fv(loc, u.value);
    else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(loc, u.value);
    else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(loc, u.value);
    else if (u.type === gl.INT || u.type === gl.BOOL || u.type === gl.SAMPLER_2D) gl.uniform1i(loc, u.value);
  }
  // Force the LIGHT pass (the captured program may have been the shadow pass, whose
  // multiply layer is near-white) — the representative golden is the lit frame.
  for (const [name, val] of Object.entries(force ?? {})) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc) gl.uniform1f(loc, val);
  }
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // Top-down PNG (for goldens) via a 2D copy of the GL canvas.
  const cc = document.createElement("canvas"); cc.width = width; cc.height = height;
  cc.getContext("2d").drawImage(cv, 0, 0);
  return { dataURL: cc.toDataURL("image/png"), px: Array.from(px) };
}

// ---- in-page: decode a golden PNG and return its top-down RGBA ----
async function decodePng({ dataURL, width, height }) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataURL; });
  const cc = document.createElement("canvas"); cc.width = width; cc.height = height;
  const ctx = cc.getContext("2d"); ctx.drawImage(img, 0, 0);
  return Array.from(ctx.getImageData(0, 0, width, height).data);
}

function maxChannelDelta(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
}

// fresh GL readPixels is bottom-up; flip to top-down to compare with a decoded PNG.
function flipRows(px, width, height) {
  const row = width * 4;
  const out = new Array(px.length);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * row;
    for (let i = 0; i < row; i++) out[y * row + i] = px[src + i];
  }
  return out;
}

async function main() {
  const update = process.argv.includes("--update");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const slugs = (args.length ? args : Object.keys(FIXTURES)).filter((s) => FIXTURES[s]);
  if (!slugs.length) { console.error("no known effects to render"); process.exit(1); }
  mkdirSync(GOLDEN_DIR, { recursive: true });

  const sources = await loadShaderSources(slugs);
  console.log("• building demo…");
  await build({ root: DEMO_DIR, logLevel: "warn" });
  const server = await preview({ root: DEMO_DIR, preview: { port: 5233, strictPort: false } });
  const url = server.resolvedUrls?.local?.[0];

  let browser, failures = 0;
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("  page error:", e.message));
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.dataset.dopamineReady === "true", { timeout: 30000 });

    for (const slug of slugs) {
      process.stdout.write(`• ${slug} … `);
      const fix = FIXTURES[slug];
      const { vertex, fragment } = sources[slug];
      const cap = await page.evaluate(captureUniforms, { effect: slug, ...fix });
      const dims = { width: cap.width, height: cap.height };
      const web = await page.evaluate(renderFrag, { vertex, fragment, uniforms: cap.uniforms, ...dims, force: { uShadow: 0 } });
      const and = await page.evaluate(renderFrag, { vertex, fragment: toAndroid(fragment), uniforms: cap.uniforms, ...dims, force: { uShadow: 0 } });

      // web↔android RGB parity: the shared body must be byte-identical (the only
      // intended difference is the light-out emit, which leaves RGB = max(col,0)).
      // (Alpha isn't gated: the offscreen `alpha:false` context forces readback
      // alpha to 255, and dopLightOut's alpha is a trivial deterministic function.)
      let rgbDelta = 0;
      for (let i = 0; i < web.px.length; i += 4) {
        rgbDelta = Math.max(rgbDelta, Math.abs(web.px[i] - and.px[i]), Math.abs(web.px[i + 1] - and.px[i + 1]), Math.abs(web.px[i + 2] - and.px[i + 2]));
      }

      const goldenPath = join(GOLDEN_DIR, `${slug}.png`);
      if (update) {
        writeFileSync(goldenPath, Buffer.from(web.dataURL.split(",")[1], "base64"));
        console.log(`updated golden (${dims.width}×${dims.height}, web/androidΔ ${rgbDelta})`);
        if (rgbDelta > TOLERANCE) { failures++; console.error(`  ! ${slug}: web/android RGB parity off by ${rgbDelta}`); }
        continue;
      }
      if (!existsSync(goldenPath)) { console.error(`MISSING golden (run --update)`); failures++; continue; }
      const goldenDataURL = "data:image/png;base64," + readFileSync(goldenPath).toString("base64");
      const goldenPx = await page.evaluate(decodePng, { dataURL: goldenDataURL, ...dims });
      const delta = maxChannelDelta(flipRows(web.px, dims.width, dims.height), goldenPx);
      const ok = delta <= TOLERANCE && rgbDelta <= TOLERANCE;
      console.log(`${ok ? "✓" : "✗"} goldenΔ ${delta}, web/androidΔ ${rgbDelta}`);
      if (!ok) failures++;
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
  if (failures) { console.error(`\n${failures} shader-golden failure(s).`); process.exit(1); }
  console.log("\nall shader goldens OK.");
}

await main();

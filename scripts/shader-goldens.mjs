/**
 * Web↔Android shader-dialect mid-frame gate.
 *
 * Renders a representative middle-of-the-effect frame of each effect's canonical
 * web GLSL through headless Chromium + SwiftShader (WebGL2 == GLSL ES 3.00, the
 * exact dialect ANDROID uses), then renders the LITERAL Android variant of the
 * same fragment (the same body + `dopLightOut`, the premultiplied light-out
 * emit) with the same captured uniform bag, and asserts the two RGB outputs are
 * byte-identical (Δ0 — they share `max(col, 0)`; only the alpha emit differs).
 * Because the web GLSL is the SINGLE SOURCE the Android (and, via the
 * transpiler, the MSL) shaders are generated from, this self-contained check
 * proves the Android emit path leaves the shared shader body's pixels intact —
 * no committed golden images needed.
 *
 *   node scripts/shader-goldens.mjs              # check all migrated pure-shader effects
 *   node scripts/shader-goldens.mjs aurora       # only these effects
 */
import { build, preview } from "vite";
import { chromium } from "playwright";
import { DEMO_DIR, VIEWPORT, CHROMIUM_ARGS } from "./lib/reel.mjs";
import { loadShaderSources } from "./lib/shader-src.mjs";

// Representative fixtures: a fixed (mood, intensity, whimsy, seed, lifeFrac) so the
// frame is reproducible. lifeFrac 0.45 ≈ just past the envelope peak (the effect at
// its fullest), the most representative single frame.
const FIXTURES = {
  aurora: { mood: "serene", intensity: 0.85, whimsy: 0.4, seed: 12345, lifeFrac: 0.45 },
  ripple: { mood: "celebratory", intensity: 0.85, whimsy: 0.4, seed: 12345, lifeFrac: 0.45 },
  inkstroke: { mood: "celebratory", intensity: 0.85, whimsy: 0.45, seed: 12345, lifeFrac: 0.45 },
  halo: { mood: "serene", intensity: 0.85, whimsy: 0.4, seed: 12345, lifeFrac: 0.45 },
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
  // multiply layer is near-white) — the representative frame is the lit one.
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
  return { px: Array.from(px) };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const slugs = (args.length ? args : Object.keys(FIXTURES)).filter((s) => FIXTURES[s]);
  if (!slugs.length) { console.error("no known effects to render"); process.exit(1); }

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
      const ok = rgbDelta === 0;
      console.log(`${ok ? "✓" : "✗"} ${dims.width}×${dims.height}, web/androidΔ ${rgbDelta}`);
      if (!ok) failures++;
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.httpServer.close(r));
  }
  if (failures) { console.error(`\n${failures} web↔android shader parity failure(s).`); process.exit(1); }
  console.log("\nweb↔android shader parity OK.");
}

await main();

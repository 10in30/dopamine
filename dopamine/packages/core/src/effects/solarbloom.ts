/**
 * Solarbloom as an `EffectFactory` on the Dopamine backbone.
 *
 * The artistic look + shader are unchanged. What moved: the program now links
 * once in the shared, cached `GLContext` (not per fire); the conductor owns the
 * overlay, the clear, the blend mode and the RAF loop. The instance only sets
 * uniforms and draws — into the light context and, when present, the shadow
 * context. The conductor clears black/white and arms additive / MIN blending, so
 * a single fire is byte-identical to the legacy renderer and concurrent fires
 * sum as light / stack as shadow.
 */

import { FRAGMENT_SRC, VERTEX_SRC } from "../engine/shader.js";
import { checkProgress, envelope, NPR_TIME_STEP_MS } from "../engine/tempo.js";
import { MAX_MOTES, pickCheckGlyph, type RenderParams } from "../engine/mood.js";
import { shadowGeometry } from "../engine/shadow.js";
import { drawCheckGlyph } from "../engine/check-renderer.js";
import type { EffectContext, EffectFactory, EffectInstance } from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import { registerProgram } from "../framework/programs.js";
import { parseDope, resolveDopeParams, getOutline } from "../framework/loader.js";
import { decodeSdf, type DecodedSdf } from "../engine/sdf.js";
import type { GLContext } from "../engine/context.js";
import doc from "./solarbloom.dope.json";

// Solarbloom is fully DATA-DRIVEN: its mood→params mapping lives in the bundled
// `.dope` document (solarbloom.dope.json), evaluated by the loader. A vitest
// proves the loader output is byte-identical to the legacy `resolveParams`, so
// flipping the source of truth to the file changes nothing visually.
const DOPE = parseDope(doc as object);

// GEOMETRY SEAM: the checkmark icon's SHAPE comes from the .dope's
// `geometry.outlines.checkmark.svgPath`, baked at build time into an inline SDF
// (engine/sdf.ts + scripts/bake-sdf.mjs). We DECODE it once here; the shader only
// samples it. Swapping the svgPath in the .dope (and re-baking) changes the
// rendered icon with NO shader edit. If the .dope carries no baked SDF we fall
// back to the font-glyph path, then the analytic SDF — the win always confirms.
const CHECK_SDF: DecodedSdf | null = (() => {
  const outline = getOutline(DOPE, "checkmark");
  if (!outline?.sdf) return null;
  try {
    return decodeSdf(outline.sdf);
  } catch {
    return null;
  }
})();

/**
 * Resolve via the `.dope` loader → the typed RenderParams the shader consumes.
 * The numeric/palette params come from the bundled `.dope` document (byte-
 * identical to `resolveParams` — see loader.test.ts). The whimsy-derived
 * CHECK GLYPH (face + char) is genuinely code-shaped (a non-numeric pick, no
 * rng), so it's composed on top here — mirroring how Comic adds its typography.
 */
function resolveFromDope(feeling: { mood: string; intensity: number; whimsy: number; seed: number }): RenderParams {
  const numeric = resolveDopeParams(DOPE, feeling, { MAX_MOTES }, "moteSeed") as unknown as RenderParams;
  return { ...numeric, checkGlyph: pickCheckGlyph(feeling.whimsy) };
}

const UNIFORMS = [
  "uResolution", "uOrigin", "uAmp", "uCheck", "uLife", "uTimeS", "uExposure",
  "uBloomRadius", "uTurbulence", "uMoteSpeed", "uMoteCount", "uMoteSeed",
  "uIridescence", "uDispersion", "uStyle", "uC0", "uC1", "uC2",
  "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
  "uCheckTex", "uCheckTexOn", "uCheckBox",
  "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx",
] as const;

// Half-size of the checkmark glyph box as a fraction of min viewport dim. Matches
// the shader's `cr = minDim*0.11` checkmark scale (a touch larger so the glyph,
// which fills ~78% of its texture, reads at the same size as the old SDF tick).
const CHECK_BOX_FRAC = 0.16;
/** Offscreen glyph texture resolution (square). Cheap; the glyph is tiny. */
const GLYPH_TEX_SIZE = 256;

function makeGlyphTexture(glc: GLContext): WebGLTexture {
  const { gl } = glc;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex!;
}

/**
 * Upload the decoded SDF as a single-channel R8 texture (linear-filtered, edge-
 * clamped). The shader reads `.r` as the normalized distance-to-stroke. The SDF
 * rows are top-down (author space) so we FLIP_Y to match the gl y-up sampling
 * used by glyphUV, keeping the baked icon upright.
 */
function makeSdfTexture(glc: GLContext, sdf: DecodedSdf): WebGLTexture {
  const { gl } = glc;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.R8, sdf.size, sdf.size, 0, gl.RED, gl.UNSIGNED_BYTE, sdf.bytes,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return tex!;
}

function createInstance(params: RenderParams, ctx: EffectContext): EffectInstance {
  const [c0, c1, c2] = params.palette;
  const dpr = ctx.dpr;

  // ---- Checkmark GLYPH texture --------------------------------------------
  // Rasterize the whimsy-chosen check glyph (✓ / ✔) ONCE into an offscreen
  // square canvas (it doesn't change over the fire), upload as an alpha texture
  // the shader reveals with a draw-in wipe. If the bundled face hasn't loaded the
  // shader falls back to its analytic SDF checkmark (uCheckTexOn = 0), so the
  // effect always confirms the win even if a FontFace failed.
  // Skip the font-glyph raster entirely when the baked-SDF seam is active.
  const sdfActive = CHECK_SDF !== null;
  const glyphCanvas =
    !sdfActive && typeof document !== "undefined" ? document.createElement("canvas") : null;
  let glyphOn = false;
  if (glyphCanvas) {
    glyphCanvas.width = GLYPH_TEX_SIZE;
    glyphCanvas.height = GLYPH_TEX_SIZE;
    const gctx = glyphCanvas.getContext("2d", { alpha: true });
    if (gctx) {
      glyphOn = drawCheckGlyph(gctx, GLYPH_TEX_SIZE, params.checkGlyph.family, params.checkGlyph.char);
    }
  }
  // GEOMETRY SEAM: prefer the baked SDF icon (driven by the .dope svgPath) when
  // present; it takes priority over the font glyph and the analytic fallback.
  const sdfOn = CHECK_SDF !== null;
  const lightSdfTex = sdfOn ? makeSdfTexture(ctx.light, CHECK_SDF!) : null;
  const shadowSdfTex = sdfOn && ctx.shadow ? makeSdfTexture(ctx.shadow, CHECK_SDF!) : null;

  // One glyph texture per context (light + shadow); pixels uploaded on first use.
  // Only built when the SDF seam is unavailable.
  const lightTex = !sdfOn && glyphOn ? makeGlyphTexture(ctx.light) : null;
  const shadowTex = !sdfOn && glyphOn && ctx.shadow ? makeGlyphTexture(ctx.shadow) : null;
  const uploaded = new WeakSet<WebGLTexture>();

  const drawPass = (glc: GLContext, animMs: number, life: number, amp: number, isShadow: boolean): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const prog = glc.program(VERTEX_SRC, FRAGMENT_SRC);
    const u = prog.uniforms(UNIFORMS);
    gl.useProgram(prog.program);
    gl.bindVertexArray(glc.vao);

    const checkBoxPx = CHECK_BOX_FRAC * Math.min(c.width, c.height);

    // Baked-SDF icon (the geometry seam) — bound to TEXTURE1, sampled by .r.
    const sdfTex = isShadow ? shadowSdfTex : lightSdfTex;
    if (sdfOn && sdfTex && CHECK_SDF) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sdfTex);
      gl.uniform1i(u.uSdfTex, 1);
      // The SDF spans its full viewBox, mapped onto the 2*checkBox px box. Convert
      // the SDF's author-unit `range` and a target stroke half-width into px.
      const vbW = CHECK_SDF.viewBox[2] || 100;
      const pxPerUnit = (2 * checkBoxPx) / vbW;
      gl.uniform1f(u.uSdfRangePx, CHECK_SDF.range * pxPerUnit);
      gl.uniform1f(u.uSdfStrokePx, checkBoxPx * 0.11);
    }
    gl.uniform1f(u.uSdfOn, sdfOn ? 1 : 0);

    // Bind / upload the glyph texture (once per context — it's static per fire).
    const tex = isShadow ? shadowTex : lightTex;
    const on = !sdfOn && glyphOn && tex !== null;
    if (on && tex) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (!uploaded.has(tex) && glyphCanvas) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, glyphCanvas);
        uploaded.add(tex);
      }
      gl.uniform1i(u.uCheckTex, 0);
    }
    gl.uniform1f(u.uCheckTexOn, on ? 1 : 0);
    gl.uniform1f(u.uCheckBox, checkBoxPx);
    gl.uniform2f(u.uResolution, c.width, c.height);
    // Flip Y: gl_FragCoord origin is bottom-left.
    gl.uniform2f(u.uOrigin, ctx.anchor.x * dpr, c.height - ctx.anchor.y * dpr);
    gl.uniform1f(u.uAmp, amp);
    gl.uniform1f(u.uCheck, checkProgress(animMs));
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, animMs / 1000);
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uBloomRadius, params.bloomRadius);
    gl.uniform1f(u.uTurbulence, params.turbulence);
    gl.uniform1f(u.uMoteSpeed, params.moteSpeed);
    gl.uniform1f(u.uMoteCount, params.moteCount);
    gl.uniform1f(u.uMoteSeed, params.moteSeed);
    gl.uniform1f(u.uIridescence, params.iridescence);
    gl.uniform1f(u.uDispersion, params.dispersion);
    gl.uniform1f(u.uStyle, params.style);
    gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);
    gl.uniform1f(u.uShadow, isShadow ? 1 : 0);
    if (isShadow) {
      const minDim = Math.min(c.width, c.height);
      const sg = shadowGeometry({ minDim, heightFrac: params.bloomRadius, amp, style: params.style });
      gl.uniform2f(u.uShadowOffset, sg.offsetX, sg.offsetY);
      gl.uniform1f(u.uShadowSoft, sg.soft);
      gl.uniform1f(u.uShadowStrength, sg.strength);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let disposed = false;
  return {
    durationMs: params.durationMs,
    renderAt(elapsedMs: number): void {
      if (disposed) return;
      // Hand-drawn "on twos": snap the clock toward a coarse grid as style rises.
      const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
      const animMs = elapsedMs + (stepped - elapsedMs) * params.style;
      const life = Math.min(Math.max(animMs, 0) / params.durationMs, 1);
      const amp = envelope(life, params.overshoot);
      if (ctx.shadow) drawPass(ctx.shadow, animMs, life, amp, true);
      drawPass(ctx.light, animMs, life, amp, false);
    },
    // Programs + VAO are owned & cached by the shared contexts; the only per-fire
    // GPU resource is the glyph texture (it holds this fire's rasterized check),
    // so disposal frees those and disarms the instance.
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (lightTex) ctx.light.gl.deleteTexture(lightTex);
      if (shadowTex && ctx.shadow) ctx.shadow.gl.deleteTexture(shadowTex);
      if (lightSdfTex) ctx.light.gl.deleteTexture(lightSdfTex);
      if (shadowSdfTex && ctx.shadow) ctx.shadow.gl.deleteTexture(shadowSdfTex);
    },
  };
}

export const solarbloom: EffectFactory<RenderParams> = {
  name: "solarbloom",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 260, holdMs: 360 },
};

// Expose the renderer as a bundled PROGRAM so `loadEffect()` can bind an
// arbitrary host-authored `.dope` (one that references program "solarbloom") to
// it with no code. The numeric/palette bag comes from the loader; the whimsy-
// picked check glyph is composed on top (genuinely code-shaped, no rng).
registerProgram<RenderParams>("solarbloom", {
  create: createInstance,
  scatterKey: "moteSeed",
  consts: { MAX_MOTES },
  reducedMotion: { peakMs: 260, holdMs: 360 },
  composeParams: (numeric, feeling) => ({
    ...numeric,
    checkGlyph: pickCheckGlyph(feeling.whimsy),
  }),
});

export default registerEffect(solarbloom);

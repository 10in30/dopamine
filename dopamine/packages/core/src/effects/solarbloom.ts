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
import { parseDope, resolveDopeParams } from "../framework/loader.js";
import type { GLContext } from "../engine/context.js";
import doc from "./solarbloom.dope.json";

// Solarbloom is fully DATA-DRIVEN: its mood→params mapping lives in the bundled
// `.dope` document (solarbloom.dope.json), evaluated by the loader. A vitest
// proves the loader output is byte-identical to the legacy `resolveParams`, so
// flipping the source of truth to the file changes nothing visually.
const DOPE = parseDope(doc as object);

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

function createInstance(params: RenderParams, ctx: EffectContext): EffectInstance {
  const [c0, c1, c2] = params.palette;
  const dpr = ctx.dpr;

  // ---- Checkmark GLYPH texture --------------------------------------------
  // Rasterize the whimsy-chosen check glyph (✓ / ✔) ONCE into an offscreen
  // square canvas (it doesn't change over the fire), upload as an alpha texture
  // the shader reveals with a draw-in wipe. If the bundled face hasn't loaded the
  // shader falls back to its analytic SDF checkmark (uCheckTexOn = 0), so the
  // effect always confirms the win even if a FontFace failed.
  const glyphCanvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  let glyphOn = false;
  if (glyphCanvas) {
    glyphCanvas.width = GLYPH_TEX_SIZE;
    glyphCanvas.height = GLYPH_TEX_SIZE;
    const gctx = glyphCanvas.getContext("2d", { alpha: true });
    if (gctx) {
      glyphOn = drawCheckGlyph(gctx, GLYPH_TEX_SIZE, params.checkGlyph.family, params.checkGlyph.char);
    }
  }
  // One texture per context (light + shadow); pixels uploaded on first use.
  const lightTex = glyphOn ? makeGlyphTexture(ctx.light) : null;
  const shadowTex = glyphOn && ctx.shadow ? makeGlyphTexture(ctx.shadow) : null;
  const uploaded = new WeakSet<WebGLTexture>();

  const drawPass = (glc: GLContext, animMs: number, life: number, amp: number, isShadow: boolean): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const prog = glc.program(VERTEX_SRC, FRAGMENT_SRC);
    const u = prog.uniforms(UNIFORMS);
    gl.useProgram(prog.program);
    gl.bindVertexArray(glc.vao);

    // Bind / upload the glyph texture (once per context — it's static per fire).
    const tex = isShadow ? shadowTex : lightTex;
    const on = glyphOn && tex !== null;
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
    gl.uniform1f(u.uCheckBox, CHECK_BOX_FRAC * Math.min(c.width, c.height));
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
    },
  };
}

export const solarbloom: EffectFactory<RenderParams> = {
  name: "solarbloom",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 260, holdMs: 360 },
};

export default registerEffect(solarbloom);

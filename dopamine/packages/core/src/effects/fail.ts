/**
 * Fail / error effect — the emotional OPPOSITE of the three success effects.
 *
 * A red/amber ✗ cross is STAMPED in over a recoiling error flare with a sharp
 * hit + damped shake, then desaturates and collapses. Short and punchy, not a
 * celebratory bloom.
 *
 * THIS EFFECT IS A PHASE 1–3 DOG-FOOD: it is authored against the generalized
 * seams as much as possible —
 *   • its params/palette/tempo-duration come from fail.dope.json via the loader
 *     (resolveDopeParams), no bespoke resolve table;
 *   • its ✗ ICON comes from the .dope `svgPath` via the geometry→SDF seam
 *     (engine/sdf.ts), sampled by the shader (uSdfTex) — swap the path + re-bake
 *     to change the icon with no shader edit;
 *   • it registers via the registry AND as a bundled program, so it is also
 *     loadable via the public loadEffect().
 * The one genuinely code-shaped piece is a NEW shader for the distinct fail
 * *feel* (shaders are code under the current boundary) + the fail envelope in
 * tempo.ts. Renderer plumbing is minimized: one program, one SDF texture, the
 * shared shadow geometry — no Canvas2D hybrid.
 */

import { failEnvelope, stampProgress, shakeOffset, NPR_TIME_STEP_MS } from "../engine/tempo.js";
import { shadowGeometry } from "../engine/shadow.js";
import { FAIL_FRAGMENT_SRC, FAIL_VERTEX_SRC } from "../engine/fail-shader.js";
import type { RGB } from "../engine/color.js";
import { decodeSdf, type DecodedSdf } from "../engine/sdf.js";
import type { EffectContext, EffectFactory, EffectInstance, FeelingInput } from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import { registerProgram } from "../framework/programs.js";
import { registerMood } from "../framework/mood-registry.js";
import { parseDope, resolveDopeParams, getOutline } from "../framework/loader.js";
import type { GLContext } from "../engine/context.js";
import doc from "./fail.dope.json";

const DOPE = parseDope(doc as object);

/** Register the fail-appropriate moods so they light up the registry (energy). */
registerMood("try-again", { hueCenter: 70, hueRange: 40, lightness: 0.78, chroma: 0.13, energy: 0.2 });
registerMood("error", { hueCenter: 40, hueRange: 36, lightness: 0.72, chroma: 0.17, energy: 0.55 });
registerMood("denied", { hueCenter: 22, hueRange: 30, lightness: 0.66, chroma: 0.21, energy: 1.0 });

/** GEOMETRY SEAM: decode the baked ✗ SDF once; the shader only samples it. */
const CROSS_SDF: DecodedSdf | null = (() => {
  const outline = getOutline(DOPE, "cross");
  if (!outline?.sdf) return null;
  try {
    return decodeSdf(outline.sdf);
  } catch {
    return null;
  }
})();

/** The fail render params (the loader bag + the typed fields the shader reads). */
interface FailParams {
  seed: number;
  durationMs: number;
  palette: [RGB, RGB, RGB];
  exposure: number;
  severity: number;
  shakeAmount: number;
  style: number;
  failSeed: number;
}

function resolveFromDope(feeling: FeelingInput): FailParams {
  return resolveDopeParams(DOPE, feeling, {}, "failSeed") as unknown as FailParams;
}

const UNIFORMS = [
  "uResolution", "uOrigin", "uAmp", "uStamp", "uLife", "uTimeS", "uShake",
  "uExposure", "uSeverity", "uStyle",
  "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
  "uC0", "uC1", "uC2",
  "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx", "uBoxPx",
] as const;

/** Half-size of the ✗ box as a fraction of min viewport dim. */
const CROSS_BOX_FRAC = 0.15;

function makeSdfTexture(glc: GLContext, sdf: DecodedSdf): WebGLTexture {
  const { gl } = glc;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, sdf.size, sdf.size, 0, gl.RED, gl.UNSIGNED_BYTE, sdf.bytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return tex!;
}

function createInstance(params: FailParams, ctx: EffectContext): EffectInstance {
  const [c0, c1, c2] = params.palette;
  const dpr = ctx.dpr;
  const sdfOn = CROSS_SDF !== null;
  const lightSdfTex = sdfOn ? makeSdfTexture(ctx.light, CROSS_SDF!) : null;
  const shadowSdfTex = sdfOn && ctx.shadow ? makeSdfTexture(ctx.shadow, CROSS_SDF!) : null;

  const drawPass = (glc: GLContext, animMs: number, life: number, amp: number, isShadow: boolean): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const prog = glc.program(FAIL_VERTEX_SRC, FAIL_FRAGMENT_SRC);
    const u = prog.uniforms(UNIFORMS);
    gl.useProgram(prog.program);
    gl.bindVertexArray(glc.vao);

    const boxPx = CROSS_BOX_FRAC * Math.min(c.width, c.height);
    const sdfTex = isShadow ? shadowSdfTex : lightSdfTex;
    if (sdfOn && sdfTex && CROSS_SDF) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sdfTex);
      gl.uniform1i(u.uSdfTex, 1);
      const vbW = CROSS_SDF.viewBox[2] || 100;
      const pxPerUnit = (2 * boxPx) / vbW;
      gl.uniform1f(u.uSdfRangePx, CROSS_SDF.range * pxPerUnit);
      gl.uniform1f(u.uSdfStrokePx, boxPx * 0.13);
    }
    gl.uniform1f(u.uSdfOn, sdfOn ? 1 : 0);
    gl.uniform1f(u.uBoxPx, boxPx);

    gl.uniform2f(u.uResolution, c.width, c.height);
    gl.uniform2f(u.uOrigin, ctx.anchor.x * dpr, c.height - ctx.anchor.y * dpr);
    gl.uniform1f(u.uAmp, amp);
    gl.uniform1f(u.uStamp, stampProgress(animMs));
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, animMs / 1000);
    gl.uniform1f(u.uShake, shakeOffset(animMs, params.shakeAmount));
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uSeverity, params.severity);
    gl.uniform1f(u.uStyle, params.style);
    gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);
    gl.uniform1f(u.uShadow, isShadow ? 1 : 0);
    if (isShadow) {
      const minDim = Math.min(c.width, c.height);
      const sg = shadowGeometry({ minDim, heightFrac: 0.42, amp, style: params.style });
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
      // "On twos" snap toward a coarse grid as style rises (glitch judder).
      const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
      const animMs = elapsedMs + (stepped - elapsedMs) * params.style;
      const life = Math.min(Math.max(animMs, 0) / params.durationMs, 1);
      const amp = failEnvelope(life);
      if (ctx.shadow) drawPass(ctx.shadow, animMs, life, amp, true);
      drawPass(ctx.light, animMs, life, amp, false);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (lightSdfTex) ctx.light.gl.deleteTexture(lightSdfTex);
      if (shadowSdfTex && ctx.shadow) ctx.shadow.gl.deleteTexture(shadowSdfTex);
    },
  };
}

export const fail: EffectFactory<FailParams> = {
  name: "fail",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 200, holdMs: 320 },
};

// Bundled program so the public loadEffect() can bind a host-authored fail
// variant (recolor / re-icon / retime) to this shader with no code.
registerProgram<FailParams>("fail", {
  create: createInstance,
  scatterKey: "failSeed",
  consts: {},
  reducedMotion: { peakMs: 200, holdMs: 320 },
});

export default registerEffect(fail);

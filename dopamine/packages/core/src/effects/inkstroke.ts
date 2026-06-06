/**
 * Calligraphic Verdict (the ink-stroke success effect) as an `EffectFactory`.
 * Look + shader unchanged; the program links once in the shared context and the
 * conductor owns the overlay / clear / blend / loop. The gesture composes itself
 * across the whole surface, so it ignores the anchor.
 */

import { envelope, strokeProgress, NPR_TIME_STEP_MS } from "../engine/tempo.js";
import { MAX_DROPS, type InkRenderParams } from "../engine/mood.js";
import { shadowGeometry } from "../engine/shadow.js";
import { INK_FRAGMENT_SRC, INK_VERTEX_SRC } from "../engine/inkstroke-shader.js";
import type { EffectContext, EffectFactory, EffectInstance } from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import { parseDope, resolveDopeParams } from "../framework/loader.js";
import type { GLContext } from "../engine/context.js";
import doc from "./inkstroke.dope.json";

// Verdict is fully DATA-DRIVEN from inkstroke.dope.json (loader-resolved params
// are byte-identical to the legacy resolveInkParams — see loader.test.ts).
const DOPE = parseDope(doc as object);

function resolveFromDope(feeling: { mood: string; intensity: number; whimsy: number; seed: number }): InkRenderParams {
  return resolveDopeParams(DOPE, feeling, { MAX_DROPS }, "inkSeed") as unknown as InkRenderParams;
}

const UNIFORMS = [
  "uResolution", "uDraw", "uLife", "uTimeS", "uAmp", "uExposure", "uScale",
  "uPressure", "uWetness", "uBristle", "uDroplets", "uSeed", "uStyle",
  "uC0", "uC1", "uC2",
  "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
] as const;

function createInstance(params: InkRenderParams, ctx: EffectContext): EffectInstance {
  const [c0, c1, c2] = params.palette;

  const drawPass = (glc: GLContext, animMs: number, life: number, amp: number, isShadow: boolean): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const prog = glc.program(INK_VERTEX_SRC, INK_FRAGMENT_SRC);
    const u = prog.uniforms(UNIFORMS);
    gl.useProgram(prog.program);
    gl.bindVertexArray(glc.vao);
    gl.uniform2f(u.uResolution, c.width, c.height);
    gl.uniform1f(u.uDraw, strokeProgress(animMs));
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, animMs / 1000);
    gl.uniform1f(u.uAmp, amp);
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uScale, params.scale);
    gl.uniform1f(u.uPressure, params.pressure);
    gl.uniform1f(u.uWetness, params.wetness);
    gl.uniform1f(u.uBristle, params.bristle);
    gl.uniform1f(u.uDroplets, params.droplets);
    gl.uniform1f(u.uSeed, params.inkSeed);
    gl.uniform1f(u.uStyle, params.style);
    gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);
    gl.uniform1f(u.uShadow, isShadow ? 1 : 0);
    if (isShadow) {
      const minDim = Math.min(c.width, c.height);
      const sg = shadowGeometry({ minDim, heightFrac: params.scale * 0.5, amp, style: params.style });
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
      const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
      const animMs = elapsedMs + (stepped - elapsedMs) * params.style;
      const life = Math.min(Math.max(animMs, 0) / params.durationMs, 1);
      const amp = envelope(life, params.overshoot);
      if (ctx.shadow) drawPass(ctx.shadow, animMs, life, amp, true);
      drawPass(ctx.light, animMs, life, amp, false);
    },
    dispose(): void {
      disposed = true;
    },
  };
}

export const inkstroke: EffectFactory<InkRenderParams> = {
  name: "inkstroke",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 300, holdMs: 360 },
};

export default registerEffect(inkstroke);

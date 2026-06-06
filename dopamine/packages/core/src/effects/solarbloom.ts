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
import { resolveParams, type RenderParams } from "../engine/mood.js";
import { shadowGeometry } from "../engine/shadow.js";
import type { EffectContext, EffectFactory, EffectInstance } from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import type { GLContext } from "../engine/context.js";

const UNIFORMS = [
  "uResolution", "uOrigin", "uAmp", "uCheck", "uLife", "uTimeS", "uExposure",
  "uBloomRadius", "uTurbulence", "uMoteSpeed", "uMoteCount", "uMoteSeed",
  "uIridescence", "uDispersion", "uStyle", "uC0", "uC1", "uC2",
  "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
] as const;

function createInstance(params: RenderParams, ctx: EffectContext): EffectInstance {
  const [c0, c1, c2] = params.palette;
  const dpr = ctx.dpr;

  const drawPass = (glc: GLContext, animMs: number, life: number, amp: number, isShadow: boolean): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const prog = glc.program(VERTEX_SRC, FRAGMENT_SRC);
    const u = prog.uniforms(UNIFORMS);
    gl.useProgram(prog.program);
    gl.bindVertexArray(glc.vao);
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
    // Programs + VAO are owned & cached by the shared contexts, so an instance
    // has nothing of its own to free — disposal just disarms it.
    dispose(): void {
      disposed = true;
    },
  };
}

export const solarbloom: EffectFactory<RenderParams> = {
  name: "solarbloom",
  resolve: (feeling) =>
    resolveParams({
      mood: feeling.mood,
      intensity: feeling.intensity,
      whimsy: feeling.whimsy,
      seed: feeling.seed,
    }),
  create: createInstance,
  reducedMotion: { peakMs: 260, holdMs: 360 },
};

export default registerEffect(solarbloom);

/**
 * Comic Impact (the "BAM! POW!" success effect) as an `EffectFactory`.
 *
 * A hybrid: the jagged starburst + hand-lettered word + ink contours are drawn
 * into ONE offscreen Canvas2D panel each frame; the fragment shader adds the
 * Ben-Day halftone, action lines, flash, noir↔pop styling and casts the light.
 * The program links once in the shared context; the per-fire panel TEXTURE is
 * the instance's own GPU resource (it holds per-frame pixels, so it can't be
 * cached) and is uploaded into each context (light + shadow), then freed on
 * dispose. The conductor owns the overlay / clear / blend / loop.
 */

import { impactScale, impactPresence, IMPACT_MS, IMPACT_HOLD_MS } from "../engine/tempo.js";
import { type ComicRenderParams } from "../engine/mood.js";
import { resolveComicParams } from "../engine/mood.js";
import { shadowGeometry } from "../engine/shadow.js";
import { COMIC_FRAGMENT_SRC, COMIC_VERTEX_SRC } from "../engine/comic-shader.js";
import { drawPanel } from "../engine/comic-renderer.js";
import type { EffectContext, EffectFactory, EffectInstance } from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import type { GLContext } from "../engine/context.js";

const UNIFORMS = [
  "uPanel", "uResolution", "uCenter", "uLife", "uTimeS", "uPresence", "uFlash",
  "uExposure", "uHalftone", "uDotSize", "uSaturation", "uActionLines",
  "uInkBoost", "uSeed", "uStyle", "uC0", "uC1", "uC2",
  "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
] as const;

function makePanelTexture(glc: GLContext): WebGLTexture {
  const { gl } = glc;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex!;
}

function createInstance(params: ComicRenderParams, ctx: EffectContext): EffectInstance {
  const [c0, c1, c2] = params.palette;
  const dpr = ctx.dpr;

  // One offscreen Canvas2D panel (word + burst + ink), shared by both passes.
  const panel = document.createElement("canvas");
  const pctx = panel.getContext("2d", { alpha: true })!;

  const lightTex = makePanelTexture(ctx.light);
  const shadowTex = ctx.shadow ? makePanelTexture(ctx.shadow) : null;

  const drawPass = (
    glc: GLContext,
    tex: WebGLTexture,
    life: number,
    elapsedMs: number,
    presence: number,
    flash: number,
    isShadow: boolean,
  ): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const prog = glc.program(COMIC_VERTEX_SRC, COMIC_FRAGMENT_SRC);
    const u = prog.uniforms(UNIFORMS);
    gl.useProgram(prog.program);
    gl.bindVertexArray(glc.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panel);
    gl.uniform1i(u.uPanel, 0);

    gl.uniform2f(u.uResolution, c.width, c.height);
    gl.uniform2f(u.uCenter, c.width * 0.5, c.height * 0.5);
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, elapsedMs / 1000);
    gl.uniform1f(u.uPresence, presence);
    gl.uniform1f(u.uFlash, Math.min(flash, 1.2));
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uHalftone, params.halftone);
    gl.uniform1f(u.uDotSize, params.dotSize * dpr);
    gl.uniform1f(u.uSaturation, params.saturation);
    gl.uniform1f(u.uActionLines, params.actionLines);
    gl.uniform1f(u.uInkBoost, 1.0 + params.style * 0.4);
    gl.uniform1f(u.uSeed, params.comicSeed);
    gl.uniform1f(u.uStyle, params.style);
    gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);
    gl.uniform1f(u.uShadow, isShadow ? 1 : 0);
    if (isShadow) {
      const minDim = Math.min(c.width, c.height);
      const sg = shadowGeometry({ minDim, heightFrac: 0.5, amp: presence, style: params.style });
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
      const c = ctx.light.canvas;
      if (panel.width !== c.width || panel.height !== c.height) {
        panel.width = c.width;
        panel.height = c.height;
      }
      const life = Math.min(Math.max(elapsedMs, 0) / params.durationMs, 1);
      const scale = impactScale(elapsedMs, params.overshoot);
      const presence = impactPresence(life);
      const flash =
        Math.exp(-elapsedMs / (IMPACT_MS * 0.55)) +
        0.25 * Math.exp(-Math.abs(elapsedMs - IMPACT_HOLD_MS * 0.2) / (IMPACT_MS * 0.8));

      // Draw the shared offscreen panel once, then composite into each pass.
      drawPanel(pctx, c.width, c.height, params, scale, presence, dpr);
      if (ctx.shadow && shadowTex) drawPass(ctx.shadow, shadowTex, life, elapsedMs, presence, flash, true);
      drawPass(ctx.light, lightTex, life, elapsedMs, presence, flash, false);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      ctx.light.gl.deleteTexture(lightTex);
      if (ctx.shadow && shadowTex) ctx.shadow.gl.deleteTexture(shadowTex);
    },
  };
}

export const comic: EffectFactory<ComicRenderParams> = {
  name: "comic",
  resolve: (feeling) =>
    resolveComicParams({
      mood: feeling.mood,
      intensity: feeling.intensity,
      whimsy: feeling.whimsy,
      seed: feeling.seed,
    }),
  create: createInstance,
  reducedMotion: { peakMs: 220, holdMs: 360 },
};

export default registerEffect(comic);

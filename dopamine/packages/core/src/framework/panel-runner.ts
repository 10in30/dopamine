/**
 * Generic Canvas2D "panel" runner — the shared backbone for HYBRID effects whose
 * per-frame content is drawn with Canvas2D (vector / text / shape) and then lit
 * by a fragment shader (Comic Impact's hand-lettered word + jagged starburst +
 * ink, lit into Ben-Day halftone + action lines + flash).
 *
 * It owns ALL the renderer/texture/upload/shadow plumbing that a Canvas2D-panel
 * effect would otherwise hand-wire:
 *   • the single offscreen panel canvas + its 2D context,
 *   • resizing the panel to track the live GL canvas each frame,
 *   • the per-frame draw → `texImage2D` UPLOAD into BOTH the light + shadow
 *     contexts (the panel pixels change every frame, so — unlike a static SDF
 *     aux — they are re-uploaded each frame), with the FLIP_Y + non-premultiplied
 *     channel-encoding convention the panel shaders expect,
 *   • the standard shader uniforms (resolution, center, life, time, style,
 *     palette, the shadow-pass uniforms via shadowGeometry) + scalar render.params
 *     auto-bound by name convention,
 *   • the light + (optional) shadow pass via the program-cached contexts, and
 *   • disposing the per-fire panel textures.
 *
 * What stays per-effect (the honest boundary): the GLSL, a small `draw()` panel
 * program (the Canvas2D draw — genuinely code-shaped vector/text logic stays JS),
 * and a tiny config naming the shader's uniforms + the per-frame timing.
 */

import { shadowGeometry } from "../engine/shadow.js";
import type { RGB } from "../engine/color.js";
import type { GLContext } from "../engine/context.js";
import type { EffectContext, EffectInstance } from "./effect.js";
import type { PassParams } from "./pass-runner.js";

/** Per-frame timing context for a panel effect's draw + frame hooks. */
export interface PanelFrameInfo {
  /** Raw elapsed time since start, ms (panels don't snap "on twos"). */
  elapsedMs: number;
  /** Normalized life 0..1 (elapsedMs / durationMs, clamped). */
  life: number;
  /** Device-pixel ratio the panel is rendered at. */
  dpr: number;
}

/** A registered "panel program": the Canvas2D draw for one frame. */
export type PanelDraw<P extends PassParams = PassParams> = (
  panelCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: P,
  info: PanelFrameInfo,
) => void;

/** Config for one Canvas2D-panel effect. */
export interface PanelConfig<P extends PassParams = PassParams> {
  /** Vertex + fragment GLSL (the per-effect look). */
  vertex: string;
  fragment: string;
  /** Every uniform name the shader reads. */
  uniforms: readonly string[];
  /** Sampler uniform for the uploaded panel (bound to TEXTURE0). Default "uPanel". */
  panelSampler?: string;
  /**
   * Explicit `param name → uniform name` overrides for the scalar auto-binding;
   * map to `null` to skip a param that isn't a uniform (e.g. a scatter seed).
   */
  bindings?: Record<string, string | null>;
  /** The shadow occluder "height" as a fraction of min canvas dim. */
  shadowHeightFrac: number | ((params: P) => number);
  /** The Canvas2D panel program (draws one frame). */
  draw: PanelDraw<P>;
  /**
   * Compute the genuinely effect-specific TIME-VARYING uniforms for a frame
   * (presence, flash, …). Returns a map of uniform name → float; `amp` (a
   * well-known key) feeds shadowGeometry.
   */
  frame(info: PanelFrameInfo, params: P): { amp: number } & Record<string, number>;
  /**
   * Extra per-pass scalar uniforms that depend on the live canvas / dpr but are
   * not plain params (e.g. `uDotSize = dotSize * dpr`, `uInkBoost`). Computed per
   * pass.
   */
  passUniforms?(canvas: HTMLCanvasElement, params: P, dpr: number): Record<string, number>;
}

const STANDARD = ["uResolution", "uCenter", "uLife", "uTimeS", "uStyle",
  "uC0", "uC1", "uC2", "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength"] as const;

const cap = (s: string): string => `u${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * Build a drawable {@link EffectInstance} for a Canvas2D-panel effect from its
 * config + resolved params + the runtime context.
 */
export function createPanelInstance<P extends PassParams>(
  config: PanelConfig<P>,
  params: P,
  ctx: EffectContext,
): EffectInstance {
  const pal = params.palette as RGB[];
  const [c0, c1, c2] = pal;
  const dpr = ctx.dpr;
  const sampler = config.panelSampler ?? "uPanel";
  const allUniforms = [...new Set([...STANDARD, sampler, ...config.uniforms])];

  // The numeric params that auto-bind to a uniform.
  const bindings = config.bindings ?? {};
  const scalarBinds: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== "number") continue;
    if (name === "durationMs") continue;
    const override = bindings[name];
    if (override === null) continue;
    scalarBinds.push([name, override ?? cap(name)]);
  }

  // One offscreen Canvas2D panel, shared by both passes (drawn once per frame).
  const panel = document.createElement("canvas");
  const pctx = panel.getContext("2d", { alpha: true })!;

  const lightTex = ctx.light.gl.createTexture();
  const shadowTex = ctx.shadow ? ctx.shadow.gl.createTexture() : null;
  for (const glc of [ctx.light, ctx.shadow]) {
    if (!glc) continue;
    const { gl } = glc;
    gl.bindTexture(gl.TEXTURE_2D, glc === ctx.light ? lightTex : shadowTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  const heightFrac = (): number =>
    typeof config.shadowHeightFrac === "function" ? config.shadowHeightFrac(params) : config.shadowHeightFrac;

  const drawPass = (
    glc: GLContext,
    tex: WebGLTexture,
    info: PanelFrameInfo,
    frameUniforms: { amp: number } & Record<string, number>,
    isShadow: boolean,
  ): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const prog = glc.program(config.vertex, config.fragment);
    const u = prog.uniforms(allUniforms);
    gl.useProgram(prog.program);
    gl.bindVertexArray(glc.vao);

    // Upload the freshly-drawn panel (changes every frame).
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panel);
    if (u[sampler]) gl.uniform1i(u[sampler], 0);

    // Extra per-pass scalar uniforms (dpr-scaled etc.).
    const extra = config.passUniforms?.(c, params, dpr);
    if (extra) for (const [n, v] of Object.entries(extra)) if (u[n]) gl.uniform1f(u[n], v);

    // Standard uniforms.
    gl.uniform2f(u.uResolution, c.width, c.height);
    gl.uniform2f(u.uCenter, c.width * 0.5, c.height * 0.5);
    gl.uniform1f(u.uLife, info.life);
    gl.uniform1f(u.uTimeS, info.elapsedMs / 1000);
    gl.uniform1f(u.uStyle, params.style);
    if (c0) gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    if (c1) gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    if (c2) gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);

    // Effect-specific scalar params (auto-bound by name convention).
    for (const [name, uniformName] of scalarBinds) {
      const loc = u[uniformName];
      if (loc) gl.uniform1f(loc, params[name] as number);
    }

    // Time-varying uniforms from the per-effect frame() hook.
    for (const [n, v] of Object.entries(frameUniforms)) {
      const loc = u[n === "amp" ? "uAmp" : n];
      if (loc) gl.uniform1f(loc, v);
    }

    gl.uniform1f(u.uShadow, isShadow ? 1 : 0);
    if (isShadow) {
      const minDim = Math.min(c.width, c.height);
      const sg = shadowGeometry({ minDim, heightFrac: heightFrac(), amp: frameUniforms.amp, style: params.style });
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
      const info: PanelFrameInfo = { elapsedMs, life, dpr };
      const frameUniforms = config.frame(info, params);
      // Draw the shared offscreen panel once, then composite into each pass.
      config.draw(pctx, c.width, c.height, params, info);
      if (ctx.shadow && shadowTex) drawPass(ctx.shadow, shadowTex, info, frameUniforms, true);
      drawPass(ctx.light, lightTex!, info, frameUniforms, false);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (lightTex) ctx.light.gl.deleteTexture(lightTex);
      if (shadowTex && ctx.shadow) ctx.shadow.gl.deleteTexture(shadowTex);
    },
  };
}

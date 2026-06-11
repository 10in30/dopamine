/**
 * Generic fullscreen-pass runner — the shared backbone for PURE-SHADER effects.
 *
 * A pure-shader effect (Solarbloom, Calligraphic Verdict, the Fail stamp) is a
 * full-screen triangle that runs a fragment shader twice — once into the light
 * (screen) context and, when present, once into the shadow (multiply) context.
 * Before this runner, each effect hand-wired the SAME plumbing: link/bind the
 * program + VAO, set the standard uniforms (resolution, origin, time, life,
 * envelope amp, palette, style, the shadow-pass uniforms), upload + bind any aux
 * textures (a baked SDF icon) into BOTH contexts, run the two passes, and free
 * the per-fire GPU resources. That ~120 lines of identical glue is now here,
 * once.
 *
 * What stays per-effect (the honest boundary): the GLSL itself, and a tiny
 * `frame()` hook that computes the genuinely effect-specific TIME-VARYING values
 * (which envelope, which confirm/draw/stamp progress, any shake) into named
 * uniforms. Everything else — standard uniforms, scalar `render.params` →
 * `u<Name>` auto-binding, aux-texture upload/bind, the light+shadow loop, the
 * "animate on twos" stepping, dispose — is generic and data-driven from a small
 * config object.
 *
 * The output is byte-identical to the bespoke renderers it replaces: it sets the
 * same uniforms, in a superset that the shader samples by name, and uses the same
 * `shadowGeometry` / envelope / progress math (supplied by the config).
 */

import { NPR_TIME_STEP_MS } from "../engine/tempo.js";
import type { DecodedSdf } from "../engine/sdf.js";
import type { RGB } from "../engine/color.js";
import type { GLContext } from "../engine/context.js";
import type { EffectContext, EffectInstance } from "./effect.js";
import {
  STANDARD_COMMON,
  allocTexture,
  applyFloatMap,
  beginProgram,
  bindFrameUniforms,
  bindPalette,
  bindScalars,
  bindShadowGeometry,
  bindTarget,
  computeScalarBinds,
} from "./pass-common.js";

/** A resolved param bag (the loader's output + any composed fields). */
export type PassParams = Record<string, unknown> & {
  durationMs: number;
  palette: [RGB, RGB, RGB] | RGB[];
  style: number;
};

/** Per-frame timing context handed to a config's `frame()` hook. */
export interface FrameInfo {
  /** The "on twos"-snapped animation clock in ms (stepping already applied). */
  animMs: number;
  /** Normalized life 0..1 (animMs / durationMs, clamped). */
  life: number;
  /**
   * The REAL un-stepped wall clock in ms (the raw `renderAt` argument, before
   * the "on twos" snap). Mirrors the Swift/Android runners, which hand their
   * `frame()` hooks the same un-stepped clock for stamp/shake-style timing.
   */
  elapsedMs: number;
}

/**
 * An aux texture the shader samples. Two sources fit the same model:
 *   - `kind:"sdf"`  — a baked single-channel R8 distance field (an icon outline),
 *   - `kind:"canvas"` — an RGBA Canvas2D source (a rasterized glyph, a panel).
 * The runner uploads it into BOTH the light and shadow contexts (canvas sources
 * upload once, on first bind, then cache), binds it on each pass, and computes
 * per-pass derived uniforms (px ranges that depend on the live canvas size).
 */
export type AuxTextureSpec =
  | {
      kind: "sdf";
      /** Texture unit to bind on (e.g. 1 for TEXTURE1). */
      unit: number;
      /** The decoded SDF to upload as an R8 single-channel texture. */
      sdf: DecodedSdf;
      /** Sampler uniform name (bound to `unit`). */
      sampler: string;
      /** "On" flag uniform name (set to 1 when present). */
      onUniform?: string;
      /** Per-pass scalar uniforms (canvas-size-dependent). */
      uniforms?(canvas: HTMLCanvasElement, params: PassParams): Record<string, number>;
    }
  | {
      kind: "canvas";
      unit: number;
      /** The Canvas2D source uploaded as an RGBA texture. */
      source: HTMLCanvasElement;
      sampler: string;
      onUniform?: string;
      uniforms?(canvas: HTMLCanvasElement, params: PassParams): Record<string, number>;
    };

/** Config for one pure-shader effect. The genuinely code-shaped bits live here. */
export interface PassConfig {
  /** Vertex + fragment GLSL (the per-effect look — code under this boundary). */
  vertex: string;
  fragment: string;
  /** Every uniform name the shader reads (for location pre-resolution). */
  uniforms: readonly string[];
  /**
   * Whether the shader reads `uOrigin` (anchored radial effects do; a gesture
   * that composes across the whole surface does not). Default false.
   */
  usesOrigin?: boolean;
  /**
   * The seamless loop period in ms (`tempo.loop.periodMs`) for a CONTINUOUS
   * effect. When set, the runner computes the standard periodic clock uniforms
   * each frame from the snapped clock: `uLoopS` (seconds within the current
   * loop) and `uPhase` (normalized [0, 1)) — so a looping shader needs no
   * per-effect period plumbing. Absent for one-shot effects.
   */
  loopPeriodMs?: number;
  /**
   * Explicit `param name → uniform name` overrides for the auto scalar binding.
   * By convention a numeric param `bloomRadius` binds to `uBloomRadius`; list an
   * entry here only for exceptions (e.g. `inkSeed → uSeed`). Map to `null` to
   * NOT bind a param to any uniform (e.g. a scatter seed the shader ignores).
   */
  bindings?: Record<string, string | null>;
  /** Declared aux textures (baked SDF icons), uploaded to light + shadow. */
  auxTextures?(params: PassParams, ctx: EffectContext): AuxTextureSpec[];
  /**
   * Extra per-pass scalar uniforms that depend on the live canvas size but are
   * NOT tied to an aux texture (e.g. an icon box size the shader uses even in its
   * SDF-less analytic fallback). Computed once per pass.
   */
  passUniforms?(canvas: HTMLCanvasElement, params: PassParams): Record<string, number>;
  /**
   * The shadow occluder "height" as a fraction of min canvas dim — Solarbloom's
   * bloom radius, Verdict's stroke scale, a constant for the Fail stamp.
   */
  shadowHeightFrac: number | ((params: PassParams) => number);
  /**
   * Compute the genuinely effect-specific TIME-VARYING uniforms for a frame
   * (the envelope amp, confirm/draw/stamp progress, shake, …). Returns a map of
   * uniform name → float. `amp` is returned under a well-known key so the runner
   * can feed it into `shadowGeometry`.
   */
  frame(info: FrameInfo, params: PassParams): { amp: number } & Record<string, number>;
  /**
   * OPTIONAL dynamic sprite panel. A full-screen pass effect whose look is mostly
   * procedural (a bloom, a flash) but which also has a SPARSE element layer (motes,
   * sparks) shouldn't loop those elements at every pixel — that's O(pixels ×
   * elements). Instead it rasterizes them into an offscreen Canvas2D ONCE per frame
   * here; the runner uploads that canvas into BOTH passes and binds it as `sampler`
   * on `unit`, and the shader samples it. (This is the pass-runner analogue of the
   * hybrid panel-runner, but it COMPOSES with the static aux textures above — e.g.
   * solarbloom keeps its baked-SDF/glyph checkmark AND gains a mote panel.)
   */
  panel?: {
    /** Texture unit to bind the panel on (distinct from any auxTextures unit). */
    unit: number;
    /** Sampler uniform name the shader reads the panel from. */
    sampler: string;
    /** Draw one frame of the sprite layer into the offscreen canvas. */
    draw(
      panelCtx: CanvasRenderingContext2D,
      width: number,
      height: number,
      params: PassParams,
      info: FrameInfo & { centerPx: { x: number; y: number }; dpr: number },
    ): void;
  };
  /**
   * OPTIONAL per-frame ARRAY uniforms (vec2/3/4 arrays). For effects that
   * precompute geometry on the CPU each frame and feed it to the shader as a
   * uniform array — e.g. lightning's bolt polyline, far cheaper than re-deriving
   * it with `fbm` at every pixel. Computed ONCE per frame and bound (uniformNfv)
   * in both passes. `geom` carries the live canvas size + the gl-coords strike
   * origin (anchor). Each returned `name` must also appear in `uniforms`.
   */
  frameArrays?(
    info: FrameInfo,
    params: PassParams,
    geom: { width: number; height: number; dpr: number; origin: { x: number; y: number } },
  ): ReadonlyArray<{ name: string; size: 2 | 3 | 4; data: Float32Array }>;
}

// The pure-shader runner adds `uOrigin` (anchored radial effects) to the shared
// standard set.
const STANDARD = ["uOrigin", ...STANDARD_COMMON] as const;

/** Upload a decoded SDF as a single-channel R8 texture (FLIP_Y, edge-clamped). */
function uploadSdf(glc: GLContext, sdf: DecodedSdf): WebGLTexture {
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

/**
 * Build a drawable {@link EffectInstance} for a pure-shader effect from its
 * config + resolved params + the runtime context. This is the `create()` an
 * effect (or a registered program) hands to the conductor.
 */
export function createPassInstance(
  config: PassConfig,
  params: PassParams,
  ctx: EffectContext,
): EffectInstance {
  const pal = params.palette as RGB[];
  const dpr = ctx.dpr;
  const panelCfg = config.panel;
  const allUniforms = [
    ...new Set([...STANDARD, ...config.uniforms, ...(panelCfg ? [panelCfg.sampler] : [])]),
  ];

  // Optional dynamic sprite panel (drawn once per frame, uploaded to both passes).
  const panelCanvas = panelCfg ? document.createElement("canvas") : null;
  const panelCtx2d = panelCanvas ? panelCanvas.getContext("2d", { alpha: true }) : null;
  const panelTexLight = panelCfg ? allocTexture(ctx.light) : null;
  const panelTexShadow = panelCfg && ctx.shadow ? allocTexture(ctx.shadow) : null;

  // The numeric params that auto-bind to a uniform: `name → u<Name>` unless an
  // explicit binding overrides it (or maps it to null to skip).
  const scalarBinds = computeScalarBinds(params, config.bindings ?? {});

  // Aux textures. SDF sources upload up front (static R8 data); canvas sources
  // allocate the texture now but upload pixels lazily on first bind (the canvas
  // may still be drawn after create()).
  const auxSpecs = config.auxTextures?.(params, ctx) ?? [];
  interface AuxLive { spec: AuxTextureSpec; light: WebGLTexture; shadow: WebGLTexture | null }
  const uploaded = new WeakSet<WebGLTexture>();
  const aux: AuxLive[] = auxSpecs.map((spec) => {
    if (spec.kind === "sdf") {
      return { spec, light: uploadSdf(ctx.light, spec.sdf), shadow: ctx.shadow ? uploadSdf(ctx.shadow, spec.sdf) : null };
    }
    return { spec, light: allocTexture(ctx.light), shadow: ctx.shadow ? allocTexture(ctx.shadow) : null };
  });

  const heightFrac = (): number =>
    typeof config.shadowHeightFrac === "function" ? config.shadowHeightFrac(params) : config.shadowHeightFrac;

  const bindFrameArrays = (
    gl: WebGL2RenderingContext,
    u: Record<string, WebGLUniformLocation | null>,
    arrays: ReadonlyArray<{ name: string; size: 2 | 3 | 4; data: Float32Array }> | undefined,
  ): void => {
    if (!arrays) return;
    for (const a of arrays) {
      const loc = u[a.name];
      if (!loc) continue;
      if (a.size === 2) gl.uniform2fv(loc, a.data);
      else if (a.size === 3) gl.uniform3fv(loc, a.data);
      else gl.uniform4fv(loc, a.data);
    }
  };

  const drawPass = (
    glc: GLContext,
    info: FrameInfo,
    frameUniforms: { amp: number } & Record<string, number>,
    isShadow: boolean,
    frameArrs?: ReadonlyArray<{ name: string; size: 2 | 3 | 4; data: Float32Array }>,
  ): void => {
    const { gl } = glc;
    const c = glc.canvas;
    const { u } = beginProgram(glc, config.vertex, config.fragment, allUniforms);

    // Aux textures (baked SDF icons / rasterized canvas glyphs).
    for (const a of aux) {
      const tex = isShadow ? a.shadow : a.light;
      if (tex) {
        gl.activeTexture(gl.TEXTURE0 + a.spec.unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // Canvas sources upload their pixels lazily, once per texture.
        if (a.spec.kind === "canvas" && !uploaded.has(tex)) {
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a.spec.source);
          uploaded.add(tex);
        }
        const loc = u[a.spec.sampler];
        if (loc) gl.uniform1i(loc, a.spec.unit);
      }
      if (a.spec.onUniform && u[a.spec.onUniform]) gl.uniform1f(u[a.spec.onUniform], tex ? 1 : 0);
      applyFloatMap(gl, u, a.spec.uniforms?.(c, params));
    }

    // Dynamic sprite panel (drawn this frame in renderAt): upload + bind here.
    if (panelCfg && panelCanvas) {
      const tex = isShadow ? panelTexShadow : panelTexLight;
      if (tex) {
        gl.activeTexture(gl.TEXTURE0 + panelCfg.unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panelCanvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        if (u[panelCfg.sampler]) gl.uniform1i(u[panelCfg.sampler], panelCfg.unit);
      }
    }

    // Extra per-pass scalar uniforms (canvas-size-dependent, non-aux).
    applyFloatMap(gl, u, config.passUniforms?.(c, params));

    // Standard uniforms.
    gl.uniform2f(u.uResolution, c.width, c.height);
    bindTarget(gl, u, c, ctx.targetSize, dpr);
    if (config.usesOrigin && u.uOrigin) {
      // gl_FragCoord origin is bottom-left, so flip the anchor's y.
      gl.uniform2f(u.uOrigin, ctx.anchor.x * dpr, c.height - ctx.anchor.y * dpr);
    }
    gl.uniform1f(u.uLife, info.life);
    gl.uniform1f(u.uTimeS, info.animMs / 1000);
    if (config.loopPeriodMs) {
      // Standard periodic clocks for a looping effect, off the SAME snapped
      // clock as uTimeS (so the on-twos seam guarantee carries over).
      const loopMs = info.animMs % config.loopPeriodMs;
      gl.uniform1f(u.uLoopS, loopMs / 1000);
      gl.uniform1f(u.uPhase, loopMs / config.loopPeriodMs);
    }
    gl.uniform1f(u.uStyle, params.style);
    bindPalette(gl, u, pal);
    bindScalars(gl, u, params, scalarBinds);
    bindFrameUniforms(gl, u, frameUniforms);
    bindFrameArrays(gl, u, frameArrs);

    gl.uniform1f(u.uShadow, isShadow ? 1 : 0);
    if (isShadow) bindShadowGeometry(gl, u, c, heightFrac(), frameUniforms.amp, params.style);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let disposed = false;
  return {
    durationMs: params.durationMs,
    renderAt(elapsedMs: number): void {
      if (disposed) return;
      // "Animate on twos": snap the clock toward a coarse grid as style rises.
      const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
      const animMs = elapsedMs + (stepped - elapsedMs) * params.style;
      const life = Math.min(Math.max(animMs, 0) / params.durationMs, 1);
      const info: FrameInfo = { animMs, life, elapsedMs };
      const frameUniforms = config.frame(info, params);
      // Draw the dynamic sprite panel once (shared by both passes), if present.
      if (panelCfg && panelCanvas && panelCtx2d) {
        const c = ctx.light.canvas;
        if (panelCanvas.width !== c.width || panelCanvas.height !== c.height) {
          panelCanvas.width = c.width;
          panelCanvas.height = c.height;
        }
        const centerPx = { x: ctx.anchor.x * dpr, y: ctx.anchor.y * dpr };
        panelCfg.draw(panelCtx2d, c.width, c.height, params, { ...info, centerPx, dpr });
      }
      // Per-frame array uniforms (CPU-precomputed geometry), computed once.
      const c = ctx.light.canvas;
      const origin = { x: ctx.anchor.x * dpr, y: c.height - ctx.anchor.y * dpr };
      const frameArrs = config.frameArrays?.(info, params, { width: c.width, height: c.height, dpr, origin });
      if (ctx.shadow) drawPass(ctx.shadow, info, frameUniforms, true, frameArrs);
      drawPass(ctx.light, info, frameUniforms, false, frameArrs);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const a of aux) {
        ctx.light.gl.deleteTexture(a.light);
        if (a.shadow && ctx.shadow) ctx.shadow.gl.deleteTexture(a.shadow);
      }
      if (panelTexLight) ctx.light.gl.deleteTexture(panelTexLight);
      if (panelTexShadow && ctx.shadow) ctx.shadow.gl.deleteTexture(panelTexShadow);
    },
  };
}

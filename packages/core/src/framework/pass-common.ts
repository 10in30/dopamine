/**
 * Shared plumbing for the two generic effect runners (pass-runner + panel-runner).
 *
 * The pure-shader runner (a full-screen triangle) and the Canvas2D-panel runner
 * (an uploaded panel texture, then the same triangle) differ only in WHAT they
 * upload/sample and one standard uniform (`uOrigin` vs `uCenter`). Everything
 * else — the `name → u<Name>` scalar auto-binding, the palette + life/time/style
 * standard uniforms, the per-frame uniform application, the shadow-pass geometry
 * uniforms, and a linear/edge-clamped texture allocator — is identical glue and
 * lives here ONCE so the two runners can't drift.
 *
 * The functions are deliberately tiny imperative helpers over a resolved uniform
 * map (`u`) so the call order in each runner stays explicit and the emitted GL
 * uniform writes remain byte-identical to the bespoke renderers these replaced.
 */

import { shadowGeometry } from "../engine/shadow.js";
import { dopLightOutGLSL } from "../engine/look/glsl.js";
import type { RGB } from "../engine/color.js";
import type { CachedProgram, GLContext } from "../engine/context.js";

// Cache the (idempotent) source transform by `${luminance} ${fragment}` so
// repeated fires of the same effect+backdrop don't re-run the regex; the
// GLContext program cache keys on the transformed source, so each distinct
// backdrop links its own variant once.
const compositeFragCache = new Map<string, string>();

/**
 * Rewrite a light fragment for the BACKDROP-aware (premultiplied source-over)
 * path: swap the opaque `fragColor = vec4(col, 1.0)` / `vec4(max(col,0.0),1.0)`
 * emit for `fragColor = dopLightOut(col)` (alpha = brightness) and inject the
 * `dopLightOut` helper. This is the same emit swap the Android build applies
 * (`tools/dopamine/src/android-shader.mjs`), so the web backdrop path and the
 * native overlays share one premultiplied-light convention.
 *
 * `luminance` (the backdrop's relative luminance, 0..1) is BAKED into the
 * injected helper as a literal so the saturation + presence boost ramps with how
 * light the surface is (vivid colour on white instead of pale wash); at 0 the
 * helper is byte-equivalent to plain `dopLightOut`, so a dark backdrop is
 * unchanged. (Native stacks drive the same math from a uniform — see
 * `dopLightOutGLSL`.)
 *
 * The emit replace is global on purpose: a hybrid's shader has a SHADOW branch
 * with its own opaque emit, but the light pass runs with `uShadow == 0` so that
 * branch is dead code here — rewriting it is harmless, and it guarantees the
 * LIVE light-path emit (wherever it sits in the source) is the premultiplied
 * one. The shadow CONTEXT keeps the original, untouched fragment.
 */
export function compositeLightFragment(fragment: string, luminance: number): string {
  const key = `${luminance.toFixed(4)} ${fragment}`;
  const cached = compositeFragCache.get(key);
  if (cached) return cached;
  let out = fragment
    .replace(/fragColor\s*=\s*vec4\(\s*max\(\s*(\w+)\s*,\s*0\.0\s*\)\s*,\s*1\.0\s*\)\s*;/g, "fragColor = dopLightOut($1);")
    .replace(/fragColor\s*=\s*vec4\(\s*(\w+)\s*,\s*1\.0\s*\)\s*;/g, "fragColor = dopLightOut($1);");
  // Only inject the helper if we actually swapped an emit (an effect that
  // already emits premultiplied light — e.g. a `vec4(col, brightness)` — is
  // left exactly as-is and needs no helper).
  if (out !== fragment) {
    out = out.replace(/\nvoid main\s*\(/, "\n" + dopLightOutGLSL(luminance.toFixed(4)) + "\nvoid main(");
  }
  compositeFragCache.set(key, out);
  return out;
}

/** A resolved uniform-location map (the output of `CachedProgram.uniforms`). */
export type UniformMap = Record<string, WebGLUniformLocation | null>;

/** `bloomRadius → uBloomRadius` — the auto-binding name convention. */
export const cap = (s: string): string => `u${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * The numeric `render.params` that auto-bind to a uniform: each `name → u<Name>`
 * unless an explicit `bindings` entry overrides the uniform name (or maps it to
 * `null` to skip — for a param the shader ignores, e.g. a scatter seed). The
 * tempo `durationMs` is never a shader uniform.
 */
export function computeScalarBinds(
  params: Record<string, unknown>,
  bindings: Record<string, string | null>,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== "number") continue;
    if (name === "durationMs") continue; // tempo, not a shader uniform
    const override = bindings[name];
    if (override === null) continue; // explicitly not a uniform
    out.push([name, override ?? cap(name)]);
  }
  return out;
}

/**
 * Resolve the program + uniform map for one pass and bind the program + the
 * shared empty VAO. Returns both so the caller can finish binding.
 */
export function beginProgram(
  glc: GLContext,
  vertex: string,
  fragment: string,
  allUniforms: readonly string[],
): { prog: CachedProgram; u: UniformMap } {
  const { gl } = glc;
  const prog = glc.program(vertex, fragment);
  const u = prog.uniforms(allUniforms);
  gl.useProgram(prog.program);
  gl.bindVertexArray(glc.vao);
  return { prog, u };
}

/** Set a float uniform iff the shader actually declares it. */
export function setF(gl: WebGL2RenderingContext, u: UniformMap, name: string, v: number): void {
  const loc = u[name];
  if (loc) gl.uniform1f(loc, v);
}

/** Apply a `{ name → float }` map, skipping uniforms the shader doesn't declare. */
export function applyFloatMap(
  gl: WebGL2RenderingContext,
  u: UniformMap,
  map: Record<string, number> | undefined,
): void {
  if (!map) return;
  for (const [n, v] of Object.entries(map)) setF(gl, u, n, v);
}

/** Bind the three palette stops (uC0/uC1/uC2). */
export function bindPalette(gl: WebGL2RenderingContext, u: UniformMap, pal: RGB[]): void {
  const [c0, c1, c2] = pal;
  if (c0) gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
  if (c1) gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
  if (c2) gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);
}

/** Bind the auto-bound scalar params (`name → uniform`). */
export function bindScalars(
  gl: WebGL2RenderingContext,
  u: UniformMap,
  params: Record<string, unknown>,
  scalarBinds: ReadonlyArray<readonly [string, string]>,
): void {
  for (const [name, uniformName] of scalarBinds) {
    const loc = u[uniformName];
    if (loc) gl.uniform1f(loc, params[name] as number);
  }
}

/**
 * Apply the per-frame uniform map from an effect's `frame()` hook. The
 * well-known key `amp` maps to `uAmp`; every other key is its own uniform name.
 */
export function bindFrameUniforms(
  gl: WebGL2RenderingContext,
  u: UniformMap,
  frameUniforms: Record<string, number>,
): void {
  for (const [n, v] of Object.entries(frameUniforms)) {
    const loc = u[n === "amp" ? "uAmp" : n];
    if (loc) gl.uniform1f(loc, v);
  }
}

/**
 * Set the shadow-pass uniforms (offset/soft/strength) from {@link shadowGeometry}.
 * Call only on the shadow pass; the caller already set `uShadow = 1`.
 */
export function bindShadowGeometry(
  gl: WebGL2RenderingContext,
  u: UniformMap,
  canvas: HTMLCanvasElement,
  heightFrac: number,
  amp: number,
  style: number,
): void {
  const minDim = Math.min(canvas.width, canvas.height);
  const sg = shadowGeometry({ minDim, heightFrac, amp, style });
  gl.uniform2f(u.uShadowOffset, sg.offsetX, sg.offsetY);
  gl.uniform1f(u.uShadowSoft, sg.soft);
  gl.uniform1f(u.uShadowStrength, sg.strength);
}

/** Allocate a linear/edge-clamped texture (pixels uploaded later by the caller). */
export function allocTexture(glc: GLContext): WebGLTexture {
  const { gl } = glc;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex!;
}

/** The standard uniforms common to BOTH runners (excludes uOrigin/uCenter). */
export const STANDARD_COMMON = [
  "uResolution", "uTarget", "uLife", "uTimeS", "uLoopS", "uPhase", "uStyle", "uAmp",
  "uC0", "uC1", "uC2", "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
  // Backdrop relative luminance (0 dark .. 1 light), from the host `backdrop`
  // option (0 when none). Lets a shader render legible GLYPHS/INK as a direct,
  // backdrop-aware colour on a light surface (see `dopMarkOut` in look/glsl.ts);
  // the native stacks already expose the same value as `u.backdropLum`.
  "uBackdropLum",
] as const;

/**
 * The targeted element's box in DEVICE px, falling back to the full canvas
 * when no element box was supplied (so untargeted fires are unchanged). The
 * single formula behind the `uTarget` standard uniform AND the `render.pass`
 * `targetMinDimPx` input — one fallback rule, never two.
 */
export function resolveTargetPx(
  c: HTMLCanvasElement,
  targetSize: { width: number; height: number } | undefined,
  dpr: number,
): { width: number; height: number } {
  return {
    width: targetSize ? targetSize.width * dpr : c.width,
    height: targetSize ? targetSize.height * dpr : c.height,
  };
}

/**
 * Bind `uTarget` — the targeted element's size (device px) the centrepiece is
 * sized to — falling back to the full canvas when no element box was supplied
 * (so untargeted fires are unchanged). Shared by both runners; a no-op for
 * shaders that don't declare it.
 */
export function bindTarget(
  gl: WebGL2RenderingContext,
  u: Record<string, WebGLUniformLocation | null>,
  c: HTMLCanvasElement,
  targetSize: { width: number; height: number } | undefined,
  dpr: number,
): void {
  if (!u.uTarget) return;
  const { width, height } = resolveTargetPx(c, targetSize, dpr);
  gl.uniform2f(u.uTarget, width, height);
}

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
import type { RGB } from "../engine/color.js";
import type { CachedProgram, GLContext } from "../engine/context.js";

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
] as const;

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
  const w = targetSize ? targetSize.width * dpr : c.width;
  const h = targetSize ? targetSize.height * dpr : c.height;
  gl.uniform2f(u.uTarget, w, h);
}

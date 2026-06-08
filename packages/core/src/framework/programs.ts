/**
 * Render-program registry — the seam that makes `loadEffect()` real.
 *
 * A `.dope` is renderer-agnostic data, but it references a SHADER PROGRAM by key
 * (`render.backends.webgl2.shader.program`, e.g. "solarbloom"). The runtime ships
 * a small set of bundled programs; each is a `create(params, ctx)` renderer (the
 * GLSL body + uniform plumbing) plus the metadata the loader needs to resolve the
 * `.dope` into that renderer's params: the per-fire scatter key (moteSeed /
 * inkSeed / …), the integer-clamp consts (MAX_MOTES / MAX_DROPS), whether it
 * casts a shadow, and its reduced-motion peak.
 *
 * Built-in effects register their renderer here (in addition to registering
 * themselves as an `EffectFactory`), so `loadEffect(anyDopeDoc)` can bind an
 * arbitrary, host-authored `.dope` to a bundled program with NO new code — the
 * whole point of the format. This is "the format references shader bodies; it is
 * not a transpiler" made concrete: the doc carries data + a program key; the
 * runtime owns the GLSL the key resolves to.
 */

import type { EffectContext, EffectInstance } from "./effect.js";

/** A bundled renderer + the metadata the loader needs to feed it from a `.dope`. */
export interface RenderProgram<Params = Record<string, unknown>> {
  /** Build a drawable instance from resolved params (same shape as EffectFactory.create). */
  create(params: Params, ctx: EffectContext): EffectInstance;
  /** The per-fire scatter-offset key this renderer reads (moteSeed / inkSeed / …). */
  scatterKey: string;
  /** Integer-clamp constants referenced by the `.dope` mapping (MAX_MOTES, …). */
  consts: Record<string, number>;
  /** Whether the renderer wants a shadow (multiply) companion canvas. Default true. */
  castsShadow?: boolean;
  /** Reduced-motion peak/hold (ms). */
  reducedMotion?: { holdMs?: number; peakMs?: number };
  /**
   * Optional hook to compose NON-numeric, code-shaped params on top of the
   * loader's numeric/palette bag (e.g. Solarbloom's whimsy-picked check glyph,
   * Comic's word + typography). Pure; receives the feeling. Most data-driven
   * effects (incl. the fail effect) need none.
   */
  composeParams?(
    numeric: Record<string, unknown>,
    feeling: { mood: string; intensity: number; whimsy: number; seed: number },
  ): Record<string, unknown>;
}

const programs = new Map<string, RenderProgram>();

/** Register (or override) a bundled render program by key. */
export function registerProgram<P>(name: string, program: RenderProgram<P>): RenderProgram<P> {
  programs.set(name, program as RenderProgram);
  return program;
}

/** Look up a bundled render program by key. */
export function getProgram(name: string): RenderProgram | undefined {
  return programs.get(name);
}

/** Names of all registered render programs. */
export function programNames(): string[] {
  return [...programs.keys()];
}

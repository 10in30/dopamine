/**
 * Ripple (the tactile "droplet in a still pool" acknowledge effect) as an
 * `EffectFactory` on the Dopamine backbone.
 *
 * Fully DATA-DRIVEN: its mood→params mapping + OKLCH palette live in
 * ripple.dope.json (loader-resolved). ALL renderer plumbing — program/VAO,
 * standard uniforms (incl. `uOrigin`, since the waves emanate from the fire
 * point), the light + subtle shadow loop, dispose — is the shared
 * `createPassInstance` generic fullscreen-pass runner. The only code that
 * remains is the water SHADER + a small config naming its scalar params, its
 * shadow height, and the per-frame held-breath envelope timing.
 *
 * Anchored at `uOrigin` (usesOrigin: true): concentric wavefronts expand from
 * the action point. Distinct from Solarbloom's soft radial CORE — Ripple's light
 * lives only on thin, moving ring crests + the caustics they refract.
 */

import { RIPPLE_FRAGMENT_SRC, RIPPLE_VERTEX_SRC, MAX_RINGS } from "./ripple-shader.js";
import {
  envelope,
  registerEffect,
  registerProgram,
  parseDope,
  resolveDopeParams,
  createPassInstance,
  type EffectContext,
  type EffectFactory,
  type EffectInstance,
  type FeelingInput,
  type PassConfig,
  type PassParams,
} from "@dopamine/core";
import doc from "./ripple.dope.json";

// Ripple is fully DATA-DRIVEN from ripple.dope.json (loader-resolved params).
const DOPE = parseDope(doc as object);

// Loop-cap consts the loader's clampMax/clampMin nodes reference. MAX_RINGS is
// the single source of truth shared with the GLSL `#define`.
const MIN_RINGS = 2;
const CONSTS = { MAX_RINGS, MIN_RINGS };

/** The resolved render params Ripple's shader consumes. */
interface RippleParams extends PassParams {
  exposure: number;
  amplitude: number;
  rings: number;
  wavelength: number;
  speed: number;
  caustic: number;
  overshoot: number;
  rippleSeed: number;
}

function resolveFromDope(feeling: FeelingInput): RippleParams {
  return resolveDopeParams(DOPE, feeling, CONSTS, "rippleSeed") as unknown as RippleParams;
}

const CONFIG: PassConfig = {
  vertex: RIPPLE_VERTEX_SRC,
  fragment: RIPPLE_FRAGMENT_SRC,
  uniforms: [
    "uExposure", "uAmplitude", "uRings", "uWavelength", "uSpeed", "uCaustic", "uSeed",
  ],
  usesOrigin: true,
  // rippleSeed binds to uSeed (the per-fire hash); overshoot feeds the envelope,
  // not a uniform.
  bindings: { rippleSeed: "uSeed", overshoot: null },
  // The wave field's outward reach (≈ rings * wavelength) sets the occluder
  // "height" the troughs cast their faint shadow over.
  shadowHeightFrac: (params) => {
    const p = params as unknown as RippleParams;
    return Math.min(p.wavelength * p.rings * 0.6 + p.amplitude * 0.3, 1);
  },
  frame: ({ life }, params) => ({
    amp: envelope(life, (params as unknown as RippleParams).overshoot),
  }),
};

function createInstance(params: RippleParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params as unknown as PassParams, ctx);
}

export const ripple: EffectFactory<RippleParams> = {
  name: "ripple",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 280, holdMs: 380 },
};

// Expose the renderer as a bundled PROGRAM so `loadEffect()` can bind an
// arbitrary host-authored `.dope` (one that references program "ripple") to it
// with no code.
registerProgram<RippleParams>("ripple", {
  create: createInstance,
  scatterKey: "rippleSeed",
  consts: CONSTS,
  reducedMotion: { peakMs: 280, holdMs: 380 },
});

export default registerEffect(ripple);

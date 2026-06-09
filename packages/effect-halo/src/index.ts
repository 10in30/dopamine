/**
 * Halo (the calm ambient "loading" indicator) as an `EffectFactory` on the
 * Dopamine backbone.
 *
 * Fully DATA-DRIVEN: its mood→params mapping + OKLCH palette live in
 * halo.dope.json (loader-resolved). ALL renderer plumbing — program/VAO,
 * standard uniforms (incl. `uOrigin`, since the ring is anchored on the fire
 * point), the light + subtle shadow loop, dispose — is the shared
 * `createPassInstance` generic fullscreen-pass runner. The only code that remains
 * is the ring SHADER + a small config naming its scalar params, its shadow
 * height, and the per-frame STEADY breathe gate.
 *
 * CONTINUOUS / LOOPING. Halo is Dopamine's first continuous effect: every other
 * effect is a one-shot reward moment gated by `amp = envelope(life)` (a 0→peak→0
 * fade). Halo instead drives all motion off PERIODIC functions of `uTimeS` in the
 * shader and returns a STEADY periodic `amp` from `frame()` (haloBreathe), so it
 * LOOPS SEAMLESSLY: the `.dope` sets `period = 1.5 s` and `durationMs = 6000` (= 4
 * periods), and 1.5 s is exactly 18 "animate-on-twos" steps, so the frame at
 * `t == durationMs` matches `t == 0` at every whimsy. A host loops it by re-firing
 * or by a long duration.
 */

import { HALO_FRAGMENT_SRC, HALO_VERTEX_SRC } from "./halo-shader.js";
import { haloBreathe } from "./halo-tempo.js";
import {
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
import doc from "./halo.dope.json";

// Halo is fully DATA-DRIVEN from halo.dope.json (loader-resolved params).
const DOPE = parseDope(doc as object);

// Halo references no clamp consts (no loop-cap `#define`); the empty bag keeps
// the resolve call shape identical to the other effects.
const CONSTS = {};

/** The resolved render params Halo's shader consumes. */
interface HaloParams extends PassParams {
  exposure: number;
  ringRadius: number;
  ringWidth: number;
  breathe: number;
  sweepArc: number;
  sweepTurns: number;
  glow: number;
  period: number;
  haloSeed: number;
}

function resolveFromDope(feeling: FeelingInput): HaloParams {
  return resolveDopeParams(DOPE, feeling, CONSTS, "haloSeed") as unknown as HaloParams;
}

const CONFIG: PassConfig = {
  vertex: HALO_VERTEX_SRC,
  fragment: HALO_FRAGMENT_SRC,
  uniforms: [
    "uExposure", "uRingRadius", "uRingWidth", "uBreathe", "uSweepArc", "uSweepTurns",
    "uGlow", "uPeriod",
  ],
  usesOrigin: true,
  // haloSeed feeds the seeded palette only; the shader reads no seed uniform.
  bindings: { haloSeed: null },
  // A thin floating loop throws a small shadow; key its occluder "height" to the
  // ring's outer reach (radius + a little width).
  shadowHeightFrac: (params) => {
    const p = params as unknown as HaloParams;
    return Math.min(p.ringRadius + p.ringWidth * 2, 1);
  },
  // CONTINUOUS: a STEADY periodic breathe gate driven off elapsed seconds — NOT
  // `envelope(life)`. `animMs/1000` is the seconds clock the shader also reads as
  // `uTimeS`; haloBreathe is periodic with `period`, so the loop seam is exact.
  frame: ({ animMs }, params) => {
    const p = params as unknown as HaloParams;
    return { amp: haloBreathe(animMs / 1000, p.period) };
  },
};

function createInstance(params: HaloParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params as unknown as PassParams, ctx);
}

export const halo: EffectFactory<HaloParams> = {
  name: "halo",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  // Reduced motion: a continuous loader has no "peak"; hold a calm single frame
  // briefly (the conductor draws one frame then holds).
  reducedMotion: { peakMs: 0, holdMs: 600 },
};

// Expose the renderer as a bundled PROGRAM so `loadEffect()` can bind an
// arbitrary host-authored `.dope` (one that references program "halo") to it
// with no code.
registerProgram<HaloParams>("halo", {
  create: createInstance,
  scatterKey: "haloSeed",
  consts: CONSTS,
  reducedMotion: { peakMs: 0, holdMs: 600 },
});

export default registerEffect(halo);

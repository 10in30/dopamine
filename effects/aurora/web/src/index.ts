/**
 * Aurora — a calm success / ambient effect rendered through the generic
 * fullscreen pass runner.
 *
 * Hanging CURTAINS of polar light drape across the upper field, sway and sweep
 * sideways, then gently brighten and fade. It is DIRECTIONAL/curtain — a
 * horizontal band of vertical light ribbons with soft vertical striations —
 * deliberately NOT a radial bloom (it composes across the whole upper surface,
 * so it ignores the anchor: no origin).
 *
 * Like the other pure-shader effects, everything that can be data IS data:
 * params come from aurora.dope.json via the loader. The only code is the GLSL
 * curtain SHADER + this tiny config naming its scalar params, its (faint) shadow
 * height, and the per-frame envelope + accumulated sideways SWEEP.
 *
 * Feeling mapping:
 *   - mood     → palette + baselines: serene = cool green/teal/blue,
 *                celebratory = balanced multi-hue, electric = vivid magenta/teal.
 *   - intensity→ brightness (uExposure) + curtain coverage/height (uCoverage,
 *                uBandHeight, ribbon count) + drift (uSway) + overshoot.
 *   - whimsy   → uStyle: photoreal soft volumetric curtains (0) → stylized hard
 *                cel / posterized ribbons (1); the pass runner also snaps the
 *                clock "on twos" as style rises.
 */

import { AURORA_FRAGMENT_SRC, AURORA_VERTEX_SRC, MAX_CURTAINS } from "./aurora-shader.js";
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
import doc from "./aurora.dope.json";

const DOPE = parseDope(doc as object);

/** Resolved aurora params: the loader output + the named scatter seed. */
interface AuroraParams extends PassParams {
  exposure: number;
  overshoot: number;
  coverage: number;
  bandY: number;
  bandHeight: number;
  sway: number;
  striation: number;
  rays: number;
  auroraSeed: number;
}

/** Sideways sweep speed (fraction of width per second). Slow, ambient drift. */
const SWEEP_SPEED = 0.02;

const CONFIG: PassConfig = {
  vertex: AURORA_VERTEX_SRC,
  fragment: AURORA_FRAGMENT_SRC,
  uniforms: [
    "uExposure", "uCoverage", "uBandY", "uBandHeight", "uSway",
    "uSweep", "uStriation", "uRays", "uSeed",
  ],
  // auroraSeed binds to uSeed (not uAuroraSeed); overshoot feeds the envelope.
  bindings: { auroraSeed: "uSeed", overshoot: null },
  // A real aurora barely occludes; the shader scales the cast shadow down hard,
  // so a modest height keeps the faint floating read without a heavy silhouette.
  shadowHeightFrac: (params) => (params as AuroraParams).bandHeight * 0.6,
  frame: ({ animMs, life }, params) => {
    const p = params as AuroraParams;
    return {
      amp: envelope(life, p.overshoot),
      // Accumulated sideways sweep (fraction of width). Slow ambient travel; the
      // sweep eases so the curtains drift in then settle rather than scroll forever.
      uSweep: SWEEP_SPEED * (animMs / 1000) * (1.0 - 0.5 * life),
    };
  },
};

function createInstance(params: AuroraParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params as PassParams, ctx);
}

export const aurora: EffectFactory<AuroraParams> = {
  name: "aurora",
  resolve: (feeling: FeelingInput) =>
    resolveDopeParams(DOPE, feeling, { MAX_CURTAINS }, "auroraSeed") as unknown as AuroraParams,
  create: createInstance,
  // A long, gentle ambient effect: hold the calm frame a touch longer.
  reducedMotion: { peakMs: 520, holdMs: 520 },
};

// Expose as a bundled program so loadEffect() can bind host-authored aurora
// variants with no code.
registerProgram<AuroraParams>("aurora", {
  create: createInstance,
  scatterKey: "auroraSeed",
  consts: { MAX_CURTAINS },
  reducedMotion: { peakMs: 520, holdMs: 520 },
});

export default registerEffect(aurora);

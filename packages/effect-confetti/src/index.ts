/**
 * Confetti as an `EffectFactory` on the Dopamine backbone.
 *
 * The quintessential celebration: a burst of paper confetti POPS upward from the
 * action then TUMBLES DOWN under gravity with air-drag flutter — spinning
 * rectangles + petals in many OKLCH hues that sway, settle, and fade. The
 * signature is the downward, physical, fluttering fall, deliberately distinct
 * from Solarbloom's UPWARD drifting motes.
 *
 * Like the other built-ins it is DATA + a-few-lines: the mood→params mapping +
 * OKLCH palette live in confetti.dope.json (loader-resolved). ALL renderer
 * plumbing — program/VAO, standard uniforms, the light+shadow loop, dispose — is
 * the shared `createPassInstance` generic fullscreen-pass runner. The only code
 * here is the confetti SHADER + a small config naming its scalar params, its
 * shadow height, and the per-frame launch-then-fall amplitude envelope.
 */

import { CONFETTI_FRAGMENT_SRC, CONFETTI_VERTEX_SRC, MAX_PIECES } from "./confetti-shader.js";
import { confettiAmp } from "./confetti-tempo.js";
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
import doc from "./confetti.dope.json";

const DOPE = parseDope(doc as object);

interface ConfettiParams extends PassParams {
  exposure: number;
  pieceCount: number;
  spread: number;
  launchSpeed: number;
  gravity: number;
  flutter: number;
  pieceSize: number;
  spin: number;
  overshoot: number;
  pieceSeed: number;
}

// The launch-then-fall amplitude envelope `confettiAmp` is Confetti's bespoke
// timing — see ./confetti-tempo.ts.

// The launched + falling cloud spans a good chunk of the viewport; give the
// shadow a moderate occluder "height".
const SHADOW_HEIGHT_FRAC = 0.5;

const CONFIG: PassConfig = {
  vertex: CONFETTI_VERTEX_SRC,
  fragment: CONFETTI_FRAGMENT_SRC,
  uniforms: [
    "uExposure", "uPieceCount", "uSpread", "uLaunchSpeed", "uGravity",
    "uFlutter", "uPieceSize", "uSpin", "uPieceSeed",
  ],
  usesOrigin: true,
  // overshoot feeds the envelope, not a uniform; pieceSeed is the scatter offset.
  bindings: { overshoot: null, pieceSeed: "uPieceSeed" },
  shadowHeightFrac: SHADOW_HEIGHT_FRAC,
  frame: ({ life }, params) => ({
    amp: confettiAmp(life, (params as ConfettiParams).overshoot),
  }),
};

function createInstance(params: ConfettiParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params as PassParams, ctx);
}

export const confetti: EffectFactory<ConfettiParams> = {
  name: "confetti",
  resolve: (feeling: FeelingInput) =>
    resolveDopeParams(DOPE, feeling, { MAX_PIECES }, "pieceSeed") as unknown as ConfettiParams,
  create: createInstance,
  reducedMotion: { peakMs: 320, holdMs: 420 },
};

// Expose the renderer as a bundled PROGRAM so `loadEffect()` can bind an
// arbitrary host-authored `.dope` (one that references program "confetti") to it
// with no code. Purely numeric/palette params — no code-shaped composition.
registerProgram<ConfettiParams>("confetti", {
  create: createInstance,
  scatterKey: "pieceSeed",
  consts: { MAX_PIECES },
  reducedMotion: { peakMs: 320, holdMs: 420 },
});

export default registerEffect(confetti);

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

import { CONFETTI_FRAGMENT_SRC, CONFETTI_VERTEX_SRC, MAX_PIECES } from "../engine/confetti-shader.js";
import { easeOutBack, easeOutCubic } from "../engine/tempo.js";
import type { EffectContext, EffectFactory, EffectInstance, FeelingInput } from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import { registerProgram } from "../framework/programs.js";
import { parseDope, resolveDopeParams } from "../framework/loader.js";
import { createPassInstance, type PassConfig, type PassParams } from "../framework/pass-runner.js";
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

/**
 * Launch-then-fall amplitude over normalized life. Unlike Solarbloom's
 * held-breath `envelope` (which decays from its early peak), confetti must stay
 * BRIGHT through the long fall — per-piece `particleFade` in the shader handles
 * each piece dimming as it lands. So this is a sharp POP attack (overshoot at
 * launch), a near-full sustain while everything falls, then a gentle fade only at
 * the very end as the last pieces settle. Peak > 1 at the launch pop.
 */
function confettiAmp(life: number, overshoot: number): number {
  if (life <= 0 || life >= 1) return 0;
  const attack = 0.12;
  if (life < attack) {
    // Sharp pop with a little overshoot (the burst leaving the action).
    return easeOutBack(life / attack, overshoot);
  }
  // Long luminous sustain, then a soft fade over the last ~30% as pieces settle.
  const tailStart = 0.7;
  if (life < tailStart) return 1;
  const x = (life - tailStart) / (1 - tailStart);
  return 1 - easeOutCubic(x) * 0.85;
}

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

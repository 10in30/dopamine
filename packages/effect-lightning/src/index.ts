/**
 * Lightning — Dopamine's high-energy "power-up / boost" STRIKE, as an
 * `EffectFactory`. A jagged, fbm-perturbed branching electric arc cracks into the
 * action point (uOrigin) with a hard white STROBE FLASH, a few secondary forks,
 * and a brief flicker afterglow that decays. Electric OKLCH blues/violets to a
 * hot white core. Casts a hard, sharp shadow (the shadow pass).
 *
 * Like the other pure-shader effects this is DATA + a-few-lines: every scalar
 * param comes from lightning.dope.json via the loader; ALL renderer plumbing is
 * the shared `createPassInstance` fullscreen-pass runner. The only code that
 * remains is the bolt SHADER + a tiny config naming its uniforms, its shadow
 * height, and the per-frame strike/flash/envelope timing.
 *
 * mood = register: serene = a soft single cool arc; celebratory = a lively
 * branched bolt; electric = a violent multi-fork strike + bright strobe.
 * intensity = bolt thickness + branch count + flash brightness.
 * whimsy (= style) = photoreal plasma glow (0) to flat cel comic bolt + harder
 * animate-on-twos strobe (1).
 */

import { strikeProgress, flashStrobe } from "./lightning-tempo.js";
import {
  LIGHTNING_FRAGMENT_SRC,
  LIGHTNING_VERTEX_SRC,
  MAX_FORKS,
} from "./lightning-shader.js";
import { computeLightningArrays, type LightningRenderParams } from "./lightning-renderer.js";
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
import doc from "./lightning.dope.json";

const DOPE = parseDope(doc as object);

interface LightningParams extends PassParams {
  exposure: number;
  thickness: number;
  jagged: number;
  branches: number;
  flashBright: number;
  flicker: number;
  overshoot: number;
  boltSeed: number;
}

// Pure-shader pass effect, but the jagged bolt polyline (the part that used to
// cost ~220 fbm/pixel) is PRECOMPUTED on the CPU once per frame and fed to the
// shader as the uVerts/uBoltMeta array uniforms (frameArrays). The shader keeps
// the original inverse-distance plasma glow — same look, far cheaper. The .dope
// is unchanged; only the web render path moved.
const CONFIG: PassConfig = {
  vertex: LIGHTNING_VERTEX_SRC,
  fragment: LIGHTNING_FRAGMENT_SRC,
  uniforms: [
    "uStrike", "uFlash", "uThickness", "uFlashBright", "uExposure", "uSeed",
    "uVerts", "uBoltMeta",
  ],
  usesOrigin: true,
  // boltSeed binds to uSeed (halo variation); the geometry params drive the CPU
  // precompute (frameArrays), not uniforms; flicker/overshoot feed the timing.
  bindings: {
    boltSeed: "uSeed", flicker: null, overshoot: null, jagged: null, branches: null,
  },
  // A bright, fairly tall occluder so the cast shadow reads as a sharp silhouette.
  shadowHeightFrac: (params) => (params as LightningParams).thickness * 14 + 0.4,
  frame: ({ animMs, life }, params) => {
    const p = params as LightningParams;
    return {
      amp: envelope(life, p.overshoot),
      uStrike: strikeProgress(animMs),
      uFlash: flashStrobe(life, p.flicker),
    };
  },
  frameArrays: ({ animMs, life }, params, geom) => {
    const p = params as unknown as LightningRenderParams;
    const { verts, meta } = computeLightningArrays(p, geom.width, geom.height, geom.origin, animMs, life);
    return [
      { name: "uVerts", size: 2, data: verts },
      { name: "uBoltMeta", size: 4, data: meta },
    ];
  },
};

function createInstance(params: LightningParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params, ctx);
}

export const lightning: EffectFactory<LightningParams> = {
  name: "lightning",
  resolve: (feeling: FeelingInput) =>
    resolveDopeParams(DOPE, feeling, { MAX_FORKS }, "boltSeed") as unknown as LightningParams,
  create: createInstance,
  // The strike + flash land early; hold the lit afterglow briefly for reduced motion.
  reducedMotion: { peakMs: 130, holdMs: 300 },
};

// Expose as a bundled program so loadEffect() can bind host-authored lightning
// variants with no code.
registerProgram<LightningParams>("lightning", {
  create: createInstance,
  scatterKey: "boltSeed",
  consts: { MAX_FORKS },
  reducedMotion: { peakMs: 130, holdMs: 300 },
});

export default registerEffect(lightning);

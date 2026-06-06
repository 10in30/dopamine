/**
 * Fail / error effect — the emotional OPPOSITE of the three success effects.
 *
 * A red/amber ✗ cross is STAMPED in over a recoiling error flare with a sharp
 * hit + damped shake, then desaturates and collapses. Short and punchy, not a
 * celebratory bloom.
 *
 * Phase 1: this is now a DATA + a-few-lines-of-code effect. Its params/palette/
 * tempo come from fail.dope.json via the loader; its ✗ icon comes from the .dope
 * `svgPath` via the geometry→SDF seam; and ALL renderer/texture/upload/shadow
 * plumbing is the shared `createPassInstance` generic fullscreen-pass runner. The
 * only code that remains is the fail SHADER (a distinct negative feel) + a tiny
 * `config` that names the shader's uniforms, the SDF aux texture, the shadow
 * height, and the per-frame timing (stamp + shake + collapse envelope). No
 * bespoke per-effect renderer.
 */

import { failEnvelope, stampProgress, shakeOffset } from "../engine/tempo.js";
import { FAIL_FRAGMENT_SRC, FAIL_VERTEX_SRC } from "../engine/fail-shader.js";
import type { RGB } from "../engine/color.js";
import { decodeSdf, type DecodedSdf } from "../engine/sdf.js";
import type { EffectContext, EffectFactory, EffectInstance, FeelingInput } from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import { registerProgram } from "../framework/programs.js";
import { registerMood } from "../framework/mood-registry.js";
import { parseDope, resolveDopeParams, getOutline } from "../framework/loader.js";
import { createPassInstance, type PassConfig, type PassParams } from "../framework/pass-runner.js";
import doc from "./fail.dope.json";

const DOPE = parseDope(doc as object);

/** Register the fail-appropriate moods so they light up the registry (energy). */
registerMood("try-again", { hueCenter: 70, hueRange: 40, lightness: 0.78, chroma: 0.13, energy: 0.2 });
registerMood("error", { hueCenter: 40, hueRange: 36, lightness: 0.72, chroma: 0.17, energy: 0.55 });
registerMood("denied", { hueCenter: 22, hueRange: 30, lightness: 0.66, chroma: 0.21, energy: 1.0 });

/** GEOMETRY SEAM: decode the baked ✗ SDF once; the shader only samples it. */
const CROSS_SDF: DecodedSdf | null = (() => {
  const outline = getOutline(DOPE, "cross");
  if (!outline?.sdf) return null;
  try {
    return decodeSdf(outline.sdf);
  } catch {
    return null;
  }
})();

/** The fail render params (the loader bag + the typed fields the shader reads). */
interface FailParams extends PassParams {
  seed: number;
  palette: [RGB, RGB, RGB];
  exposure: number;
  severity: number;
  shakeAmount: number;
  style: number;
  failSeed: number;
}

function resolveFromDope(feeling: FeelingInput): FailParams {
  return resolveDopeParams(DOPE, feeling, {}, "failSeed") as unknown as FailParams;
}

/** Half-size of the ✗ box as a fraction of min viewport dim. */
const CROSS_BOX_FRAC = 0.15;

/** The data-driven pass config: shader + uniforms + SDF aux + per-frame timing. */
const CONFIG: PassConfig = {
  vertex: FAIL_VERTEX_SRC,
  fragment: FAIL_FRAGMENT_SRC,
  uniforms: [
    "uStamp", "uShake", "uExposure", "uSeverity",
    "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx", "uBoxPx",
  ],
  usesOrigin: true,
  // shakeAmount feeds the shake math (below), not a uniform; failSeed is unused.
  bindings: { shakeAmount: null, failSeed: null, seed: null },
  shadowHeightFrac: 0.42,
  // The ✗ box + stroke px are needed even in the analytic (SDF-less) fallback.
  passUniforms: (canvas) => {
    const px = CROSS_BOX_FRAC * Math.min(canvas.width, canvas.height);
    return { uBoxPx: px, uSdfStrokePx: px * 0.13 };
  },
  // The baked ✗ SDF (geometry seam), bound to TEXTURE1; uSdfOn + uSdfRangePx are
  // derived per pass. Absent → empty list (uSdfOn stays 0, analytic fallback).
  auxTextures: () =>
    CROSS_SDF
      ? [
          {
            kind: "sdf" as const,
            unit: 1,
            sdf: CROSS_SDF,
            sampler: "uSdfTex",
            onUniform: "uSdfOn",
            uniforms: (canvas) => {
              const px = CROSS_BOX_FRAC * Math.min(canvas.width, canvas.height);
              const vbW = CROSS_SDF.viewBox[2] || 100;
              return { uSdfRangePx: CROSS_SDF.range * ((2 * px) / vbW) };
            },
          },
        ]
      : [],
  frame: ({ animMs, life }, params) => ({
    amp: failEnvelope(life),
    uStamp: stampProgress(animMs),
    uShake: shakeOffset(animMs, (params as FailParams).shakeAmount),
  }),
};

function createInstance(params: FailParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params, ctx);
}

export const fail: EffectFactory<FailParams> = {
  name: "fail",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 200, holdMs: 320 },
};

// Bundled program so the public loadEffect() can bind a host-authored fail
// variant (recolor / re-icon / retime) to this shader with no code.
registerProgram<FailParams>("fail", {
  create: createInstance,
  scatterKey: "failSeed",
  consts: {},
  reducedMotion: { peakMs: 200, holdMs: 320 },
});

export default registerEffect(fail);

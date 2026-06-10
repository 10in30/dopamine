/**
 * Calligraphic Verdict (the ink-stroke success effect) as an `EffectFactory`.
 *
 * Phase 1: now DATA + a-few-lines. Params come from inkstroke.dope.json via the
 * loader (byte-identical to the legacy resolveInkParams); ALL renderer plumbing
 * is the shared `createPassInstance` generic fullscreen-pass runner. The only
 * code that remains is the ink SHADER + a tiny config naming its scalar params,
 * its shadow height, and the per-frame stroke-draw + envelope timing. The gesture
 * composes itself across the whole surface, so it ignores the anchor (no origin).
 */

import { strokeProgress } from "./inkstroke-tempo.js";
import type { InkRenderParams } from "./inkstroke-params.js";
import { INK_FRAGMENT_SRC, INK_VERTEX_SRC, MAX_DROPS } from "./inkstroke-shader.js";
import {
  envelope,
  registerEffect,
  parseDope,
  resolveDopeParams,
  createPassInstance,
  type EffectContext,
  type EffectFactory,
  type EffectInstance,
  type PassConfig,
  type PassParams,
} from "@dopamine/core";
import doc from "./inkstroke.dope.json";

export type { InkRenderParams } from "./inkstroke-params.js";

// Verdict is fully DATA-DRIVEN from inkstroke.dope.json (loader-resolved params
// are byte-identical to the legacy resolveInkParams — see loader.test.ts).
const DOPE = parseDope(doc as object);

function resolveFromDope(feeling: { mood: string; intensity: number; whimsy: number; seed: number }): InkRenderParams {
  return resolveDopeParams(DOPE, feeling, { MAX_DROPS }, "inkSeed") as unknown as InkRenderParams;
}

const CONFIG: PassConfig = {
  vertex: INK_VERTEX_SRC,
  fragment: INK_FRAGMENT_SRC,
  // The gesture centres on the targeted element (uOrigin) and scales to its box
  // (uTarget, a standard uniform); both default to the full canvas when untargeted.
  usesOrigin: true,
  uniforms: [
    "uDraw", "uExposure", "uScale", "uPressure", "uWetness", "uBristle",
    "uDroplets", "uSeed",
  ],
  // inkSeed binds to uSeed (not uInkSeed); overshoot feeds the envelope, not a uniform.
  bindings: { inkSeed: "uSeed", overshoot: null },
  shadowHeightFrac: (params) => (params as unknown as InkRenderParams).scale * 0.5,
  frame: ({ animMs, life }, params) => ({
    amp: envelope(life, (params as unknown as InkRenderParams).overshoot),
    uDraw: strokeProgress(animMs),
  }),
};

function createInstance(params: InkRenderParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params as unknown as PassParams, ctx);
}

export const inkstroke: EffectFactory<InkRenderParams> = {
  name: "inkstroke",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 300, holdMs: 360 },
};

export default registerEffect(inkstroke);

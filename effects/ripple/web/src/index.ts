/**
 * Ripple (the tactile "droplet in a still pool" acknowledge effect) as an
 * `EffectFactory` on the Dopamine backbone.
 *
 * FULLY DATA-DRIVEN (P2): everything that isn't the GLSL lives in
 * ripple.dope.json — the mood→params mapping + OKLCH palette (the loader), AND
 * the per-frame logic: `tempo.frame` (the held-breath envelope amp),
 * `render.shadowHeightFrac` (the wave field's outward reach), `render.consts`
 * (MAX_RINGS/MIN_RINGS), `render.config` and the uniform `binding` contract.
 * `registerDopeEffect` interprets that data through the generic
 * `createPassInstance` fullscreen-pass runner; this module is just the water
 * SHADER + the registration call.
 *
 * Anchored at `uOrigin` (usesOrigin: true): concentric wavefronts expand from
 * the action point. Distinct from Solarbloom's soft radial CORE — Ripple's light
 * lives only on thin, moving ring crests + the caustics they refract.
 */

import { RIPPLE_FRAGMENT_SRC, RIPPLE_VERTEX_SRC } from "./ripple-shader.js";
import { parseDope, registerDopeEffect, type EffectFactory, type PassParams } from "@dopamine/core";
import doc from "./ripple.dope.json";

const DOPE = parseDope(doc as object);

/** The resolved render params Ripple's shader consumes. */
export interface RippleParams extends PassParams {
  exposure: number;
  amplitude: number;
  rings: number;
  wavelength: number;
  speed: number;
  caustic: number;
  overshoot: number;
  rippleSeed: number;
}

// The whole factory (resolve / create / reducedMotion / program registration)
// is data: ripple.dope.json interpreted by the core backbone.
export const ripple = registerDopeEffect(DOPE, {
  vertex: RIPPLE_VERTEX_SRC,
  fragment: RIPPLE_FRAGMENT_SRC,
}) as EffectFactory<PassParams> as EffectFactory<RippleParams>;

export default ripple;

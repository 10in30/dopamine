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
 * FULLY DATA-DRIVEN (P2): everything that isn't the GLSL lives in
 * aurora.dope.json — the mood→params mapping + palette (the loader), AND the
 * per-frame logic: `tempo.frame` (the envelope amp + the accumulated sideways
 * sweep), `render.shadowHeightFrac`, `render.consts`, `render.config` and the
 * uniform `binding` contract. `registerDopeEffect` interprets that data through
 * the generic pass runner; this module is just the shader + the registration
 * call.
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

import { AURORA_FRAGMENT_SRC, AURORA_VERTEX_SRC } from "./aurora-shader.js";
import { parseDope, registerDopeEffect, type EffectFactory, type PassParams } from "@dopamine/core";
import doc from "./aurora.dope.json";

const DOPE = parseDope(doc as object);

/** Resolved aurora params: the loader output + the named scatter seed. */
export interface AuroraParams extends PassParams {
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

// The whole factory (resolve / create / reducedMotion / program registration)
// is data: aurora.dope.json interpreted by the core backbone.
export const aurora = registerDopeEffect(DOPE, {
  vertex: AURORA_VERTEX_SRC,
  fragment: AURORA_FRAGMENT_SRC,
}) as EffectFactory<PassParams> as EffectFactory<AuroraParams>;

export default aurora;

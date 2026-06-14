/**
 * Checkmate — a fabulous winning move: a chess QUEEN pops into place and the
 * frame erupts in LGBTQ+ pride (rainbow swoosh shockwave + spinning sunburst +
 * twinkling sparkle bling). A success effect (serene / celebratory / electric).
 *
 * FULLY DATA-DRIVEN: params/palette/tempo come from checkmate.dope.json via the
 * loader; the per-frame logic (the held-breath `amp` + the easeOutBack `pop`
 * bounce) is `tempo.frame`; the uniform binding is the `.dope` `binding`
 * contract. `registerDopeEffect` derives the whole pass config from the data —
 * this module is just the rainbow SHADER + the registration call. The chess
 * queen is analytic (2D SDFs), so the effect ships no swift/ or android/ folder.
 */

import { CHECKMATE_FRAGMENT_SRC, CHECKMATE_VERTEX_SRC } from "./checkmate-shader.js";
import { parseDope, registerDopeEffect, type EffectFactory, type PassParams } from "@dopaminefx/core";
import doc from "./checkmate.dope.json";

const DOPE = parseDope(doc as object);

/** The resolved render params Checkmate's shader consumes. */
export interface CheckmateParams extends PassParams {
  exposure: number;
  bling: number;
  swoosh: number;
  rays: number;
  spin: number;
  sizeFrac: number;
  overshoot: number;
  checkmateSeed: number;
}

// The whole factory (resolve / create / reducedMotion / program registration)
// is data: checkmate.dope.json interpreted by the core backbone.
export const checkmate = registerDopeEffect(DOPE, {
  vertex: CHECKMATE_VERTEX_SRC,
  fragment: CHECKMATE_FRAGMENT_SRC,
}) as EffectFactory<PassParams> as EffectFactory<CheckmateParams>;

export default checkmate;

/**
 * Fail / error effect — the emotional OPPOSITE of the three success effects.
 *
 * A red/amber ✗ cross is STAMPED in over a recoiling error flare with a sharp
 * hit + damped shake, then desaturates and collapses. Short and punchy, not a
 * celebratory bloom.
 *
 * FULLY DATA-DRIVEN: the params/palette/tempo come from fail.dope.json via the
 * loader; the per-frame logic — the slam/hold/collapse `amp`, the 170 ms stamp
 * and the damped recoil shake — is `tempo.frame` (stamp/shake run on the REAL
 * un-stepped `elapsedMs`, matching the Swift/Android ports); and the ✗ plumbing
 * that used to be code hooks is now data too: `render.pass` declares the
 * box/stroke/range pixel uniforms (sized to `targetMinDimPx`) and the
 * `binding.samplers` `outline`/`on` source declares the baked-SDF aux texture
 * (geometry seam). The only hand-written web sources left are this
 * registration shim (the fail moods are web-runtime-only) and the shader.
 */

import { FAIL_FRAGMENT_SRC, FAIL_VERTEX_SRC } from "./fail-shader.js";
import {
  registerDopeEffect,
  registerMood,
  parseDope,
  type RGB,
  type EffectFactory,
  type PassParams,
} from "@dopaminefx/core";
import doc from "./fail.dope.json";

const DOPE = parseDope(doc as object);

/** Register the fail-appropriate moods so they light up the registry (energy). */
registerMood("try-again", { hueCenter: 70, hueRange: 40, lightness: 0.78, chroma: 0.13, energy: 0.2 });
registerMood("error", { hueCenter: 40, hueRange: 36, lightness: 0.72, chroma: 0.17, energy: 0.55 });
registerMood("denied", { hueCenter: 22, hueRange: 30, lightness: 0.66, chroma: 0.21, energy: 1.0 });

/** The fail render params (the loader bag + the typed fields the shader reads). */
export interface FailParams extends PassParams {
  seed: number;
  palette: [RGB, RGB, RGB];
  exposure: number;
  severity: number;
  shakeAmount: number;
  style: number;
  failSeed: number;
}

// The whole factory (resolve / frame / pass uniforms / SDF aux texture /
// shadow / bindings / program registration) is data: fail.dope.json
// interpreted by the core backbone.
export const fail = registerDopeEffect(DOPE, {
  vertex: FAIL_VERTEX_SRC,
  fragment: FAIL_FRAGMENT_SRC,
}) as EffectFactory<PassParams> as EffectFactory<FailParams>;

export default fail;

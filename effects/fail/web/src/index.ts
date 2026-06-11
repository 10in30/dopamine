/**
 * Fail / error effect — the emotional OPPOSITE of the three success effects.
 *
 * A red/amber ✗ cross is STAMPED in over a recoiling error flare with a sharp
 * hit + damped shake, then desaturates and collapses. Short and punchy, not a
 * celebratory bloom.
 *
 * FULLY DATA-DRIVEN (P2) where data can reach: the params/palette/tempo come
 * from fail.dope.json via the loader, AND the per-frame logic that was
 * fail-tempo.ts — the slam/hold/collapse `amp`, the 170 ms stamp and the damped
 * recoil shake — is `tempo.frame` (stamp/shake run on the REAL un-stepped
 * `elapsedMs`, matching the Swift/Android ports), with
 * `render.shadowHeightFrac`/`config` and the uniform `binding` contract
 * alongside. What stays CODE (the honest boundary, passed as hooks): the fail
 * SHADER, plus the canvas-dependent ✗ plumbing — the baked-SDF aux texture
 * (geometry seam) and the box/stroke pass uniforms the analytic fallback needs.
 */

import { FAIL_FRAGMENT_SRC, FAIL_VERTEX_SRC } from "./fail-shader.js";
import {
  decodeSdf,
  registerDopeEffect,
  registerMood,
  parseDope,
  getOutline,
  type RGB,
  type DecodedSdf,
  type EffectFactory,
  type PassParams,
} from "@dopamine/core";
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
export interface FailParams extends PassParams {
  seed: number;
  palette: [RGB, RGB, RGB];
  exposure: number;
  severity: number;
  shakeAmount: number;
  style: number;
  failSeed: number;
}

/** Half-size of the ✗ box as a fraction of min viewport dim. */
const CROSS_BOX_FRAC = 0.15;

// The factory (resolve / frame / shadow / bindings / program registration) is
// data: fail.dope.json interpreted by the core backbone. The hooks carry the
// genuinely code-shaped ✗ plumbing (canvas-size-dependent, SDF-backed).
export const fail = registerDopeEffect(
  DOPE,
  { vertex: FAIL_VERTEX_SRC, fragment: FAIL_FRAGMENT_SRC },
  {
    hooks: {
      // The ✗ box + stroke px are needed even in the analytic (SDF-less) fallback.
      passUniforms: (canvas) => {
        const px = CROSS_BOX_FRAC * Math.min(canvas.width, canvas.height);
        return { uBoxPx: px, uSdfStrokePx: px * 0.13 };
      },
      // The baked ✗ SDF (geometry seam), bound to TEXTURE1; uSdfOn + uSdfRangePx
      // are derived per pass. Absent → empty list (uSdfOn stays 0, analytic fallback).
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
    },
  },
) as EffectFactory<PassParams> as EffectFactory<FailParams>;

export default fail;

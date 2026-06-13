/**
 * Lightning — Dopamine's high-energy "power-up / boost" STRIKE, as an
 * `EffectFactory`. A jagged, fbm-perturbed branching electric arc cracks into the
 * action point (uOrigin) with a hard white STROBE FLASH, a few secondary forks,
 * and a brief flicker afterglow that decays. Electric OKLCH blues/violets to a
 * hot white core. Casts a hard, sharp shadow (the shadow pass).
 *
 * FULLY DATA-DRIVEN: everything that isn't the GLSL or the bolt precompute
 * lives in lightning.dope.json — the mood→params mapping + palette (the
 * loader), the per-frame logic (`tempo.frame`: the impact-envelope amp, the
 * 130 ms strike crack-in and the flash/strobe — what lightning-tempo.ts used to
 * be), `render.shadowHeightFrac`, `render.consts` (MAX_FORKS),
 * `render.config`, `tempo.reducedMotion` and the uniform `binding` contract
 * (whose `arrays` section declares the uVerts/uBoltMeta frame arrays).
 * `registerDopeEffect` interprets that data through the generic pass runner.
 *
 * The one genuinely code-shaped piece is the CPU bolt precompute — the
 * fragment-independent polyline computed once per frame (lightning-logic.ts,
 * the single source the Swift/Kotlin renderers are TRANSPILED from) — which
 * rides the `hooks.frameArrays` seam here, exactly as the generated native
 * factories wire the generated renderer into their runners' frameArrays seams.
 *
 * mood = register: serene = a soft single cool arc; celebratory = a lively
 * branched bolt; electric = a violent multi-fork strike + bright strobe.
 * intensity = bolt thickness + branch count + flash brightness.
 * whimsy (= style) = photoreal plasma glow (0) to flat cel comic bolt + harder
 * animate-on-twos strobe (1).
 */

import { LIGHTNING_FRAGMENT_SRC, LIGHTNING_VERTEX_SRC } from "./lightning-shader.js";
import { computeLightningArrays } from "./lightning-logic.js";
import {
  parseDope,
  registerDopeEffect,
  type EffectFactory,
  type PassParams,
} from "@dopaminefx/core";
import doc from "./lightning.dope.json";

const DOPE = parseDope(doc as object);

export interface LightningParams extends PassParams {
  exposure: number;
  thickness: number;
  jagged: number;
  branches: number;
  flashBright: number;
  flicker: number;
  overshoot: number;
  boltSeed: number;
  style: number; // = whimsy (drives the on-twos cel jitter)
}

// The whole factory (resolve / uniforms / bindings / frame / shadow / reduced
// motion / program registration) is data: lightning.dope.json interpreted by
// the core backbone. The jagged bolt polyline (the part that used to cost
// ~220 fbm/pixel) is PRECOMPUTED on the CPU once per frame and fed to the
// shader through the binding.arrays contract (uVerts/uBoltMeta) — the
// `frameArrays` hook below is the code-shaped precompute call.
export const lightning = registerDopeEffect(
  DOPE,
  { vertex: LIGHTNING_VERTEX_SRC, fragment: LIGHTNING_FRAGMENT_SRC },
  {
    hooks: {
      frameArrays: ({ animMs, life }, params, geom) => {
        const p = params as LightningParams;
        const { verts, meta } = computeLightningArrays(
          p.style, p.thickness, p.jagged, p.branches, p.boltSeed,
          geom.width, geom.height, geom.origin.x, geom.origin.y, animMs, life,
        );
        return [
          { name: "uVerts", size: 2, data: verts },
          { name: "uBoltMeta", size: 4, data: meta },
        ];
      },
    },
  },
) as EffectFactory<PassParams> as EffectFactory<LightningParams>;

export default lightning;

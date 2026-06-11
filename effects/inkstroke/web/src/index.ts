/**
 * Calligraphic Verdict (the ink-stroke success effect) as an `EffectFactory`.
 *
 * FULLY DATA-DRIVEN (P2): everything that isn't the GLSL lives in
 * inkstroke.dope.json — the mood→params mapping + palette (the loader,
 * byte-identical to the legacy resolveInkParams), AND the per-frame logic:
 * `tempo.frame` (the envelope amp + the 360 ms ease-out-cubic stroke draw that
 * was inkstroke-tempo.ts), `render.shadowHeightFrac`, `render.consts`
 * (MAX_DROPS), `render.config` and the uniform `binding` contract.
 * `registerDopeEffect` interprets that data through the generic pass runner;
 * this module is just the ink SHADER + the registration call. The gesture
 * centres on the targeted element (uOrigin/uTarget) and defaults to the full
 * canvas when untargeted.
 *
 * NOTE: the public effect name is "inkstroke" while the `.dope` id is
 * `dopamine.success.verdict`, so the name is passed explicitly. inkstroke has
 * never exposed a bundled program (no registerProgram), so `program: false`
 * keeps the registration surface identical.
 */

import type { InkRenderParams } from "./inkstroke-params.js";
import { INK_FRAGMENT_SRC, INK_VERTEX_SRC } from "./inkstroke-shader.js";
import { parseDope, registerDopeEffect, type EffectFactory, type PassParams } from "@dopamine/core";
import doc from "./inkstroke.dope.json";

export type { InkRenderParams } from "./inkstroke-params.js";

const DOPE = parseDope(doc as object);

// The whole factory (resolve / create / reducedMotion) is data:
// inkstroke.dope.json interpreted by the core backbone.
export const inkstroke = registerDopeEffect(
  DOPE,
  { vertex: INK_VERTEX_SRC, fragment: INK_FRAGMENT_SRC },
  { name: "inkstroke", program: false },
) as EffectFactory<PassParams> as EffectFactory<InkRenderParams>;

export default inkstroke;

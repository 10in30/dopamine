/**
 * Confetti (the celebration success effect) — the DATA-DRIVEN panel factory shim.
 *
 * The quintessential celebration: a burst of paper confetti POPS upward from the
 * action then TUMBLES DOWN under gravity with air-drag flutter — spinning
 * rectangles + petals in many OKLCH hues that sway, settle, and fade. The
 * signature is the downward, physical, fluttering fall, deliberately distinct
 * from Solarbloom's UPWARD drifting motes.
 *
 * Confetti is a PANEL HYBRID, converged onto the same declarative path as
 * comic/heartburst: everything that isn't the shader or the Canvas2D draw is
 * DATA in confetti.dope.json, interpreted by the shared backbone:
 *   - the mood→params mapping + the OKLCH golden-angle palette (the loader),
 *   - the per-frame launch-then-fall amplitude (`tempo.frame.amp`, delta-0 with
 *     the old `confettiAmp` hook),
 *   - the shadow height (`render.shadowHeightFrac`), the panel wiring
 *     (`render.panel`), the no-snap clock (`render.config.stepping: "none"`),
 *     the MAX_PIECES clamp const (`render.consts`), and `tempo.reducedMotion`,
 *   - the uniform `binding` contract (the `u<Name>` list + exceptions).
 *
 * The genuinely code-shaped parts that stay JS are the GLSL (confetti-shader.ts —
 * the single source the MSL + Kotlin shaders are generated from) and the Canvas2D
 * panel draw (confetti-renderer.ts — the ballistic per-piece poses).
 */

import { CONFETTI_FRAGMENT_SRC, CONFETTI_VERTEX_SRC } from "./confetti-shader.js";
import { drawConfettiFrame, type ConfettiRenderParams } from "./confetti-renderer.js";
import { parseDope, registerDopePanelEffect, type EffectFactory } from "@dopaminefx/core";
import doc from "./confetti.dope.json";

export type { ConfettiRenderParams } from "./confetti-renderer.js";

// MAX_PIECES is the single source of truth for the panel loop bound + the integer
// clamp the `.dope` mapping references (`render.params.pieceCount.clampMax`,
// resolved from `render.consts.MAX_PIECES`). Re-exported for hosts + the renderer.
export { MAX_PIECES } from "./confetti-shader.js";

const DOPE = parseDope(doc as object);

// Registers the EffectFactory AND the bundled "confetti" program (so loadEffect()
// can bind a host-authored confetti variant — different counts/spread/palette —
// with no code). The whole factory is data + the two code-shaped hooks (shader +
// panel draw); resolve / reducedMotion / the MAX_PIECES const all come from the
// `.dope` via the shared registration tail.
export const confetti = registerDopePanelEffect(
  DOPE,
  { vertex: CONFETTI_VERTEX_SRC, fragment: CONFETTI_FRAGMENT_SRC },
  drawConfettiFrame,
) as unknown as EffectFactory<ConfettiRenderParams>;

export default confetti;

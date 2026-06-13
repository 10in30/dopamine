/**
 * Dots (the calm ambient "thinking" indicator) as an `EffectFactory` on the
 * Dopamine backbone.
 *
 * FULLY DATA-DRIVEN: everything that isn't the GLSL lives in dots.dope.json —
 * the mood→params mapping + OKLCH palette (the loader), AND the per-frame logic:
 * `tempo.frame` (the steady periodic breathe gate), `render.shadowHeightFrac`
 * (the dots' outer reach), `render.consts` (MAX_DOTS/MIN_DOTS), `render.config`
 * and the uniform `binding` contract. `registerDopeEffect` interprets that data
 * through the generic pass runner; this module is just the dot-row SHADER + the
 * registration call. No swift/ or android/ folder — those factories + the MSL /
 * Kotlin shaders are generated from this one .dope plus the GLSL source.
 *
 * CONTINUOUS / LOOPING. Dots is Dopamine's second continuous effect (after halo):
 * it declares the first-class `tempo.loop` contract (`periodMs = 1000`): the
 * parser validates the seam invariants (the period is exactly 12
 * "animate-on-twos" steps and `durationMs = 4000` is exactly 4 periods), the
 * runner derives the standard periodic clocks `uPhase`/`uLoopS` every frame, and
 * `tempo.frame.amp` is a STEADY periodic breathe of that phase —
 * `0.85 + 0.15·sin(2π·phase)` — so the frame at `t == durationMs` matches
 * `t == 0` at every whimsy. The conductor re-arms it at every `durationMs` seam;
 * the host stops it (and can pause/resume it) via the handle `play()` returns.
 */

import { DOTS_FRAGMENT_SRC, DOTS_VERTEX_SRC } from "./dots-shader.js";
import { parseDope, registerDopeEffect, type EffectFactory, type PassParams } from "@dopaminefx/core";
import doc from "./dots.dope.json";

const DOPE = parseDope(doc as object);

/** The resolved render params Dots' shader consumes. */
export interface DotsParams extends PassParams {
  exposure: number;
  dotCount: number;
  dotRadius: number;
  dotGap: number;
  breathe: number;
  chase: number;
  glow: number;
  dotsSeed: number;
}

// The whole factory (resolve / create / reducedMotion / program registration)
// is data: dots.dope.json interpreted by the core backbone.
export const dots = registerDopeEffect(DOPE, {
  vertex: DOTS_VERTEX_SRC,
  fragment: DOTS_FRAGMENT_SRC,
}) as EffectFactory<PassParams> as EffectFactory<DotsParams>;

export default dots;

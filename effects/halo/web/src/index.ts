/**
 * Halo (the calm ambient "loading" indicator) as an `EffectFactory` on the
 * Dopamine backbone.
 *
 * FULLY DATA-DRIVEN (P2): everything that isn't the GLSL lives in
 * halo.dope.json — the mood→params mapping + OKLCH palette (the loader), AND
 * the per-frame logic: `tempo.frame` (the steady periodic breathe gate that was
 * halo-tempo.ts), `render.shadowHeightFrac` (the ring's outer reach),
 * `render.config` and the uniform `binding` contract. `registerDopeEffect`
 * interprets that data through the generic pass runner; this module is just the
 * ring SHADER + the registration call.
 *
 * CONTINUOUS / LOOPING. Halo is Dopamine's first continuous effect: every other
 * effect is a one-shot reward moment gated by `amp = envelope(life)` (a 0→peak→0
 * fade). Halo instead declares the first-class `tempo.loop` contract
 * (`periodMs = 1500`): the parser validates the seam invariants (the period is
 * exactly 18 "animate-on-twos" steps and `durationMs = 6000` is exactly 4
 * periods), the runner derives the standard periodic clocks `uPhase`/`uLoopS`
 * every frame, and `tempo.frame.amp` is a STEADY periodic breathe of that
 * phase — `0.85 + 0.15·sin(2π·phase)` — so the frame at `t == durationMs`
 * matches `t == 0` at every whimsy. The conductor re-arms it at every
 * `durationMs` seam; the host stops it via the handle `play()` returns.
 */

import { HALO_FRAGMENT_SRC, HALO_VERTEX_SRC } from "./halo-shader.js";
import { parseDope, registerDopeEffect, type EffectFactory, type PassParams } from "@dopaminefx/core";
import doc from "./halo.dope.json";

const DOPE = parseDope(doc as object);

/** The resolved render params Halo's shader consumes. */
export interface HaloParams extends PassParams {
  exposure: number;
  ringRadius: number;
  ringWidth: number;
  breathe: number;
  sweepArc: number;
  sweepTurns: number;
  glow: number;
  haloSeed: number;
}

// The whole factory (resolve / create / reducedMotion / program registration)
// is data: halo.dope.json interpreted by the core backbone.
export const halo = registerDopeEffect(DOPE, {
  vertex: HALO_VERTEX_SRC,
  fragment: HALO_FRAGMENT_SRC,
}) as EffectFactory<PassParams> as EffectFactory<HaloParams>;

export default halo;

/**
 * Heartburst bespoke timing — a love / like / favorite moment.
 *
 * The shape of time is a "lub-dub" double-pulse: the heart swells on a first
 * (loud) beat, relaxes, swells again on a second (softer) beat, then on the
 * release it BURSTS into a flurry of little hearts that fly outward and fade.
 * All pure functions of normalized life so a frame is reproducible. Built on the
 * generic `easeOutCubic`/`clamp01` primitives.
 *
 *   life 0.00 .. 0.30  : LUB-DUB — two beats; the second tucked behind the first
 *   life 0.30 .. 1.00  : BURST + AFTERGLOW — little hearts fly out, big heart fades
 */

import { easeOutCubic, clamp01 } from "@dopamine/core";

/** Fraction of life occupied by the lub-dub beat phase before the burst. */
export const HEARTBEAT_PHASE = 0.3;

/**
 * A single soft beat pulse centred at `center` (in life units) with half-width
 * `width`: rises fast, eases back down. Returns 0..1 (peak 1 at `center`).
 */
function beatPulse(t: number, center: number, width: number): number {
  const x = (t - center) / width;
  if (x <= -1 || x >= 1) return 0;
  const lobe = 0.5 + 0.5 * Math.cos(x * Math.PI);
  return x < 0 ? Math.pow(lobe, 0.7) : Math.pow(lobe, 1.4);
}

/**
 * Heart SCALE multiplier over normalized life. A resting 1.0 with two beats
 * superimposed, then it settles to rest through the burst and gently shrinks as
 * it fades. `strength` scales beat swell; `doubleBeat` blends single → lub-dub.
 */
export function heartbeatScale(life: number, strength = 1, doubleBeat = 1): number {
  const t = clamp01(life);
  const lub = beatPulse(t, 0.1, 0.1);
  const dub = beatPulse(t, 0.21, 0.075) * 0.62 * clamp01(doubleBeat);
  const beat = Math.max(lub, dub);
  const sag = t > HEARTBEAT_PHASE ? 0.06 * easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE)) : 0;
  return 1 + beat * 0.42 * strength - sag;
}

/**
 * The amplitude/energy envelope (→ uAmp + shadow strength). Tracks the beats
 * during the lub-dub then a bright flare at the burst, decaying through the
 * afterglow. `heartburstEnvelope(0) ~ 0`, peaks on the beats + burst, → 0 by life 1.
 */
export function heartburstEnvelope(life: number, strength = 1, doubleBeat = 1): number {
  const t = clamp01(life);
  if (t <= 0 || t >= 1) return 0;
  const lub = beatPulse(t, 0.1, 0.1);
  const dub = beatPulse(t, 0.21, 0.075) * 0.62 * clamp01(doubleBeat);
  const beats = Math.max(lub, dub) * 0.9 * strength;
  const b = burstProgress(life);
  const flare = b * Math.pow(1 - b, 1.1) * 2.4;
  return clamp01(Math.max(beats, flare * (0.7 + 0.3 * strength)));
}

/**
 * Burst progress 0..1 over the post-beat phase: 0 until the dub finishes, then
 * eases out to 1 as the little hearts fly out and fade.
 */
export function burstProgress(life: number): number {
  const t = clamp01(life);
  if (t <= HEARTBEAT_PHASE) return 0;
  return easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE));
}

/**
 * Animation tempo — the "natural" timing that makes the effect feel alive.
 *
 * Two layers, per the reward-timing research:
 *  1. Functional confirmation (the checkmark) draws within ~240 ms regardless of
 *     total duration — fast enough to land near the ~100 ms reward-prediction
 *     signal and read as an unambiguous "it worked".
 *  2. The affective afterglow (the bloom) follows a fast attack → held-breath
 *     overshoot → long gentle decay. It may linger past 500 ms because it is
 *     non-blocking (pointer-events: none) and gates no task.
 *
 * Linear motion reads as unnatural, so everything here is eased.
 */

/** Window (ms) over which the checkmark draws in, independent of total length. */
export const CHECK_DRAW_MS = 240;

/**
 * Coarse animation step (ms) for the hand-drawn "animate on twos" look at full
 * whimsy — ~12 updates/sec, i.e. 24fps on twos. Motion is snapped toward this
 * grid as style rises (see the renderer), giving discrete, posed beats instead
 * of smooth interpolation.
 */
export const NPR_TIME_STEP_MS = 1000 / 12;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Classic ease-out cubic — quick start, gentle settle. */
export function easeOutCubic(x: number): number {
  const t = clamp01(x);
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Ease-out "back" — overshoots past 1 then settles exactly to 1 at x=1. This is
 * the held-breath release. `overshoot` scales how far past 1 it swells.
 */
export function easeOutBack(x: number, overshoot = 1): number {
  const t = clamp01(x);
  const c1 = 1.70158 * overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Bloom amplitude over normalized life `t` ∈ [0, 1].
 * Fast attack with overshoot in the first ~18%, then a long decay to zero.
 * `envelope(0) === 0`, `envelope(1) === 0`, peak > 1 during the attack.
 */
export function envelope(t: number, overshoot = 1): number {
  if (t <= 0 || t >= 1) return 0;
  const attack = 0.18;
  if (t < attack) {
    return easeOutBack(t / attack, overshoot);
  }
  const x = (t - attack) / (1 - attack);
  // Decays from 1 → 0; exponent > 1 keeps a slow, luxurious tail.
  return Math.pow(1 - x, 1.6);
}

/** Checkmark draw progress (0..1) given elapsed ms. */
export function checkProgress(elapsedMs: number): number {
  return easeOutCubic(elapsedMs / CHECK_DRAW_MS);
}

/**
 * Window (ms) over which the calligraphic stroke writes itself. A confident
 * gesture: a touch longer than a checkmark tick so the pressure belly + flick
 * read, but still inside the ~250–360 ms confirmation band so it lands as "done"
 * immediately rather than as a slow build.
 */
export const STROKE_DRAW_MS = 360;

/**
 * Calligraphic stroke / pen progress (0..1) over elapsed ms. The pen accelerates
 * into the gesture then eases off the flick — modelled as ease-out cubic so the
 * heavy belly is laid quickly and the exit decelerates into the upward flick.
 */
export function strokeProgress(elapsedMs: number): number {
  return easeOutCubic(elapsedMs / STROKE_DRAW_MS);
}

/**
 * Window (ms) over which the comic onomatopoeia word SLAMS in. Deliberately
 * very short — a hard, fast IMPACT — so the word reads as a punch landing, not
 * a tween. The word scales from huge → settles, overshooting (recoil) en route.
 */
export const IMPACT_MS = 200;

/** Hold (ms) the word sits proud at full size before it begins to settle out. */
export const IMPACT_HOLD_MS = 650;

/**
 * Comic impact SCALE over elapsed ms. The word arrives oversized and slams down
 * past its rest size, recoils (a quick spring), holds, then eases out at the
 * tail. Returns a multiplier on rest size:
 *   - t≈0           : large (≈1 + overshoot*0.8) — caught mid-slam, big
 *   - ~IMPACT_MS    : ≈1 (rest), having overshot slightly below then back
 *   - hold window   : gentle breathing ≈1
 *   - tail          : sags toward ~0.92 as it fades (handled by the renderer's
 *                     opacity; scale stays close to rest so letters stay legible)
 *
 * `overshoot` scales the slam magnitude (driven by intensity).
 */
export function impactScale(elapsedMs: number, overshoot = 1): number {
  const t = elapsedMs;
  if (t <= 0) return 1 + 0.85 * overshoot;
  if (t < IMPACT_MS) {
    // Slam: shrink from oversized down through a small undershoot, spring to 1.
    const x = t / IMPACT_MS;
    const eased = easeOutCubic(x);
    const big = 1 + 0.85 * overshoot;
    // overshoot dip slightly below 1 around 75% then back to exactly 1.
    const dip = -0.12 * overshoot * Math.sin(x * Math.PI) * (1 - x);
    return big + (1 - big) * eased + dip;
  }
  return 1;
}

/**
 * Comic impact OPACITY/presence over normalized life (0..1). A near-instant
 * appearance, a long proud hold, then a quick fade at the very end so the panel
 * clears. `durationMs` is the whole-effect length; the fade occupies the last
 * ~18%.
 */
export function impactPresence(life: number): number {
  const t = clamp01(life);
  if (t < 0.04) return easeOutCubic(t / 0.04); // snap in
  if (t < 0.82) return 1;
  const fade = clamp01(1 - (t - 0.82) / 0.18);
  return Math.pow(fade, 1.4); // quick clean fade
}

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

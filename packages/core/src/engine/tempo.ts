/**
 * Animation tempo PRIMITIVES — the generic easing + envelope building blocks
 * shared across effects.
 *
 * Linear motion reads as unnatural, so everything here is eased. These are the
 * GENERIC primitives only: each effect's BESPOKE envelope (the comic slam, the
 * fail stamp/shake, the heartburst lub-dub, the lightning strike/strobe, the
 * solarbloom check draw, the inkstroke stroke draw, …) lives in that effect's
 * own `<name>-tempo.ts` inside `@dopamine/effect-<name>`, built on top of these.
 */

/**
 * Coarse animation step (ms) for the hand-drawn "animate on twos" look at full
 * whimsy — ~12 updates/sec, i.e. 24fps on twos. Motion is snapped toward this
 * grid as style rises (see the pass-runner), giving discrete, posed beats
 * instead of smooth interpolation.
 */
export const NPR_TIME_STEP_MS = 1000 / 12;

/** Clamp a value into [0, 1]. */
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

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

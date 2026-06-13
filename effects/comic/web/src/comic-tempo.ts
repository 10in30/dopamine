/**
 * Comic Impact bespoke timing — the slam/recoil + proud-hold-then-fade.
 *
 * The word arrives oversized and slams down past its rest size, recoils (a quick
 * spring), holds, then eases out at the tail. Deliberately very short IMPACT so
 * the word reads as a punch landing, not a tween. Built on `easeOutCubic`.
 */

import { easeOutCubic, clamp01 } from "@dopaminefx/core";

/** Window (ms) over which the comic onomatopoeia word SLAMS in. */
export const IMPACT_MS = 200;

/** Hold (ms) the word sits proud at full size before it begins to settle out. */
export const IMPACT_HOLD_MS = 650;

/**
 * Comic impact SCALE over elapsed ms. Returns a multiplier on rest size: large
 * at t≈0, slamming to ≈1 by IMPACT_MS (with a small spring), then resting.
 * `overshoot` scales the slam magnitude (driven by intensity).
 */
export function impactScale(elapsedMs: number, overshoot = 1): number {
  const t = elapsedMs;
  if (t <= 0) return 1 + 0.85 * overshoot;
  if (t < IMPACT_MS) {
    const x = t / IMPACT_MS;
    const eased = easeOutCubic(x);
    const big = 1 + 0.85 * overshoot;
    const dip = -0.12 * overshoot * Math.sin(x * Math.PI) * (1 - x);
    return big + (1 - big) * eased + dip;
  }
  return 1;
}

/**
 * Comic impact OPACITY/presence over normalized life (0..1). A near-instant
 * appearance, a long proud hold, then a quick fade at the very end so the panel
 * clears. The fade occupies the last ~18%.
 */
export function impactPresence(life: number): number {
  const t = clamp01(life);
  if (t < 0.04) return easeOutCubic(t / 0.04); // snap in
  if (t < 0.82) return 1;
  const fade = clamp01(1 - (t - 0.82) / 0.18);
  return Math.pow(fade, 1.4); // quick clean fade
}

/**
 * Lightning's bespoke timing — a high-energy "power-up / boost" STRIKE.
 *
 * The bolt cracks in almost instantly with a hard FLASH on contact, then a
 * brief FLICKER AFTERGLOW strobes and decays. These shapes are pure functions
 * of time (frame-deterministic).
 */

import { clamp01 } from "@dopamine/core";

/** Window (ms) over which the bolt cracks in to the strike point. Hard + fast. */
export const STRIKE_MS = 130;

/**
 * Bolt strike progress (0..1) over elapsed ms — the jagged arc racing from the
 * source to the action point. Ease-out quint: a near-instant crack-in that
 * settles abruptly, so the bolt reads as a strike, not a slow draw.
 */
export function strikeProgress(elapsedMs: number): number {
  const x = clamp01(elapsedMs / STRIKE_MS);
  return 1 - Math.pow(1 - x, 5);
}

/**
 * FLASH / STROBE amplitude (0..1+) over normalized life — the signature electric
 * hit. An instantaneous near-white flash on the strike instant that decays fast,
 * then a few discrete FLICKER re-pulses (the afterglow strobe) whose peaks decay
 * across the tail. `flicker` (driven by intensity) scales how many/how strong the
 * re-pulses are. `flashStrobe(0)≈peak`, → 0 by life 1.
 */
export function flashStrobe(life: number, flicker = 1): number {
  const t = clamp01(life);
  const primary = Math.exp(-t / 0.035);
  const beats = 6;
  const phase = t * beats * Math.PI * 2;
  const spike = Math.max(0, Math.sin(phase));
  const sharp = Math.pow(spike, 8);
  const tail = Math.pow(1 - t, 2.2) * 0.28 * flicker;
  return primary + sharp * tail;
}

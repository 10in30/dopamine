/**
 * Lightning's bespoke timing — a high-energy "power-up / boost" STRIKE.
 *
 * The bolt cracks in almost instantly with a hard FLASH on contact, then a
 * brief FLICKER AFTERGLOW strobes and decays. These shapes are pure functions
 * of time (frame-deterministic).
 */

import { clamp01 } from "@dopamine/core";

// STRIKE_MS + strikeProgress live in lightning-logic.ts (the single transpiled
// source — the bolt precompute keys off the strike clock); re-exported here so
// the tempo module stays the timing entry point.
export { STRIKE_MS, strikeProgress } from "./lightning-logic.js";

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

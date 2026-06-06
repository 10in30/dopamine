/**
 * @dopamine/core — framework-agnostic entry point.
 *
 * `celebrate()` fires a one-shot "successful completion" effect. The whole
 * surface is mood / intensity / whimsy; everything else is derived.
 */

import { resolveParams } from "./engine/mood.js";
import { runSolarbloom } from "./engine/renderer.js";
import { randomSeed } from "./engine/seed.js";
import { createOverlay } from "./overlay.js";
import type { DopamineSuccessOptions } from "./types.js";

export type { DopamineMood, DopamineSuccessOptions } from "./types.js";
export type { RGB, OKLCH } from "./engine/color.js";
export { registerElement, DopamineSuccessElement } from "./element.js";

const DEFAULTS = { mood: "celebratory", intensity: 0.7, whimsy: 0.5 } as const;

/**
 * Fire a success celebration. Resolves when the animation has fully played out.
 *
 * ```ts
 * await celebrate({ mood: "electric", intensity: 0.9 });
 * ```
 */
export function celebrate(options: DopamineSuccessOptions = {}): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();

  const target = options.target ?? document.body;
  const seed = options.seed ?? randomSeed();
  const params = resolveParams({
    mood: options.mood ?? DEFAULTS.mood,
    intensity: options.intensity ?? DEFAULTS.intensity,
    whimsy: options.whimsy ?? DEFAULTS.whimsy,
    seed,
  });

  const rect = target.getBoundingClientRect();
  const origin = options.origin ?? {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  // Origin is relative to the overlay's own box.
  const originLocal =
    target === document.body || target === document.documentElement
      ? origin
      : { x: origin.x - rect.left, y: origin.y - rect.top };

  const overlay = createOverlay(target);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let handle: { done: Promise<void>; stop: () => void };
  try {
    handle = runSolarbloom(overlay.canvas, params, originLocal, dpr);
  } catch (err) {
    overlay.destroy();
    return Promise.reject(err);
  }

  return handle.done.then(() => overlay.destroy());
}

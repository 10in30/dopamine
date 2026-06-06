/**
 * @dopamine/core — framework-agnostic entry point.
 *
 * The library is a thin runtime + pluggable effects:
 *   - A `conductor` owns the persistent overlay (light + shadow canvas), the
 *     shared program-cached GL contexts, and one RAF loop (see framework/).
 *   - Each effect is an `EffectFactory` that self-registers on import
 *     (effects/*.ts) and only maps feelings → params and draws frames.
 *
 * The named exports below (`celebrate`, `celebrateInk`, `celebrateComic`,
 * `prepareSolarbloom`, …) are thin wrappers over the generic `play(effect, …)`
 * / `prepare(effect, …)`, preserving the original API + behavior exactly.
 */

import { play as conductorPlay, prepare as conductorPrepare } from "./framework/conductor.js";
import { getEffect } from "./framework/registry.js";
import type { Anchor, FeelingInput } from "./framework/effect.js";
import { randomSeed } from "./engine/seed.js";
import { isBrowser } from "./framework/runtime.js";
import type { DopamineSuccessOptions } from "./types.js";

// Register the built-in effects. Each module calls `registerEffect(...)` at
// import time; we import the factory VALUES (not bare side-effect imports) and
// reference them in `BUILTINS` so a bundler can't tree-shake the registration
// away. Importing one effect still pulls in nothing from the others.
import { solarbloom } from "./effects/solarbloom.js";
import { inkstroke } from "./effects/inkstroke.js";
import { comic } from "./effects/comic.js";

/** Force-retain the registrations against tree-shaking; also the built-in set. */
const BUILTINS = [solarbloom, inkstroke, comic] as const;

export type { DopamineMood, DopamineSuccessOptions } from "./types.js";
export type { RGB, OKLCH } from "./engine/color.js";
export { registerElement, DopamineSuccessElement } from "./element.js";
export { ensureComicFonts } from "./engine/comic-renderer.js";
export { ensureCheckFonts } from "./engine/check-renderer.js";

// Framework surface — for adding new effects / moods and lower-level control.
export type {
  Effect,
  EffectFactory,
  EffectInstance,
  EffectContext,
  FeelingInput,
  Anchor,
} from "./framework/effect.js";
export { registerEffect, getEffect, hasEffect, effectNames } from "./framework/registry.js";
export {
  registerMood,
  resolveMood,
  hasMood,
  moodNames,
  type MoodSpec,
  type ResolvedMood,
} from "./framework/mood-registry.js";
export { teardown, type PreparedHandle } from "./framework/conductor.js";
export {
  loadEffect,
  loadEffectSync,
  type LoadEffectOptions,
  type LoadOverrides,
  type LoadedEffect,
} from "./framework/load-effect.js";
export { registerProgram, getProgram, programNames, type RenderProgram } from "./framework/programs.js";
export { parseDope, getOutline, type DopeDoc, type DopeOutline } from "./framework/loader.js";
export { bakeSdf, decodeSdf, parseSvgPath, type BakedSdf, type DecodedSdf } from "./engine/sdf.js";

const DEFAULTS = { mood: "celebratory", intensity: 0.7, whimsy: 0.5 } as const;

/** Built-in effect names usable with the convenience API + the demo/scripts. */
export type EffectName = "solarbloom" | "inkstroke" | "comic";

/** The names of the three effects registered by `@dopamine/core` on import. */
export const builtinEffectNames: readonly EffectName[] = BUILTINS.map(
  (e) => e.name as EffectName,
);

/**
 * Resolve the shared options into a target, a feeling, and an overlay-local
 * anchor. Effects that aren't anchored (Verdict, Comic) simply ignore the
 * anchor — matching how the original API ignored `origin` for them.
 */
function resolveRequest(
  effect: string,
  options: DopamineSuccessOptions,
): { factory: ReturnType<typeof getEffect>; target: HTMLElement; anchor: Anchor; feeling: FeelingInput } | null {
  const factory = getEffect(effect);
  if (!factory) throw new Error(`dopamine: unknown effect "${effect}"`);
  const target = options.target ?? document.body;
  const seed = options.seed ?? randomSeed();
  const feeling: FeelingInput = {
    mood: options.mood ?? DEFAULTS.mood,
    intensity: options.intensity ?? DEFAULTS.intensity,
    whimsy: options.whimsy ?? DEFAULTS.whimsy,
    seed,
  };
  const rect = target.getBoundingClientRect();
  const origin = options.origin ?? {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
  // Anchor is overlay-local (relative to the target's own box).
  const anchor: Anchor =
    target === document.body || target === document.documentElement
      ? origin
      : { x: origin.x - rect.left, y: origin.y - rect.top };
  return { factory, target, anchor, feeling };
}

/**
 * Generic real-time fire: play a registered effect by name. Resolves when the
 * animation has fully played out. SSR-safe (resolves immediately off-DOM).
 *
 * ```ts
 * await play("comic", { mood: "electric", intensity: 0.9, whimsy: 1 });
 * ```
 */
export function play(effect: string, options: DopamineSuccessOptions = {}): Promise<void> {
  if (!isBrowser()) return Promise.resolve();
  const req = resolveRequest(effect, options);
  if (!req || !req.factory) return Promise.resolve();
  return conductorPlay({
    factory: req.factory,
    target: req.target,
    anchor: req.anchor,
    feeling: req.feeling,
  });
}

/** A prepared, manually-driven effect handle (offline capture / external clock). */
export interface PreparedEffect {
  readonly durationMs: number;
  /** Draw the frame at `elapsedMs` since the start. */
  renderAt(elapsedMs: number): void;
  /** Dispose the renderer *and* release the overlay. */
  dispose(): void;
}

/**
 * Generic prepared effect: mount the overlay and return a renderer you drive
 * yourself via `renderAt(elapsedMs)`. Call `dispose()` when finished. Returns
 * `null` in non-DOM environments.
 */
export function prepare(effect: string, options: DopamineSuccessOptions = {}): PreparedEffect | null {
  if (!isBrowser()) return null;
  const req = resolveRequest(effect, options);
  if (!req || !req.factory) return null;
  return conductorPrepare({
    factory: req.factory,
    target: req.target,
    anchor: req.anchor,
    feeling: req.feeling,
  });
}

// ---------------------------------------------------------------------------
// Named convenience wrappers — preserve the original public API exactly.
// ---------------------------------------------------------------------------

/**
 * Fire a Solarbloom success celebration (a centered radial volumetric bloom).
 * Resolves when the animation has fully played out.
 */
export function celebrate(options: DopamineSuccessOptions = {}): Promise<void> {
  return play("solarbloom", options);
}

/** Mount Solarbloom and return a manually-driven renderer. `null` off-DOM. */
export function prepareSolarbloom(options: DopamineSuccessOptions = {}): PreparedEffect | null {
  return prepare("solarbloom", options);
}

/** Fire a Calligraphic Verdict (the ink-stroke gesture). */
export function celebrateInk(options: DopamineSuccessOptions = {}): Promise<void> {
  return play("inkstroke", options);
}

/** Mount Calligraphic Verdict and return a manually-driven renderer. */
export function prepareInkstroke(options: DopamineSuccessOptions = {}): PreparedEffect | null {
  return prepare("inkstroke", options);
}

/** Fire a Comic Impact ("BAM! POW!") success shout. */
export function celebrateComic(options: DopamineSuccessOptions = {}): Promise<void> {
  return play("comic", options);
}

/** Mount Comic Impact and return a manually-driven renderer. */
export function prepareComic(options: DopamineSuccessOptions = {}): PreparedEffect | null {
  return prepare("comic", options);
}

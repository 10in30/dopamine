/**
 * @dopamine/core/core — the EFFECT-FREE runtime + public API.
 *
 * This entry pulls in ONLY the base runtime: the conductor (overlay + shared
 * program-cached GL contexts + RAF loop), the registry, the mood registry, the
 * `.dope` loader + `loadEffect`, the generic runners (pass + panel), and the
 * generic `play(name, …)` / `prepare(name, …)` API. It imports NO built-in
 * effect, so a consumer pays only for the effects they explicitly import from
 * `@dopamine/core/effects/<name>` (each self-registers on import).
 *
 * `@dopamine/core` (the index) is the batteries-included superset: it re-exports
 * everything here AND eagerly registers all four built-ins + the `celebrate*`
 * convenience wrappers.
 */

import { play as conductorPlay, prepare as conductorPrepare } from "./framework/conductor.js";
import { getEffect } from "./framework/registry.js";
import type { Anchor, FeelingInput } from "./framework/effect.js";
import { randomSeed } from "./engine/seed.js";
import { isBrowser } from "./framework/runtime.js";
import type { DopamineSuccessOptions } from "./types.js";

export type { DopamineMood, DopamineSuccessOptions } from "./types.js";
export type { RGB, OKLCH } from "./engine/color.js";
// NOTE: `registerElement` / `DopamineSuccessElement` (the <dopamine-success>
// custom element) is effect-coupled (it fires Solarbloom) so it lives in the
// batteries-included barrel `@dopamine/core`, NOT this lean effect-free entry.
// NOTE: the bundled-face preloaders `ensureComicFonts` / `ensureCheckFonts` are
// NOT re-exported here — they live with their effects (comic / solarbloom) so the
// heavy embedded font data stays in the per-effect chunk, not the core chunk.
// Import them from `@dopamine/core` (the barrel) or the effect's own module.

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
// The generic runners — for authoring new pure-shader / Canvas2D-panel effects.
export {
  createPassInstance,
  type PassConfig,
  type PassParams,
  type AuxTextureSpec,
  type FrameInfo,
} from "./framework/pass-runner.js";
export {
  createPanelInstance,
  type PanelConfig,
  type PanelDraw,
  type PanelFrameInfo,
} from "./framework/panel-runner.js";

const DEFAULTS = { mood: "celebratory", intensity: 0.7, whimsy: 0.5 } as const;

/**
 * Resolve the shared options into a target, a feeling, and an overlay-local
 * anchor. Effects that aren't anchored (Verdict, Comic) simply ignore the anchor.
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
  const anchor: Anchor =
    target === document.body || target === document.documentElement
      ? origin
      : { x: origin.x - rect.left, y: origin.y - rect.top };
  return { factory, target, anchor, feeling };
}

/**
 * Generic real-time fire: play a registered effect by name. Resolves when the
 * animation has fully played out. SSR-safe (resolves immediately off-DOM). The
 * effect must already be registered (import `@dopamine/core/effects/<name>` or
 * load one via `loadEffect`).
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

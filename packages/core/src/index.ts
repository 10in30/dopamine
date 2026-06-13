/**
 * @dopaminefx/core — the EFFECT-FREE runtime + public API.
 *
 * This is the slim runtime: the conductor (overlay + shared program-cached GL
 * contexts + RAF loop), the registry, the mood registry, the `.dope` loader +
 * `loadEffect`, the generic runners (pass + panel), the shared engine bits
 * (color, sdf, shadow, seed, context, gl, the `look/` GLSL chunks, tempo
 * PRIMITIVES) and the generic `play(name, …)` / `prepare(name, …)` API.
 *
 * Core imports + registers NO effect. Each effect ships as its own
 * `@dopaminefx/effect-<name>` package that depends on this and self-registers on
 * import; the `@dopaminefx/effects` umbrella bundles all nine + the `celebrate*`
 * conveniences + the `<dopamine-success>` element.
 */

import {
  play as conductorPlay,
  prepare as conductorPrepare,
  type PlayHandle,
} from "./framework/conductor.js";
import { getEffect } from "./framework/registry.js";
import type { Anchor, FeelingInput } from "./framework/effect.js";
import { randomSeed } from "./engine/seed.js";
import { isBrowser } from "./framework/runtime.js";
import type { DopamineSuccessOptions } from "./types.js";

export type { DopamineMood, DopamineSuccessOptions } from "./types.js";
export type { RGB, OKLCH } from "./engine/color.js";
export { buildPalette, oklchToLinearSrgb, wrapHue, GOLDEN_ANGLE_DEG, type PaletteParams } from "./engine/color.js";
export { mulberry32, randomSeed, type Rng } from "./engine/seed.js";

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
export { teardown, type PreparedHandle, type PlayHandle } from "./framework/conductor.js";
export {
  loadEffect,
  loadEffectSync,
  type LoadEffectOptions,
  type LoadOverrides,
  type LoadedEffect,
} from "./framework/load-effect.js";
export { registerProgram, getProgram, programNames, type RenderProgram } from "./framework/programs.js";
export {
  parseDope,
  resolveDopeParams,
  getOutline,
  type DopeDoc,
  type DopeOutline,
  type DopeBinding,
  type DopeSampler,
  type DopeFrameSpec,
  type DopeLoopSpec,
} from "./framework/loader.js";
export {
  dopePassConfig,
  dopePanelConfig,
  registerDopeEffect,
  registerDopePanelEffect,
  type DopePassHooks,
  type DopeShader,
  type RegisterDopeEffectOptions,
} from "./framework/dope-pass.js";
export {
  evalFrameExpr,
  evalParamExpr,
  evalPassExpr,
  type FrameExprNode,
  type FrameExprCtx,
  type PassExprInputs,
} from "./framework/frame-expr.js";
export {
  pickFromList,
  pickBand,
  resolveTypography,
  type DopeTypography,
} from "./framework/content.js";
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

// Tempo PRIMITIVES — the generic easing/envelope building blocks effects build
// their bespoke timing on top of (each effect's bespoke envelope lives in its
// own package's `<name>-tempo.ts`).
export {
  clamp01,
  easeOutCubic,
  easeOutBack,
  envelope,
  NPR_TIME_STEP_MS,
} from "./engine/tempo.js";

// The shared GLSL "look" chunks — reusable shader fragments (hash, fbm, palette
// mix, tonemap, dither, halftone, …) an effect's shader composes into its source.
export * from "./engine/look/glsl.js";
export { GLSL_PARTICLES } from "./engine/look/particles.glsl.js";

const DEFAULTS = { mood: "celebratory", intensity: 0.7, whimsy: 0.5 } as const;

/**
 * Resolve the shared options into a target, a feeling, and an overlay-local
 * anchor. Effects that aren't anchored (Verdict, Comic) simply ignore the anchor.
 */
function resolveRequest(
  effect: string,
  options: DopamineSuccessOptions,
): {
  factory: ReturnType<typeof getEffect>;
  target: HTMLElement;
  anchor: Anchor;
  targetSize: { width: number; height: number };
  feeling: FeelingInput;
} | null {
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
  // The element box the centrepiece is sized to (CSS px). Defaults to the target's
  // own rect, so the centrepiece matches whatever element was fired on; an explicit
  // `targetSize` lets a caller match a child element under a full-page overlay.
  const targetSize = options.targetSize ?? { width: rect.width, height: rect.height };
  return { factory, target, anchor, targetSize, feeling };
}

/**
 * Generic real-time fire: play a registered effect by name. Resolves when the
 * animation has fully played out. A CONTINUOUS effect (one whose `.dope`
 * declares `tempo.loop`, e.g. halo) loops seamlessly until the host calls the
 * returned handle's `stop()`. The handle's `pause()`/`resume()` freeze and
 * resume the timeline drift-free (parking a perpetual loop so it costs no
 * battery; the conductor also auto-pauses on a hidden tab). SSR-safe (resolves
 * immediately off-DOM). The effect must already be registered (import
 * `@dopaminefx/effect-<name>` or the `@dopaminefx/effects` umbrella, or load one
 * via `loadEffect`).
 */
export function play(effect: string, options: DopamineSuccessOptions = {}): PlayHandle {
  const noop: PlayHandle = Object.assign(Promise.resolve(), { stop() {}, pause() {}, resume() {} });
  if (!isBrowser()) return noop;
  const req = resolveRequest(effect, options);
  if (!req || !req.factory) return noop;
  return conductorPlay({
    factory: req.factory,
    target: req.target,
    anchor: req.anchor,
    targetSize: req.targetSize,
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
    targetSize: req.targetSize,
    feeling: req.feeling,
  });
}

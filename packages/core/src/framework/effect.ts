/**
 * The Dopamine effect framework — the backbone every visual effect plugs into.
 *
 * An *effect* (Solarbloom, Calligraphic Verdict, Comic Impact, and future
 * progress / error / attention effects) is a self-contained module that knows
 * two things:
 *
 *  1. how to turn the human-facing "feeling" knobs (mood / intensity / whimsy)
 *     plus a seed into its own concrete, deterministic render parameters, and
 *  2. how to draw a single frame at an arbitrary `elapsedMs` into a shared GPU
 *     surface — both the light pass and (if present) the multiply shadow pass.
 *
 * Effects never create the DOM overlay, the GL context, or the RAF loop — the
 * runtime (the conductor) owns all of that. That separation is what lets a new
 * effect be a small file that self-registers, and keeps the library
 * tree-shakeable: importing one effect pulls in nothing from the others.
 */

import type { GLContext } from "../engine/context.js";
import type { ResolvedMood } from "./mood-registry.js";

/** Origin/anchor in CSS pixels, relative to the render surface's top-left. */
export interface Anchor {
  x: number;
  y: number;
}

/**
 * The "feeling" API, shared by every effect. Individual effects map these onto
 * their own low-level parameters via {@link EffectFactory.resolve}. This is the
 * deliberate seam between *what a developer expresses* (a feeling) and *what the
 * shader consumes* (numbers).
 */
export interface FeelingInput {
  /** Emotional register — a registered mood name. */
  mood: string;
  /** 0..1 — arousal/valence: saturation, brightness, scale, overshoot. */
  intensity: number;
  /** 0..1 — stylization: photoreal (0) ↔ cel / hand-drawn "animate on twos" (1). */
  whimsy: number;
  /** Deterministic seed for the algorithmic color + motion. */
  seed: number;
}

/**
 * Everything an effect instance needs to draw, supplied by the runtime. The
 * effect draws its light pass into `light` and, when `shadow` is non-null, its
 * occlusion silhouette into `shadow` (a separate `mix-blend-mode: multiply`
 * canvas + context). Both contexts are persistent + program-cached.
 */
export interface EffectContext {
  /** Shared WebGL2 light context (`screen` blend) + program cache. */
  readonly light: GLContext;
  /** Shared WebGL2 shadow context (`multiply` blend), or null if disabled. */
  readonly shadow: GLContext | null;
  /** Where the effect is anchored, in CSS px relative to the surface. */
  readonly anchor: Anchor;
  /**
   * Size (CSS px) of the underlying element the effect targets, centred on
   * {@link anchor}. The centrepiece (checkmark, ✗, comic word, hero heart, ink
   * gesture) is sized to THIS box so it matches the page element. Omitted ⇒ the
   * full render surface (the centrepiece fills the canvas, as before).
   */
  readonly targetSize?: { width: number; height: number };
  /** Device-pixel ratio to render at (already capped by the runtime). */
  readonly dpr: number;
}

/** A live, drawable effect. Pure function of time: same `elapsedMs` → same frame. */
export interface EffectInstance {
  /** Total length in ms after which the effect has fully played out. */
  readonly durationMs: number;
  /** Draw the frame at `elapsedMs` since the effect started. */
  renderAt(elapsedMs: number): void;
  /** Release any per-instance GPU resources (not shared/cached ones). */
  dispose(): void;
}

/**
 * The contract a new effect implements. `Params` is the effect's private,
 * fully-resolved parameter shape — opaque to the runtime.
 */
export interface EffectFactory<Params = unknown> {
  /** Stable, unique id, e.g. `"solarbloom"`. Used by the registry + API. */
  readonly name: string;
  /**
   * Map the shared feeling knobs + a resolved mood into this effect's own
   * deterministic params. Pure — no DOM, no GL, no randomness beyond the seed.
   */
  resolve(feeling: FeelingInput, mood: ResolvedMood): Params;
  /** Build a drawable instance for the given resolved params + context. */
  create(params: Params, ctx: EffectContext): EffectInstance;
  /**
   * Whether this effect wants a shadow (multiply) companion canvas. Defaults to
   * true; an effect that casts no shadow can opt out to skip the second context.
   */
  readonly castsShadow?: boolean;
  /**
   * Optional reduced-motion handling: which `elapsedMs` of the timeline best
   * represents a calm peak, and how long to hold that single static frame
   * instead of animating. Sensible defaults are used if omitted.
   */
  readonly reducedMotion?: {
    /** How long to hold the minimal frame, ms. Default 360. */
    holdMs?: number;
    /** Which `elapsedMs` of the full timeline best represents a calm peak. */
    peakMs?: number;
  };
  /**
   * CONTINUOUS-loop contract (from `tempo.loop`): the effect repeats seamlessly
   * with this period and `durationMs` is a whole number of periods. The
   * conductor re-arms it at `durationMs` instead of tearing down — the host
   * stops it via the handle `play()` returns. Absent for one-shot effects.
   */
  readonly loop?: { periodMs: number };
}

/** Public alias: an `Effect` is what you register and play by name. */
export type Effect<Params = unknown> = EffectFactory<Params>;

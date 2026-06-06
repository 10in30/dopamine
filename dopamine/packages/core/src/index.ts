/**
 * @dopamine/core — framework-agnostic entry point.
 *
 * `celebrate()` fires a one-shot "successful completion" effect in real time.
 * `prepareSolarbloom()` is the lower-level primitive: it mounts the overlay and
 * hands back a renderer you drive with your own clock — used for frame-perfect
 * offline capture, or to sync the effect to an external timeline.
 */

import { resolveParams, resolveInkParams, resolveComicParams } from "./engine/mood.js";
import { createSolarbloom, runSolarbloom, type SolarbloomRenderer } from "./engine/renderer.js";
import {
  createInkstroke,
  runInkstroke,
  type InkstrokeRenderer,
} from "./engine/inkstroke-renderer.js";
import { createComic, runComic, type ComicRenderer } from "./engine/comic-renderer.js";
import { randomSeed } from "./engine/seed.js";
import { createOverlay } from "./overlay.js";
import type { DopamineSuccessOptions } from "./types.js";

export type { DopamineMood, DopamineSuccessOptions } from "./types.js";
export type { RGB, OKLCH } from "./engine/color.js";
export { registerElement, DopamineSuccessElement } from "./element.js";

const DEFAULTS = { mood: "celebratory", intensity: 0.7, whimsy: 0.5 } as const;

interface Mounted {
  canvas: HTMLCanvasElement;
  shadowCanvas: HTMLCanvasElement | null;
  destroyOverlay: () => void;
  params: ReturnType<typeof resolveParams>;
  originLocal: { x: number; y: number };
  dpr: number;
}

/** Resolve options → params, then mount the overlay anchored at the origin. */
function mount(options: DopamineSuccessOptions): Mounted {
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

  const overlay = createOverlay(target, { shadow: true });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return {
    canvas: overlay.canvas,
    shadowCanvas: overlay.shadow ?? null,
    destroyOverlay: overlay.destroy,
    params,
    originLocal,
    dpr,
  };
}

/**
 * Fire a success celebration. Resolves when the animation has fully played out.
 *
 * ```ts
 * await celebrate({ mood: "electric", intensity: 0.9 });
 * ```
 */
export function celebrate(options: DopamineSuccessOptions = {}): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const m = mount(options);
  let handle: { done: Promise<void>; stop: () => void };
  try {
    handle = runSolarbloom(m.canvas, m.params, m.originLocal, m.dpr, m.shadowCanvas);
  } catch (err) {
    m.destroyOverlay();
    return Promise.reject(err);
  }
  return handle.done.then(() => m.destroyOverlay());
}

export interface PreparedEffect extends SolarbloomRenderer {
  /** Dispose the renderer *and* remove the overlay. */
  dispose(): void;
}

/**
 * Mount the overlay and return a renderer you drive yourself via
 * `renderAt(elapsedMs)`. Call `dispose()` when finished. Returns `null` in
 * non-DOM environments.
 *
 * ```ts
 * const fx = prepareSolarbloom({ mood: "serene" });
 * fx.renderAt(300); // draw the frame at t=300ms
 * fx.dispose();
 * ```
 */
export function prepareSolarbloom(options: DopamineSuccessOptions = {}): PreparedEffect | null {
  if (typeof document === "undefined") return null;
  const m = mount(options);
  let renderer: SolarbloomRenderer;
  try {
    renderer = createSolarbloom(m.canvas, m.params, m.originLocal, m.dpr, m.shadowCanvas);
  } catch (err) {
    m.destroyOverlay();
    throw err;
  }
  return {
    durationMs: renderer.durationMs,
    renderAt: (ms) => renderer.renderAt(ms),
    dispose: () => {
      renderer.dispose();
      m.destroyOverlay();
    },
  };
}

// ---------------------------------------------------------------------------
// Comic Impact — the "BAM! POW!" fight-panel success effect.
//
// Same feeling-API + light-casting overlay, but a Golden/Silver-Age comic
// visual language: a hand-lettered onomatopoeia word slams in over a jagged
// starburst with bold ink outlines, Ben-Day halftone shading and radiating
// action lines. whimsy maps NOIR (high-contrast chiaroscuro inking, one spot
// color, subtle halftone) ↔ POP-ART (screaming saturation, loud Ben-Day dots,
// fat ink, animate-on-twos). `origin` is ignored (the punch is centred).
// ---------------------------------------------------------------------------

interface ComicMounted {
  canvas: HTMLCanvasElement;
  destroyOverlay: () => void;
  params: ReturnType<typeof resolveComicParams>;
  dpr: number;
}

function mountComic(options: DopamineSuccessOptions): ComicMounted {
  const target = options.target ?? document.body;
  const seed = options.seed ?? randomSeed();
  const params = resolveComicParams({
    mood: options.mood ?? DEFAULTS.mood,
    intensity: options.intensity ?? DEFAULTS.intensity,
    whimsy: options.whimsy ?? DEFAULTS.whimsy,
    seed,
  });
  const overlay = createOverlay(target);
  overlay.canvas.dataset.dopamine = "comic";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return { canvas: overlay.canvas, destroyOverlay: overlay.destroy, params, dpr };
}

/**
 * Fire a Comic Impact celebration. Resolves once it has fully played.
 *
 * ```ts
 * await celebrateComic({ mood: "electric", intensity: 0.9, whimsy: 1 }); // POW!
 * ```
 */
export function celebrateComic(options: DopamineSuccessOptions = {}): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const m = mountComic(options);
  let handle: { done: Promise<void>; stop: () => void };
  try {
    handle = runComic(m.canvas, m.params, m.dpr);
  } catch (err) {
    m.destroyOverlay();
    return Promise.reject(err);
  }
  return handle.done.then(() => m.destroyOverlay());
}

/**
 * Mount the overlay and return a comic-impact renderer you drive yourself via
 * `renderAt(elapsedMs)`. Call `dispose()` when finished. `null` outside a DOM.
 */
export function prepareComic(options: DopamineSuccessOptions = {}): PreparedEffect | null {
  if (typeof document === "undefined") return null;
  const m = mountComic(options);
  let renderer: ComicRenderer;
  try {
    renderer = createComic(m.canvas, m.params, m.dpr);
  } catch (err) {
    m.destroyOverlay();
    throw err;
  }
  return {
    durationMs: renderer.durationMs,
    renderAt: (ms) => renderer.renderAt(ms),
    dispose: () => {
      renderer.dispose();
      m.destroyOverlay();
    },
  };
}

// ---------------------------------------------------------------------------
// Calligraphic Verdict — the ink-stroke success effect.
//
// Same feeling-API (mood/intensity/whimsy/seed/target), same light-casting
// overlay, but a fundamentally different visual language: a directional
// calligraphic gesture that writes itself across the frame rather than a
// radial bloom from a point. `origin` is ignored (the gesture is composed in
// viewport space). Solarbloom is untouched, so the two can be compared.
// ---------------------------------------------------------------------------

interface InkMounted {
  canvas: HTMLCanvasElement;
  shadowCanvas: HTMLCanvasElement | null;
  destroyOverlay: () => void;
  params: ReturnType<typeof resolveInkParams>;
  dpr: number;
}

function mountInk(options: DopamineSuccessOptions): InkMounted {
  const target = options.target ?? document.body;
  const seed = options.seed ?? randomSeed();
  const params = resolveInkParams({
    mood: options.mood ?? DEFAULTS.mood,
    intensity: options.intensity ?? DEFAULTS.intensity,
    whimsy: options.whimsy ?? DEFAULTS.whimsy,
    seed,
  });
  const overlay = createOverlay(target, { shadow: true });
  overlay.canvas.dataset.dopamine = "inkstroke";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return {
    canvas: overlay.canvas,
    shadowCanvas: overlay.shadow ?? null,
    destroyOverlay: overlay.destroy,
    params,
    dpr,
  };
}

/**
 * Fire a Calligraphic Verdict celebration. Resolves once it has fully played.
 *
 * ```ts
 * await celebrateInk({ mood: "electric", intensity: 0.9, whimsy: 1 });
 * ```
 */
export function celebrateInk(options: DopamineSuccessOptions = {}): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const m = mountInk(options);
  let handle: { done: Promise<void>; stop: () => void };
  try {
    handle = runInkstroke(m.canvas, m.params, m.dpr, m.shadowCanvas);
  } catch (err) {
    m.destroyOverlay();
    return Promise.reject(err);
  }
  return handle.done.then(() => m.destroyOverlay());
}

/**
 * Mount the overlay and return an ink-stroke renderer you drive yourself via
 * `renderAt(elapsedMs)`. Call `dispose()` when finished. `null` outside a DOM.
 */
export function prepareInkstroke(options: DopamineSuccessOptions = {}): PreparedEffect | null {
  if (typeof document === "undefined") return null;
  const m = mountInk(options);
  let renderer: InkstrokeRenderer;
  try {
    renderer = createInkstroke(m.canvas, m.params, m.dpr, m.shadowCanvas);
  } catch (err) {
    m.destroyOverlay();
    throw err;
  }
  return {
    durationMs: renderer.durationMs,
    renderAt: (ms) => renderer.renderAt(ms),
    dispose: () => {
      renderer.dispose();
      m.destroyOverlay();
    },
  };
}

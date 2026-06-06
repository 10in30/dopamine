/**
 * @dopamine/core — the batteries-included entry point.
 *
 * This barrel re-exports the entire effect-free runtime/API (`./core`) AND
 * eagerly registers all four built-in effects, plus the `celebrate*` convenience
 * wrappers. Importing it pulls EVERY effect (the "everything" bundle) — convenient
 * but the heaviest entry.
 *
 * For code-splitting, import the lean runtime from `@dopamine/core/core` and only
 * the effects you need from `@dopamine/core/effects/<name>` (each self-registers
 * on import), then fire them with the generic `play(name, …)` / `prepare(name, …)`.
 * A consumer then pays only for the effects they import.
 */

import { play, prepare, type PreparedEffect } from "./core.js";
import type { DopamineSuccessOptions } from "./types.js";

// Re-export the whole effect-free runtime/API surface.
export * from "./core.js";
// Effect-coupled extras that live only in the batteries-included barrel.
export { registerElement, DopamineSuccessElement } from "./element.js";
export { ensureComicFonts } from "./engine/comic-renderer.js";
export { ensureCheckFonts } from "./engine/check-renderer.js";

// Register the built-in effects. Each module calls `registerEffect(...)` at
// import time; we import the factory VALUES (not bare side-effect imports) and
// reference them in `BUILTINS` so a bundler can't tree-shake the registration
// away.
import { solarbloom } from "./effects/solarbloom.js";
import { inkstroke } from "./effects/inkstroke.js";
import { comic } from "./effects/comic.js";
import { fail as failEffect } from "./effects/fail.js";

/** Force-retain the registrations against tree-shaking; also the built-in set. */
const BUILTINS = [solarbloom, inkstroke, comic, failEffect] as const;

/** Built-in effect names usable with the convenience API + the demo/scripts. */
export type EffectName = "solarbloom" | "inkstroke" | "comic" | "fail";

/** The names of the four effects registered by `@dopamine/core` on import. */
export const builtinEffectNames: readonly EffectName[] = BUILTINS.map(
  (e) => e.name as EffectName,
);

// ---------------------------------------------------------------------------
// Named convenience wrappers — preserve the original public API exactly. Each
// eagerly pulls its effect (via the imports above), so `celebrate()` works
// standalone without the caller registering anything.
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

/**
 * Fire the FAIL / error effect — the emotional opposite of `celebrate*`. A red/
 * amber ✗ is stamped in with a sharp hit + recoil shake, then collapses. Use the
 * `try-again` / `error` / `denied` moods for gentle → harsh. Resolves when done.
 */
export function fail(options: DopamineSuccessOptions = {}): Promise<void> {
  return play("fail", { mood: "error", ...options });
}

/** Mount the fail effect and return a manually-driven renderer. `null` off-DOM. */
export function prepareFail(options: DopamineSuccessOptions = {}): PreparedEffect | null {
  return prepare("fail", { mood: "error", ...options });
}

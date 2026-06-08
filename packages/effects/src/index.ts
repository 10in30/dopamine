/**
 * @dopamine/effects — the batteries-included UMBRELLA.
 *
 * Importing this registers ALL nine built-in effects (each `@dopamine/effect-*`
 * package self-registers on import) and re-exports the whole `@dopamine/core`
 * runtime/API surface, plus the `celebrate*` convenience wrappers and the
 * `<dopamine-success>` custom element.
 *
 * For code-splitting, depend on `@dopamine/core` for the runtime and import only
 * the `@dopamine/effect-<name>` packages you need (each self-registers on
 * import), then fire them with the generic `play(name, …)` / `prepare(name, …)`.
 */

import { play, prepare, type PreparedEffect } from "@dopamine/core";
import type { DopamineSuccessOptions } from "@dopamine/core";

// Re-export the whole runtime/API surface.
export * from "@dopamine/core";

// Register the built-in effects. Each module calls `registerEffect(...)` at
// import time; we import the factory VALUES (not bare side-effect imports) and
// reference them in `BUILTINS` so a bundler can't tree-shake the registration
// away. Each package also re-exports its factory.
import { solarbloom } from "@dopamine/effect-solarbloom";
import { inkstroke } from "@dopamine/effect-inkstroke";
import { comic } from "@dopamine/effect-comic";
import { fail as failEffect } from "@dopamine/effect-fail";
import { aurora } from "@dopamine/effect-aurora";
import { ripple } from "@dopamine/effect-ripple";
import { confetti } from "@dopamine/effect-confetti";
import { heartburst } from "@dopamine/effect-heartburst";
import { lightning } from "@dopamine/effect-lightning";

// The bundled-face preloaders live with their effects; re-export for convenience.
export { ensureComicFonts } from "@dopamine/effect-comic";
export { ensureCheckFonts } from "@dopamine/effect-solarbloom";

// The custom element (effect-coupled — it fires Solarbloom).
export { registerElement, DopamineSuccessElement } from "./element.js";

/** Force-retain the registrations against tree-shaking; also the built-in set. */
const BUILTINS = [
  solarbloom, inkstroke, comic, failEffect,
  aurora, ripple, confetti, heartburst, lightning,
] as const;

/** Built-in effect names usable with the convenience API + the demo/scripts. */
export type EffectName =
  | "solarbloom" | "inkstroke" | "comic" | "fail"
  | "aurora" | "ripple" | "confetti" | "heartburst" | "lightning";

/** The names of every effect registered by `@dopamine/effects` on import. */
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

/**
 * Runtime-environment guards. Every access to a browser-only global
 * (`document`, `window`, `matchMedia`, `devicePixelRatio`) goes through here so
 * the whole library is SSR-safe: importing `@dopamine/core` on a server, or
 * calling `celebrate()` where there is no DOM, is a no-op rather than a crash.
 */

/** True only in a real browser with a DOM we can mount an overlay into. */
export function isBrowser(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

/** Whether the document is currently hidden (background tab). SSR-safe. */
export function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Whether the user has asked for reduced motion. SSR-safe and defensive: if
 * `matchMedia` is unavailable or throws we assume motion is fine (the prior
 * default behaviour).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Device-pixel ratio, capped at 2 to bound fill cost under software WebGL. */
export function deviceDpr(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(window.devicePixelRatio || 1, 2);
}

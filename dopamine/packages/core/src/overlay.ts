/**
 * Full-bleed overlay host. Creates a fixed, click-through canvas layered over
 * the target. `mix-blend-mode: screen` is what makes the effect cast colored
 * light onto the UI beneath: black pixels leave content untouched, bright
 * pixels lighten it.
 */

export interface Overlay {
  canvas: HTMLCanvasElement;
  /** Remove the overlay from the DOM. */
  destroy: () => void;
}

export function createOverlay(target: HTMLElement): Overlay {
  const canvas = document.createElement("canvas");
  const s = canvas.style;
  s.position = "fixed";
  s.inset = "0";
  s.width = "100%";
  s.height = "100%";
  s.pointerEvents = "none";
  s.zIndex = "2147483646";
  s.mixBlendMode = "screen";
  s.display = "block";
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.dopamine = "solarbloom";

  // If the target isn't the body, scope the overlay to it (absolute within).
  if (target !== document.body && target !== document.documentElement) {
    const cs = getComputedStyle(target);
    if (cs.position === "static") target.style.position = "relative";
    s.position = "absolute";
  }
  target.appendChild(canvas);

  return {
    canvas,
    destroy: () => canvas.remove(),
  };
}

/**
 * Full-bleed overlay host. Creates fixed, click-through canvases layered over
 * the target.
 *
 * Two stacked compositing layers give the effect real physical presence:
 *
 *   - LIGHT layer (`mix-blend-mode: screen`): black pixels leave content
 *     untouched, bright pixels lighten it — this is what makes the effect cast
 *     coloured light onto the UI beneath.
 *   - SHADOW layer (`mix-blend-mode: multiply`): white pixels leave content
 *     untouched, dark pixels darken it — a soft, offset occlusion silhouette of
 *     the effect's bright forms, so the effect reads as floating ABOVE the page
 *     and throwing shadow into it, not just glowing on top of it.
 *
 * The shadow layer sits BENEATH the light layer in z-order, so the bright core
 * always wins where the two overlap (the shadow is pushed out to the edges /
 * away from the light, which is physically what an offset penumbra does).
 *
 * Back-compat: `createOverlay(target)` still returns an object whose `.canvas`
 * is the single light canvas and `.destroy()` tears everything down — existing
 * single-canvas callers are unaffected. Pass `{ shadow: true }` to additionally
 * get a `shadow` canvas (`overlay.shadow`).
 */

export interface Overlay {
  /** The light-casting canvas (`mix-blend-mode: screen`). */
  canvas: HTMLCanvasElement;
  /**
   * The shadow-casting canvas (`mix-blend-mode: multiply`), present only when
   * the overlay was created with `{ shadow: true }`.
   */
  shadow?: HTMLCanvasElement;
  /**
   * Lazily create (or return the existing) shadow canvas, inserting it beneath
   * the light layer. Lets a persistent overlay gain a shadow layer when a later
   * effect needs one without recreating the whole overlay.
   */
  ensureShadow: () => HTMLCanvasElement;
  /** Remove the overlay (all layers) from the DOM. */
  destroy: () => void;
}

export interface OverlayOptions {
  /** Also create a multiply "shadow" layer beneath the light layer. */
  shadow?: boolean;
}

const LIGHT_Z = "2147483646";
// One below the light layer so the bright core composites over the shadow.
const SHADOW_Z = "2147483645";

function styleCanvas(
  canvas: HTMLCanvasElement,
  blend: "screen" | "multiply",
  zIndex: string,
  scoped: boolean,
): void {
  const s = canvas.style;
  s.position = scoped ? "absolute" : "fixed";
  s.inset = "0";
  s.width = "100%";
  s.height = "100%";
  s.pointerEvents = "none";
  s.zIndex = zIndex;
  s.mixBlendMode = blend;
  s.display = "block";
  canvas.setAttribute("aria-hidden", "true");
}

export function createOverlay(target: HTMLElement, options: OverlayOptions = {}): Overlay {
  const scoped = target !== document.body && target !== document.documentElement;
  if (scoped) {
    const cs = getComputedStyle(target);
    if (cs.position === "static") target.style.position = "relative";
  }

  // Shadow layer is created (and appended) first so it sits beneath the light
  // layer both in z-index and DOM order.
  let shadow: HTMLCanvasElement | undefined;
  const makeShadow = (): HTMLCanvasElement => {
    const s = document.createElement("canvas");
    styleCanvas(s, "multiply", SHADOW_Z, scoped);
    s.dataset.dopamine = "shadow";
    // Insert at the front so it sits beneath the (later-appended) light canvas.
    target.insertBefore(s, target.firstChild);
    return s;
  };
  if (options.shadow) shadow = makeShadow();

  const canvas = document.createElement("canvas");
  styleCanvas(canvas, "screen", LIGHT_Z, scoped);
  canvas.dataset.dopamine = "solarbloom";
  target.appendChild(canvas);

  return {
    canvas,
    get shadow() {
      return shadow;
    },
    ensureShadow(): HTMLCanvasElement {
      if (!shadow) shadow = makeShadow();
      return shadow;
    },
    destroy: () => {
      canvas.remove();
      shadow?.remove();
    },
  };
}

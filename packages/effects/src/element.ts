/**
 * `<dopamine-success>` custom element — a declarative handle that sits in the
 * DOM. Call `.play()` (or dispatch via the `trigger` attribute) to celebrate.
 * The element itself is a zero-size marker; the effect renders in a full-page
 * overlay anchored at the element's center.
 */

import { celebrate } from "./index.js";
import type { DopamineMood } from "@dopamine/core";

const clampNum = (v: string | null, fallback: number): number => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

// SSR-safe base: in a non-DOM environment (server render, vitest `node`)
// `HTMLElement` doesn't exist, and `extends HTMLElement` would throw at module
// load. Fall back to a harmless stub there; the custom element is only ever
// actually registered + used in a real browser (see `registerElement`).
const ElementBase: typeof HTMLElement =
  typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

export class DopamineSuccessElement extends ElementBase {
  static get observedAttributes(): string[] {
    return ["trigger"];
  }

  /** Fire the celebration, anchored at this element's center. */
  play(): Promise<void> {
    const rect = this.getBoundingClientRect();
    return celebrate({
      mood: (this.getAttribute("mood") as DopamineMood | null) ?? undefined,
      intensity: clampNum(this.getAttribute("intensity"), 0.7),
      whimsy: clampNum(this.getAttribute("whimsy"), 0.5),
      seed: this.hasAttribute("seed") ? Number(this.getAttribute("seed")) : undefined,
      origin:
        rect.width || rect.height
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : undefined,
    });
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    // Any change to `trigger` (other than the initial set) replays the effect.
    if (name === "trigger" && oldValue !== null && oldValue !== newValue) {
      void this.play();
    }
  }
}

/** Register the element (idempotent). Safe to call on import. */
export function registerElement(tag = "dopamine-success"): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(tag)) {
    customElements.define(tag, DopamineSuccessElement);
  }
}

registerElement();

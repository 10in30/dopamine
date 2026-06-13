/**
 * Comic's derived PANEL config — the `.dope` contract.
 *
 * Comic is the heaviest panel-class hybrid on the declarative path: everything
 * around the Canvas2D draw is data (comic.dope.json), derived by the generic
 * `dopePanelConfig`. Pin:
 *   - the derived uniform set + binding exceptions + the panel sampler,
 *   - the constant shadow height (0.5),
 *   - the dpr-scaled Ben-Day cell + style-fattened ink from `render.pass`
 *     (uDotSize = dotSize · dpr, uInkBoost = 1 + style · 0.4),
 *   - and — the lightning/heartburst posture — DELTA-0 equivalence of the
 *     datafied `tempo.frame` against the readable hand formulas it replaced
 *     (comic-tempo.ts keeps `impactPresence`, which the panel draw needs too).
 */

import { describe, expect, it } from "vitest";
import { dopePanelConfig, parseDope, type PassParams } from "@dopaminefx/core";
import { COMIC_FRAGMENT_SRC, COMIC_VERTEX_SRC } from "../src/comic-shader.js";
import { impactPresence, IMPACT_MS, IMPACT_HOLD_MS } from "../src/comic-tempo.js";
import doc from "../src/comic.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePanelConfig(
  DOPE,
  { vertex: COMIC_VERTEX_SRC, fragment: COMIC_FRAGMENT_SRC },
  () => {},
);

/** The web impact `flash` the data replaced (the old factory frame() hook). */
function impactFlash(elapsedMs: number): number {
  const flash =
    Math.exp(-elapsedMs / (IMPACT_MS * 0.55)) +
    0.25 * Math.exp(-Math.abs(elapsedMs - IMPACT_HOLD_MS * 0.2) / (IMPACT_MS * 0.8));
  return Math.min(flash, 1.2);
}

describe("comic derived panel config", () => {
  it("derives the expected uniforms (as a set), bindings, sampler and shadow", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set([
        "uExposure", "uActionLines", "uHalftone", "uSaturation", "uSeed",
        "uPresence", "uFlash", "uDotSize", "uInkBoost", "uPanel",
      ]),
    );
    expect(CONFIG.bindings).toEqual({
      comicSeed: "uSeed",
      overshoot: null,
      scale: null,
      burstPoints: null,
      inkWeight: null,
      dotSize: null,
    });
    expect(CONFIG.panelSampler).toBe("uPanel");
    // Constant shadow height (the panel's implied occluder height).
    expect(CONFIG.shadowHeightFrac).toBe(0.5);
  });

  it("derives the dpr-scaled Ben-Day cell + ink boost from render.pass", () => {
    const out = CONFIG.passUniforms!(
      null as unknown as HTMLCanvasElement,
      { dotSize: 8, style: 0.5 } as never,
      2,
      { width: 600, height: 400 },
    );
    expect(out.uDotSize).toBeCloseTo(8 * 2, 15);
    expect(out.uInkBoost).toBeCloseTo(1 + 0.5 * 0.4, 15);
  });

  it("tempo.frame is DELTA-0 with the hand formulas it replaced", () => {
    for (let i = -10; i <= 120; i++) {
      const life = i / 100;
      for (const durationMs of [1500, 1900, 2400]) {
        const elapsedMs = life * durationMs;
        const params = { durationMs, style: 0, palette: [] } as never;
        const out = CONFIG.frame(
          { elapsedMs, life, dpr: 1, centerPx: { x: 0, y: 0 }, targetPx: { width: 1, height: 1 } },
          params,
        );
        expect(out.amp).toBe(impactPresence(life));
        expect(out.uPresence).toBe(impactPresence(life));
        expect(out.uFlash).toBeCloseTo(impactFlash(elapsedMs), 12);
      }
    }
  });
});

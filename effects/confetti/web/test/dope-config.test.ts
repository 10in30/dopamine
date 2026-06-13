/**
 * Confetti's derived PANEL config — the `.dope` contract.
 *
 * Confetti converged onto the panel-hybrid declarative path (comic/heartburst):
 * everything around the Canvas2D draw is data (confetti.dope.json), derived by
 * the generic `dopePanelConfig`. Pin:
 *   - the derived uniform set + binding exceptions + the panel sampler,
 *   - the constant shadow height (0.5),
 *   - and — the lightning/heartburst/comic posture — DELTA-0 equivalence of the
 *     datafied `tempo.frame.amp` against the readable hand formula it replaced
 *     (confetti-tempo.ts keeps `confettiAmp` as the reference).
 */

import { describe, expect, it } from "vitest";
import { dopePanelConfig, parseDope } from "@dopaminefx/core";
import { CONFETTI_FRAGMENT_SRC, CONFETTI_VERTEX_SRC } from "../src/confetti-shader.js";
import { confettiAmp } from "../src/confetti-tempo.js";
import doc from "../src/confetti.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePanelConfig(
  DOPE,
  { vertex: CONFETTI_VERTEX_SRC, fragment: CONFETTI_FRAGMENT_SRC },
  () => {},
);

describe("confetti derived panel config", () => {
  it("derives the expected uniforms (as a set), bindings, sampler and shadow", () => {
    // exposure auto-binds; every motion param is consumed by the panel draw (not
    // a shader uniform) so it is excluded; uPanel is the panel sampler.
    expect(new Set(CONFIG.uniforms)).toEqual(new Set(["uExposure", "uPanel"]));
    expect(CONFIG.bindings).toEqual({
      pieceSeed: null,
      overshoot: null,
      pieceCount: null,
      spread: null,
      launchSpeed: null,
      gravity: null,
      flutter: null,
      pieceSize: null,
      spin: null,
    });
    expect(CONFIG.panelSampler).toBe("uPanel");
    // Constant shadow height (the panel's implied occluder height).
    expect(CONFIG.shadowHeightFrac).toBe(0.5);
  });

  it("tempo.frame.amp is DELTA-0 with the confettiAmp formula it replaced", () => {
    for (let i = -10; i <= 120; i++) {
      const life = i / 100;
      for (const overshoot of [0.6, 0.9, 1.2]) {
        const params = { overshoot, palette: [] } as never;
        const out = CONFIG.frame(
          { elapsedMs: life * 2000, life, dpr: 1, centerPx: { x: 0, y: 0 }, targetPx: { width: 1, height: 1 } },
          params,
        );
        expect(out.amp).toBeCloseTo(confettiAmp(life, overshoot), 12);
      }
    }
  });
});

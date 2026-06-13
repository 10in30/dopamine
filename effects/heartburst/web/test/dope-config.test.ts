/**
 * Heartburst's derived PANEL config — the `.dope` contract.
 *
 * Heartburst is the panel-class prover for the declarative path: everything
 * around the Canvas2D draw is data (heartburst.dope.json), derived by the
 * generic `dopePanelConfig`. Pin:
 *   - the derived uniform set + binding exceptions + the panel sampler,
 *   - the expression shadow height (heartScale · 1.1),
 *   - the dpr-scaled `render.pass` halftone cell (uDotSize = dotSize · dpr),
 *   - and — the lightning posture — DELTA-0 equivalence of the datafied
 *     `tempo.frame` against the readable hand formulas it replaced
 *     (heartburst-renderer.ts keeps those next to the draw, which needs them
 *     for the panel geometry anyway).
 */

import { describe, expect, it } from "vitest";
import { dopePanelConfig, parseDope, type PassParams } from "@dopamine/core";
import {
  HEARTBURST_FRAGMENT_SRC,
  HEARTBURST_VERTEX_SRC,
} from "../src/heartburst-shader.js";
import {
  heartbeatScale,
  heartburstEnvelope,
  heartPresence,
  burstProgress,
} from "../src/heartburst-renderer.js";
import doc from "../src/heartburst.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePanelConfig(
  DOPE,
  { vertex: HEARTBURST_VERTEX_SRC, fragment: HEARTBURST_FRAGMENT_SRC },
  () => {},
);

/** The web `heartFlash` the data replaced (index.ts, pre-datafication). */
function heartFlash(life: number, beatStrength: number, doubleBeat: number): number {
  const beat = Math.max(0, heartbeatScale(life, beatStrength, doubleBeat) - 1);
  const b = burstProgress(life);
  const burstSpike = b > 0 ? Math.exp(-Math.pow((b - 0.06) / 0.12, 2)) : 0;
  return Math.min(1.2, beat * 1.6 + burstSpike * 0.8);
}

describe("heartburst derived panel config", () => {
  it("derives the expected uniforms (as a set), bindings, sampler and shadow", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set([
        "uExposure", "uGlow", "uGloss", "uHalftone", "uSaturation", "uSeed",
        "uPresence", "uBeat", "uBurst", "uFlash", "uDotSize", "uPanel",
      ]),
    );
    expect(CONFIG.bindings).toEqual({
      heartburstSeed: "uSeed",
      heartScale: null,
      burstCount: null,
      burstSpread: null,
      inkWeight: null,
      beatStrength: null,
      doubleBeat: null,
      dotSize: null,
      seed: null,
    });
    expect(CONFIG.panelSampler).toBe("uPanel");
    // Expression shadow height: heartScale · 1.1.
    expect((CONFIG.shadowHeightFrac as (p: PassParams) => number)({ heartScale: 0.3 } as never)).toBeCloseTo(
      0.33,
      15,
    );
  });

  it("derives the dpr-scaled halftone cell from render.pass", () => {
    const out = CONFIG.passUniforms!(
      null as unknown as HTMLCanvasElement,
      { dotSize: 7.5 } as never,
      2,
      { width: 600, height: 400 },
    );
    expect(out).toEqual({ uDotSize: 7.5 * 2 });
  });

  it("tempo.frame is DELTA-0 with the hand formulas it replaced", () => {
    for (let i = -10; i <= 120; i++) {
      const life = i / 100;
      for (const beatStrength of [0.42, 0.6, 1.0, 1.25, 1.6875]) {
        for (const doubleBeat of [0, 0.3, 1]) {
          const params = { beatStrength, doubleBeat, durationMs: 2000, style: 0, palette: [] } as never;
          const out = CONFIG.frame(
            { elapsedMs: life * 2000, life, dpr: 1, centerPx: { x: 0, y: 0 }, targetPx: { width: 1, height: 1 } },
            params,
          );
          const beat = Math.max(0, heartbeatScale(life, beatStrength, doubleBeat) - 1);
          expect(out.amp).toBe(heartburstEnvelope(life, beatStrength, doubleBeat));
          expect(out.uPresence).toBe(heartPresence(life));
          expect(out.uBeat).toBe(Math.min(1, beat * 2.2));
          expect(out.uBurst).toBe(burstProgress(life));
          expect(out.uFlash).toBe(heartFlash(life, beatStrength, doubleBeat));
        }
      }
    }
  });
});

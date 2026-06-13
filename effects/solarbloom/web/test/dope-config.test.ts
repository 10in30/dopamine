/**
 * Solarbloom's derived PASS config — the `.dope` contract.
 *
 * Solarbloom datafied its code tempo + its aux-texture hooks: `tempo.frame`
 * (amp + the check draw-in), `render.pass` (the checkmark box / SDF stroke /
 * SDF range, all sized to the targeted element), and the DECLARATIVE baked-SDF
 * checkmark (`binding.samplers[].outline`/`on` — the fail precedent). The mote
 * SPRITE PANEL stays a `panelDraw` hook (panel geometry is code by design). Pin:
 *   - the derived uniform set (incl. the sprite-panel + SDF samplers + the
 *     procedural mote uniforms the native shaders read), the bindings,
 *   - the shadow height expression (= bloomRadius),
 *   - the derived SDF aux texture (decoded from geometry.outlines.checkmark,
 *     flipping uSdfOn),
 *   - DELTA-0 equivalence of the datafied tempo against the readable formulas it
 *     replaced (solarbloom-tempo.ts keeps `checkProgress`; amp = `envelope`).
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, envelope, parseDope } from "@dopaminefx/core";
import { VERTEX_SRC, FRAGMENT_SRC } from "../src/solarbloom-shader.js";
import { checkProgress } from "../src/solarbloom-tempo.js";
import doc from "../src/solarbloom.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(
  DOPE,
  { vertex: VERTEX_SRC, fragment: FRAGMENT_SRC },
  {
    panelDraw: () => {},
  },
);

describe("solarbloom derived pass config", () => {
  it("derives the expected uniforms (as a set), bindings and shadow", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set([
        "uExposure", "uBloomRadius", "uMoteCount", "uMoteSpeed", "uTurbulence",
        "uIridescence", "uDispersion", "uMoteSeed",
        "uCheck", "uCheckBox", "uCheckTexOn", "uSdfOn", "uSdfRangePx", "uSdfStrokePx",
        "uCheckTex", "uSdfTex", "uMotePanel",
      ]),
    );
    expect(CONFIG.bindings).toEqual({ moteSeed: "uMoteSeed", overshoot: null });
    expect(typeof CONFIG.shadowHeightFrac).toBe("function");
    // shadowHeightFrac = bloomRadius (params-only expression).
    expect((CONFIG.shadowHeightFrac as (p: never) => number)({ bloomRadius: 0.7 } as never)).toBeCloseTo(0.7, 15);
  });

  it("derives the baked-SDF aux texture (checkmark outline), flipping uSdfOn", () => {
    const aux = CONFIG.auxTextures!({} as never, {} as never);
    const sdf = aux.find((a) => a.kind === "sdf");
    expect(sdf).toBeDefined();
    expect(sdf!.sampler).toBe("uSdfTex");
    expect(sdf!.unit).toBe(1);
    expect((sdf as { onUniform?: string }).onUniform).toBe("uSdfOn");
  });

  it("derives the render.pass checkmark box + SDF stroke/range from the target box", () => {
    const out = CONFIG.passUniforms!(
      null as unknown as HTMLCanvasElement,
      {} as never,
      { width: 600, height: 400 },
      1,
    );
    // box = 0.16 * targetMinDimPx(400); stroke = box * 0.11.
    expect(out.uCheckBox).toBeCloseTo(0.16 * 400, 12);
    expect(out.uSdfStrokePx).toBeCloseTo(0.16 * 400 * 0.11, 12);
    // sdfRangePx = sdfRange * (2*box / sdfViewBoxW); the baked checkmark SDF is
    // range 18 over a 100-unit viewBox.
    expect(out.uSdfRangePx).toBeCloseTo(18 * ((2 * 0.16 * 400) / 100), 10);
  });

  it("tempo.frame is DELTA-0 with the hand formulas it replaced", () => {
    for (let i = -10; i <= 120; i++) {
      const life = i / 100;
      for (const overshoot of [0.7, 1.0, 1.25]) {
        const durationMs = 1800;
        const elapsedMs = life * durationMs;
        const params = { overshoot, palette: [] } as never;
        const out = CONFIG.frame(
          { animMs: elapsedMs, life, elapsedMs },
          params,
        );
        expect(out.amp).toBeCloseTo(envelope(life, overshoot), 12);
        // check draws on the REAL (un-stepped) elapsed clock.
        expect(out.uCheck).toBeCloseTo(checkProgress(elapsedMs), 12);
      }
    }
  });
});

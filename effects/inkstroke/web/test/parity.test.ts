/**
 * Inkstroke (Calligraphic Verdict) byte-parity REGRESSION GUARD.
 *
 * The `.dope` loader output + the factory's `resolve` MUST equal the frozen
 * legacy `resolveInkParams` oracle BYTE-FOR-BYTE across the grid (incl. the
 * seeded palette / rng order).
 */

import { describe, expect, it } from "vitest";

import { parseDope, resolveDopeParams, resolveMood, type DopamineMood } from "@dopamine/core";
import { resolveInkParams, MAX_DROPS } from "../src/inkstroke-oracle.js";
import { inkstroke } from "../src/index.js";
import inkstrokeDoc from "../src/inkstroke.dope.json";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

const grid: { mood: DopamineMood; intensity: number; whimsy: number; seed: number }[] = [];
for (const mood of MOODS) {
  for (const intensity of [0, 0.25, 0.5, 0.7, 0.85, 1]) {
    for (const whimsy of [0, 0.33, 0.5, 0.75, 1]) {
      for (const seed of [1, 42, 1234, 999983]) {
        grid.push({ mood, intensity, whimsy, seed });
      }
    }
  }
}

const NUMERIC_KEYS = ["seed", "durationMs", "exposure", "overshoot", "scale",
  "pressure", "wetness", "bristle", "droplets", "style", "inkSeed"];

describe("Verdict .dope loader parity vs legacy resolveInkParams", () => {
  it("loader == resolveInkParams across the grid (numeric + palette)", () => {
    const doc = parseDope(inkstrokeDoc as object);
    for (const f of grid) {
      const bag = resolveDopeParams(doc, f, { MAX_DROPS }, "inkSeed");
      const legacy = resolveInkParams(f) as unknown as Record<string, unknown>;
      for (const k of NUMERIC_KEYS) expect(bag[k], `field ${k}`).toEqual(legacy[k]);
      expect(bag.palette).toEqual(legacy.palette);
    }
  });

  it("factory.resolve == resolveInkParams across the grid", () => {
    for (const f of grid) {
      expect(inkstroke.resolve({ ...f }, resolveMood(f.mood))).toEqual(resolveInkParams(f));
    }
  });
});

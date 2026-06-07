/**
 * Solarbloom byte-parity REGRESSION GUARD.
 *
 * For every built-in mood across a grid of intensity × whimsy × seed, the params
 * the `.dope` loader resolves from the bundled solarbloom.dope.json MUST equal
 * the frozen legacy `resolveParams` oracle BYTE-FOR-BYTE (including the seeded
 * palette, which depends on the PRNG being consumed in the exact same order).
 * This proves flipping the source of truth to the data file changes nothing.
 */

import { describe, expect, it } from "vitest";

import { parseDope, resolveDopeParams, pickBand, getOutline, decodeSdf, resolveMood, type DopamineMood } from "@dopamine/core";
import { resolveParams, pickCheckGlyph, MAX_MOTES } from "../src/solarbloom-oracle.js";
import { solarbloom } from "../src/index.js";
import solarbloomDoc from "../src/solarbloom.dope.json";

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

const NUMERIC_KEYS = ["seed", "durationMs", "exposure", "bloomRadius", "moteCount",
  "moteSpeed", "turbulence", "overshoot", "iridescence", "dispersion", "style", "moteSeed"];

describe("Solarbloom .dope loader parity vs legacy resolveParams", () => {
  it("loader == resolveParams across the grid (numeric + palette)", () => {
    const doc = parseDope(solarbloomDoc as object);
    for (const f of grid) {
      const bag = resolveDopeParams(doc, f, { MAX_MOTES }, "moteSeed");
      const legacy = resolveParams(f) as unknown as Record<string, unknown>;
      for (const k of NUMERIC_KEYS) expect(bag[k], `field ${k}`).toEqual(legacy[k]);
      expect(bag.palette).toEqual(legacy.palette);
    }
  });

  it("factory.resolve == resolveParams across the grid (incl. checkGlyph)", () => {
    for (const f of grid) {
      expect(solarbloom.resolve({ ...f }, resolveMood(f.mood))).toEqual(resolveParams(f));
    }
  });
});

describe("Solarbloom check-glyph band parity (pickBand == pickCheckGlyph)", () => {
  const doc = parseDope(solarbloomDoc as object);
  const bands = (doc.content as { glyphBands: { family: string; char: string }[] }).glyphBands;

  it("picks the same glyph per whimsy across the slider", () => {
    for (const w of [0, 0.1, 0.32, 0.33, 0.34, 0.5, 0.66, 0.67, 0.75, 0.99, 1]) {
      expect(pickBand(bands, w)).toEqual(pickCheckGlyph(w));
    }
  });
});

describe("bundled Solarbloom .dope carries a baked checkmark SDF", () => {
  it("ships a valid, standalone, decodable SDF for the svgPath icon", () => {
    const doc = parseDope(solarbloomDoc as object); // standalone guard passes
    const outline = getOutline(doc, "checkmark");
    expect(outline?.svgPath).toBeTypeOf("string");
    expect(outline?.sdf).toBeDefined();
    const dec = decodeSdf(outline!.sdf!);
    expect(dec.size * dec.size).toBe(dec.bytes.length);
  });
});

/**
 * `.dope` loader parity — the correctness anchor for Phase 3.
 *
 * For every built-in mood across a grid of intensity × whimsy × seed, the
 * params the loader resolves from the bundled `.dope` document MUST equal the
 * legacy `resolve*Params` BYTE-FOR-BYTE (including the seeded palette, which
 * depends on the PRNG being consumed in the exact same order). This proves the
 * mapping grammar + palette rules + rng order in `loader.ts` faithfully capture
 * the engine, so a `.dope` file can drive a real effect with no visual change.
 */

import { describe, expect, it } from "vitest";

import { parseDope, resolveDopeParams } from "../src/framework/loader.js";
import { resolveParams, resolveInkParams, resolveComicParams, MAX_MOTES, MAX_DROPS } from "../src/engine/mood.js";
import type { DopamineMood } from "../src/types.js";

import solarbloomDoc from "../src/effects/solarbloom.dope.json";
import inkstrokeDoc from "../src/effects/inkstroke.dope.json";
import comicDoc from "../src/effects/comic.dope.json";

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

/** Compare a loader bag against a legacy params object on the shared keys. */
function expectParity(
  loaderBag: Record<string, unknown>,
  legacy: Record<string, unknown>,
  keys: string[],
): void {
  for (const k of keys) {
    expect(loaderBag[k], `field ${k}`).toEqual(legacy[k]);
  }
  // Palette parity (3 linear-RGB stops, exact floats from the same rng stream).
  expect(loaderBag.palette).toEqual(legacy.palette);
}

describe(".dope loader parity vs legacy resolve*Params", () => {
  it("Solarbloom: loader == resolveParams across the grid", () => {
    const doc = parseDope(solarbloomDoc as object);
    const keys = ["seed", "durationMs", "exposure", "bloomRadius", "moteCount",
      "moteSpeed", "turbulence", "overshoot", "iridescence", "dispersion", "style", "moteSeed"];
    for (const f of grid) {
      const bag = resolveDopeParams(doc, f, { MAX_MOTES }, "moteSeed");
      expectParity(bag, resolveParams(f) as unknown as Record<string, unknown>, keys);
    }
  });

  it("Verdict: loader == resolveInkParams across the grid", () => {
    const doc = parseDope(inkstrokeDoc as object);
    const keys = ["seed", "durationMs", "exposure", "overshoot", "scale",
      "pressure", "wetness", "bristle", "droplets", "style", "inkSeed"];
    for (const f of grid) {
      const bag = resolveDopeParams(doc, f, { MAX_DROPS }, "inkSeed");
      expectParity(bag, resolveInkParams(f) as unknown as Record<string, unknown>, keys);
    }
  });

  it("Comic: loader == resolveComicParams (numeric/palette fields) across the grid", () => {
    const doc = parseDope(comicDoc as object);
    // Comic also resolves typography + word in code; the loader covers the
    // numeric panel + palette params, which must match byte-for-byte.
    const keys = ["seed", "durationMs", "exposure", "overshoot", "scale",
      "burstPoints", "actionLines", "inkWeight", "halftone", "dotSize",
      "saturation", "style", "comicSeed"];
    for (const f of grid) {
      const bag = resolveDopeParams(doc, f, {}, "comicSeed");
      expectParity(bag, resolveComicParams(f) as unknown as Record<string, unknown>, keys);
    }
  });

  it("rejects a bad magic or unsupported major version", () => {
    expect(() => parseDope({ fmt: "nope", v: "1.0.0" })).toThrow();
    expect(() =>
      parseDope({ fmt: "dopamine-effect", v: "2.0.0", render: { params: {} }, palette: { perMood: {} }, baselines: {} }),
    ).toThrow();
  });

  it("the three shipped .dope docs carry the schema-required top-level keys", () => {
    for (const doc of [solarbloomDoc, inkstrokeDoc, comicDoc] as Record<string, unknown>[]) {
      for (const key of ["fmt", "v", "id", "controls", "palette", "tempo", "render"]) {
        expect(doc[key], `${doc.id as string} missing ${key}`).toBeDefined();
      }
      expect(doc.fmt).toBe("dopamine-effect");
      // parseDope (the loader's own validation) accepts each shipped doc.
      expect(() => parseDope(doc)).not.toThrow();
    }
  });
});

describe("standalone guard", () => {
  it("accepts the bundled self-contained docs", () => {
    expect(() => parseDope(solarbloomDoc as object)).not.toThrow();
    expect(() => parseDope(inkstrokeDoc as object)).not.toThrow();
    expect(() => parseDope(comicDoc as object)).not.toThrow();
  });

  it("rejects a remote/external asset reference", () => {
    const bad = JSON.parse(JSON.stringify(solarbloomDoc));
    bad.render.backends.webgl2.shader = { $ref: "https://cdn.example.com/x.frag.glsl" };
    expect(() => parseDope(bad)).toThrow(/self-contained|external asset/);
  });

  it("rejects an absolute-path reference", () => {
    const bad = JSON.parse(JSON.stringify(solarbloomDoc));
    bad.render.backends.webgl2.shader = { $ref: "/usr/share/shaders/x.glsl" };
    expect(() => parseDope(bad)).toThrow(/self-contained|external asset/);
  });
});

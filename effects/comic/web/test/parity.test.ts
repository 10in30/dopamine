/**
 * Comic Impact byte-parity REGRESSION GUARD.
 *
 * The `.dope`-driven path (loader numeric/palette + content `pool` word pick +
 * typography resolver) and the factory's `resolve` MUST equal the frozen legacy
 * `resolveComicParams` / `pickWord` / `comicTypography` oracle BYTE-FOR-BYTE.
 */

import { describe, expect, it } from "vitest";

import {
  parseDope,
  resolveDopeParams,
  pickFromList,
  resolveTypography,
  resolveMood,
  type DopeTypography,
  type DopamineMood,
} from "@dopamine/core";
import {
  resolveComicParams,
  pickWord,
  comicTypography,
  COMIC_GLYPHS,
} from "../src/comic-oracle.js";
import { comic } from "../src/index.js";
import comicDoc from "../src/comic.dope.json";

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
  "burstPoints", "actionLines", "inkWeight", "halftone", "dotSize",
  "saturation", "style", "comicSeed"];

describe("Comic .dope loader parity vs legacy resolveComicParams", () => {
  it("loader == resolveComicParams (numeric/palette) across the grid", () => {
    const doc = parseDope(comicDoc as object);
    for (const f of grid) {
      const bag = resolveDopeParams(doc, f, {}, "comicSeed");
      const legacy = resolveComicParams(f) as unknown as Record<string, unknown>;
      for (const k of NUMERIC_KEYS) expect(bag[k], `field ${k}`).toEqual(legacy[k]);
      expect(bag.palette).toEqual(legacy.palette);
    }
  });

  it("factory.resolve == resolveComicParams across the grid", () => {
    for (const f of grid) {
      expect(comic.resolve({ ...f }, resolveMood(f.mood))).toEqual(resolveComicParams(f));
    }
  });
});

describe("Comic content pool parity (pickFromList == pickWord)", () => {
  const doc = parseDope(comicDoc as object);
  const pool = (doc.content as { pool: string[] }).pool;

  it("the .dope pool equals the legacy COMIC_GLYPHS pool", () => {
    expect(pool).toEqual([...COMIC_GLYPHS]);
  });

  it("picks the same token per seed across a wide seed range", () => {
    for (const seed of [0, 1, 2, 7, 42, 1234, 99999, 999983, 7777777]) {
      expect(pickFromList(pool, seed)).toBe(pickWord(seed));
    }
  });
});

describe("Comic typography parity (resolveTypography == comicTypography)", () => {
  const doc = parseDope(comicDoc as object);
  const typo = doc.typography as unknown as DopeTypography;

  it("matches every typographic field across mood × intensity × whimsy", () => {
    for (const mood of MOODS) {
      for (const intensity of [0, 0.25, 0.5, 0.7, 0.85, 1]) {
        for (const whimsy of [0, 0.33, 0.5, 0.75, 1]) {
          const got = resolveTypography(typo, mood, intensity, whimsy);
          const legacy = comicTypography(mood, intensity, whimsy) as unknown as Record<string, unknown>;
          for (const k of [
            "fontStack", "fontSkew", "fontTilt", "fontStretchX", "fontTracking",
            "outlineLayers", "extrudeDepth", "letterRotJitter", "letterBaselineJitter", "inkRoundness",
          ]) {
            expect(got[k], `${k} @ ${mood} i=${intensity} w=${whimsy}`).toEqual(legacy[k]);
          }
        }
      }
    }
  });
});

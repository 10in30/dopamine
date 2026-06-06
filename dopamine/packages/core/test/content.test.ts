/**
 * Phase 3 parity — the data-driven CONTENT + TYPOGRAPHY resolvers reproduce the
 * legacy code-shaped tables in engine/mood.ts BYTE-FOR-BYTE.
 *
 * Phase 3 moved Comic's word/checkmark pool + the typography (mood→face + the
 * whimsy/intensity curve table) and Solarbloom's whimsy→check-glyph bands out of
 * code and into the `.dope`. These tests assert the loader/content resolvers
 * (pickFromList / resolveTypography / pickBand over the bundled `.dope` data)
 * equal the legacy `pickWord` / `comicTypography` / `pickCheckGlyph` across a
 * grid — so the built-ins stay identical while reskinning becomes no-code.
 */

import { describe, expect, it } from "vitest";

import { parseDope } from "../src/framework/loader.js";
import { pickFromList, pickBand, resolveTypography, type DopeTypography } from "../src/framework/content.js";
import {
  pickWord,
  comicTypography,
  pickCheckGlyph,
  COMIC_GLYPHS,
} from "../src/engine/mood.js";
import type { DopamineMood } from "../src/types.js";

import comicDoc from "../src/effects/comic.dope.json";
import solarbloomDoc from "../src/effects/solarbloom.dope.json";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

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

describe("Solarbloom check-glyph band parity (pickBand == pickCheckGlyph)", () => {
  const doc = parseDope(solarbloomDoc as object);
  const bands = (doc.content as { glyphBands: { family: string; char: string }[] }).glyphBands;

  it("picks the same glyph per whimsy across the slider", () => {
    for (const w of [0, 0.1, 0.32, 0.33, 0.34, 0.5, 0.66, 0.67, 0.75, 0.99, 1]) {
      expect(pickBand(bands, w)).toEqual(pickCheckGlyph(w));
    }
  });
});

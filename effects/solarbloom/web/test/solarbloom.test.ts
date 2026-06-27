/**
 * Solarbloom production-path functional tests: the `.dope`-driven factory
 * resolve (determinism, ranges, the mood/intensity/whimsy axes), the whimsy →
 * check-glyph band selection, and the bundled baked-SDF icon.
 */

import { describe, expect, it } from "vitest";
import {
  parseDope,
  pickBand,
  getOutline,
  decodeSdf,
  resolveMood,
  type DopamineMood,
} from "@dopaminefx/core";
// The mote cap is owned by the shader that `#define`s it (single source of truth).
import { MAX_MOTES } from "../src/solarbloom-shader.js";
// Importing the effect registers it (self-registers on import).
import { solarbloom } from "../src/index.js";
import solarbloomDoc from "../src/solarbloom.dope.json";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

/** The production path: the factory's `.dope`-driven resolve. */
const resolve = (mood: DopamineMood, intensity: number, whimsy: number, seed: number) =>
  solarbloom.resolve({ mood, intensity, whimsy, seed }, resolveMood(mood));

describe("solarbloom resolve", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolve("celebratory", 0.7, 0.5, 99);
    const b = resolve("celebratory", 0.7, 0.5, 99);
    expect(a).toEqual(b);
  });

  it("produces sane, in-range params for every mood", () => {
    for (const mood of MOODS) {
      const p = resolve(mood, 0.7, 0.5, 7);
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(Number.isInteger(p.moteCount)).toBe(true);
      expect(p.moteCount).toBeGreaterThan(0);
      expect(p.moteCount).toBeLessThanOrEqual(MAX_MOTES); // shader MAX_MOTES
      expect(p.exposure).toBeGreaterThan(0);
    }
  });

  it("higher intensity raises exposure (brighter == more arousing)", () => {
    const lo = resolve("celebratory", 0.1, 0.5, 5);
    const hi = resolve("celebratory", 0.95, 0.5, 5);
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
  });

  it("intensity scales bloom size: ~40% of baseline at low → full baseline at 1.0", () => {
    // bloomRadius = baseline * lerp(intensity, 0.4, 1.0); baseline is the max.
    const baseline = (solarbloomDoc as { baselines: Record<string, { bloomRadius: number }> })
      .baselines.celebratory.bloomRadius;
    const lo = resolve("celebratory", 0, 0.5, 5);
    const hi = resolve("celebratory", 1, 0.5, 5);
    const mid = resolve("celebratory", 0.5, 0.5, 5);
    expect(lo.bloomRadius).toBeCloseTo(baseline * 0.4);
    expect(hi.bloomRadius).toBeCloseTo(baseline);
    // Monotonic growth, never above baseline.
    expect(mid.bloomRadius).toBeGreaterThan(lo.bloomRadius);
    expect(mid.bloomRadius).toBeLessThan(hi.bloomRadius);
    expect(hi.bloomRadius).toBeGreaterThanOrEqual(mid.bloomRadius);
  });

  it("intensity scales mote count: floor of MIN(6) at low → baseline at 1.0", () => {
    // moteCount = round(6 + (baseline - 6) * intensity); baseline is the max (≤ MAX_MOTES).
    const baseline = (solarbloomDoc as { baselines: Record<string, { moteCount: number }> })
      .baselines.celebratory.moteCount;
    const lo = resolve("celebratory", 0, 0.5, 5);
    const hi = resolve("celebratory", 1, 0.5, 5);
    const mid = resolve("celebratory", 0.5, 0.5, 5);
    expect(lo.moteCount).toBe(6);
    expect(hi.moteCount).toBe(baseline);
    expect(mid.moteCount).toBeGreaterThan(lo.moteCount);
    expect(mid.moteCount).toBeLessThan(hi.moteCount);
    expect(hi.moteCount).toBeLessThanOrEqual(MAX_MOTES);
  });

  it("intensity does NOT affect timing: durationMs is identical across intensities", () => {
    const lo = resolve("celebratory", 0.0, 0.5, 5);
    const mid = resolve("celebratory", 0.5, 0.5, 5);
    const hi = resolve("celebratory", 1.0, 0.5, 5);
    expect(mid.durationMs).toBe(lo.durationMs);
    expect(hi.durationMs).toBe(lo.durationMs);
  });

  it("whimsy is the stylization axis: higher whimsy raises style and flattens photoreal light", () => {
    const lo = resolve("celebratory", 0.7, 0.0, 5);
    const hi = resolve("celebratory", 0.7, 1.0, 5);
    expect(lo.style).toBe(0);
    expect(hi.style).toBe(1);
    // Toward the cel/NPR end, oil-slick iridescence recedes.
    expect(hi.iridescence).toBeLessThan(lo.iridescence);
  });

  it("style is clamped to 0..1 and tracks whimsy", () => {
    expect(resolve("serene", 0.5, 0.3, 1).style).toBeCloseTo(0.3);
    expect(resolve("serene", 0.5, 2, 1).style).toBe(1);
  });

  it("electric is faster than serene", () => {
    const electric = resolve("electric", 0.7, 0.5, 1);
    const serene = resolve("serene", 0.7, 0.5, 1);
    expect(electric.durationMs).toBeLessThan(serene.durationMs);
  });
});

describe("check-glyph band selection (whimsy → content.glyphBands)", () => {
  const doc = parseDope(solarbloomDoc as object);
  const bands = (doc.content as { glyphBands: { family: string; char: string }[] }).glyphBands;

  it("splits the whimsy slider into equal bands, refined ✓ low → bold playful ✔ high", () => {
    expect(bands).toEqual([
      { family: "Dopamine Check Symbols", char: "✓" }, // elegant calligraphic ✓
      { family: "Dopamine Check Sans", char: "✔" }, // clean humanist heavy ✔
      { family: "Dopamine Check Symbols", char: "✔" }, // fat playful heavy ✔
    ]);
    expect(pickBand(bands, 0)).toEqual(bands[0]);
    expect(pickBand(bands, 0.33)).toEqual(bands[0]);
    expect(pickBand(bands, 0.34)).toEqual(bands[1]);
    expect(pickBand(bands, 0.66)).toEqual(bands[1]);
    expect(pickBand(bands, 0.67)).toEqual(bands[2]);
    expect(pickBand(bands, 1)).toEqual(bands[2]);
  });

  it("the resolved params carry the whimsy-picked glyph", () => {
    expect(resolve("serene", 0.5, 0, 1).checkGlyph).toEqual(bands[0]);
    expect(resolve("serene", 0.5, 1, 1).checkGlyph).toEqual(bands[2]);
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

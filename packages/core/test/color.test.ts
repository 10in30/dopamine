import { describe, expect, it } from "vitest";
import { buildPalette, oklchToLinearSrgb, parseBackdrop, wrapHue, GOLDEN_ANGLE_DEG } from "../src/engine/color.js";
import { mulberry32 } from "../src/engine/seed.js";

describe("parseBackdrop", () => {
  it("parses #rrggbb and computes luminance (0 black .. 1 white)", () => {
    expect(parseBackdrop("#000000")).toEqual({ rgb: { r: 0, g: 0, b: 0 }, luminance: 0 });
    const white = parseBackdrop("#ffffff")!;
    expect(white.rgb).toEqual({ r: 1, g: 1, b: 1 });
    expect(white.luminance).toBeCloseTo(1);
  });

  it("parses #rgb shorthand and is case-insensitive", () => {
    const a = parseBackdrop("#FFF")!;
    expect(a.rgb).toEqual({ r: 1, g: 1, b: 1 });
  });

  it("parses rgb()/rgba() (comma- or space-separated, incl. %)", () => {
    expect(parseBackdrop("rgb(255, 255, 255)")!.luminance).toBeCloseTo(1);
    expect(parseBackdrop("rgb(20 24 37)")!.rgb.r).toBeCloseTo(20 / 255);
    expect(parseBackdrop("rgba(0,0,0,0.5)")!.luminance).toBe(0);
    expect(parseBackdrop("rgb(100% 0% 0%)")!.rgb).toEqual({ r: 1, g: 0, b: 0 });
  });

  it("ranks a light surface above a dark one (the shadow-strength knob)", () => {
    expect(parseBackdrop("#ffffff")!.luminance).toBeGreaterThan(parseBackdrop("#070910")!.luminance);
  });

  it("returns null for an unparseable colour (no DOM fallback available)", () => {
    expect(parseBackdrop("not-a-color")).toBeNull();
  });
});

describe("wrapHue", () => {
  it("wraps into [0, 360)", () => {
    expect(wrapHue(0)).toBe(0);
    expect(wrapHue(360)).toBe(0);
    expect(wrapHue(-10)).toBeCloseTo(350);
    expect(wrapHue(730)).toBeCloseTo(10);
  });
});

describe("oklchToLinearSrgb", () => {
  it("returns channels clamped to [0,1]", () => {
    for (const h of [0, 60, 120, 200, 300, 359]) {
      const c = oklchToLinearSrgb({ L: 0.8, C: 0.2, h });
      for (const v of [c.r, c.g, c.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic", () => {
    const a = oklchToLinearSrgb({ L: 0.7, C: 0.15, h: 145 });
    const b = oklchToLinearSrgb({ L: 0.7, C: 0.15, h: 145 });
    expect(a).toEqual(b);
  });

  it("near-zero chroma is roughly achromatic (r≈g≈b)", () => {
    const c = oklchToLinearSrgb({ L: 0.6, C: 0.0001, h: 30 });
    expect(Math.abs(c.r - c.g)).toBeLessThan(0.02);
    expect(Math.abs(c.g - c.b)).toBeLessThan(0.02);
  });
});

describe("buildPalette", () => {
  const params = { lightness: 0.8, chroma: 0.16, hueCenter: 50, hueRange: 320, hueSpread: 0.6 };

  it("produces exactly three in-gamut stops", () => {
    const stops = buildPalette(mulberry32(1234), params);
    expect(stops).toHaveLength(3);
    for (const s of stops) {
      for (const v of [s.r, s.g, s.b]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("is deterministic for a fixed seed", () => {
    expect(buildPalette(mulberry32(42), params)).toEqual(buildPalette(mulberry32(42), params));
  });

  it("differs across seeds (unique every time)", () => {
    const a = JSON.stringify(buildPalette(mulberry32(1), params));
    const b = JSON.stringify(buildPalette(mulberry32(2), params));
    expect(a).not.toEqual(b);
  });
});

it("golden angle constant is ~137.5°", () => {
  expect(GOLDEN_ANGLE_DEG).toBeGreaterThan(137);
  expect(GOLDEN_ANGLE_DEG).toBeLessThan(138);
});

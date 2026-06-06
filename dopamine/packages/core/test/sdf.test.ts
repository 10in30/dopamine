/**
 * Geometry seam — SVG path → baked SDF → decode round-trip.
 *
 * Proves the build-time baker (engine/sdf.ts) that the geometry seam relies on:
 * a path parses to polylines, bakes to a self-contained `data:` SDF blob, decodes
 * back to the declared grid, and the field reads ~0 ON the stroke and large far
 * from it. Also confirms the bundled Solarbloom `.dope` ships a valid baked SDF
 * for its checkmark (so the runtime samples, never re-bakes) and that the blob is
 * standalone (a `data:` URI — passes the loader guard).
 */

import { describe, expect, it } from "vitest";

import { parseSvgPath, bakeSdf, decodeSdf } from "../src/engine/sdf.js";
import { parseDope, getOutline } from "../src/framework/loader.js";
import solarbloomDoc from "../src/effects/solarbloom.dope.json";

describe("svg path parser", () => {
  it("parses an absolute polyline (the checkmark)", () => {
    const polys = parseSvgPath("M 5 55 L 38 88 L 95 12");
    expect(polys).toHaveLength(1);
    expect(polys[0]).toEqual([
      { x: 5, y: 55 },
      { x: 38, y: 88 },
      { x: 95, y: 12 },
    ]);
  });

  it("flattens a quadratic and closes a Z", () => {
    const polys = parseSvgPath("M 0 0 Q 50 100 100 0 Z");
    expect(polys).toHaveLength(1);
    const p = polys[0]!;
    expect(p[0]).toEqual({ x: 0, y: 0 });
    // last point returns to the start (Z)
    expect(p[p.length - 1]).toEqual({ x: 0, y: 0 });
    // midpoint of the quadratic bows toward y=50
    const mid = p[Math.floor(p.length / 2)]!;
    expect(mid.y).toBeGreaterThan(30);
  });

  it("handles relative commands", () => {
    const polys = parseSvgPath("M 10 10 l 10 0 l 0 10");
    expect(polys[0]).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
    ]);
  });
});

describe("bake + decode round-trip", () => {
  const viewBox: [number, number, number, number] = [0, 0, 100, 100];

  it("bakes a self-contained data: SDF and decodes the declared grid", () => {
    const baked = bakeSdf("M 5 55 L 38 88 L 95 12", viewBox, 64, 18);
    expect(baked.size).toBe(64);
    expect(baked.range).toBe(18);
    expect(baked.data.startsWith("data:")).toBe(true);
    const dec = decodeSdf(baked);
    expect(dec.size).toBe(64);
    expect(dec.bytes.length).toBe(64 * 64);
  });

  it("reads ~0 on the stroke and large far away", () => {
    const baked = bakeSdf("M 0 50 L 100 50", viewBox, 64, 18); // horizontal line at y=50
    const dec = decodeSdf(baked);
    const at = (gx: number, gy: number): number => dec.bytes[gy * dec.size + gx]!;
    const mid = Math.floor(dec.size / 2);
    // On the line (row ~ center): near 0.
    expect(at(mid, mid)).toBeLessThan(20);
    // Top row, far from the line: saturated toward 255.
    expect(at(mid, 0)).toBeGreaterThan(200);
  });

  it("is deterministic (idempotent bake)", () => {
    const a = bakeSdf("M 5 55 L 38 88 L 95 12", viewBox, 48, 16);
    const b = bakeSdf("M 5 55 L 38 88 L 95 12", viewBox, 48, 16);
    expect(a.data).toBe(b.data);
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

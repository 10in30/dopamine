/**
 * Confetti effect — params resolution + determinism guard.
 *
 * Per the authoring guide (§7.5) we pin a seed and assert the shape/look of the resolved params: every
 * declared mood resolves, intensity scales count/spread/launch, whimsy drives
 * style, and a pinned seed reproduces byte-for-byte (PRNG order is load-bearing —
 * palette base hue first, then the per-fire pieceSeed scatter offset).
 */

import { describe, expect, it } from "vitest";

import { confetti } from "../src/index.js";
import { resolveMood, type FeelingInput } from "@dopaminefx/core";

const MOODS = ["serene", "celebratory", "electric"] as const;

function feel(over: Partial<FeelingInput> = {}): FeelingInput {
  return { mood: "celebratory", intensity: 0.75, whimsy: 0.5, seed: 1234, ...over };
}

function resolve(over: Partial<FeelingInput> = {}) {
  const f = feel(over);
  return confetti.resolve(f, resolveMood(f.mood)) as unknown as Record<string, number | number[][]>;
}

describe("confetti.resolve", () => {
  it("resolves every declared mood to a sane param bag", () => {
    for (const mood of MOODS) {
      const p = resolve({ mood });
      expect(p.durationMs).toBeGreaterThan(500);
      expect(p.pieceCount).toBeGreaterThan(0);
      expect(p.pieceCount).toBeLessThanOrEqual(120); // clamped to MAX_PIECES
      expect(p.gravity).toBeGreaterThan(0); // the DOWNWARD pull is always present
      expect(p.launchSpeed).toBeGreaterThan(0);
      expect(p.flutter).toBeGreaterThan(0);
      expect(Array.isArray(p.palette)).toBe(true);
      expect((p.palette as number[][]).length).toBe(3); // three OKLCH-derived stops
    }
  });

  it("degrades an undeclared mood to its own default (resolves, never throws)", () => {
    expect(() => resolve({ mood: "denied" })).not.toThrow();
    const p = resolve({ mood: "denied" });
    // default mood is celebratory → matches the celebratory baseline duration band
    expect(p.durationMs).toBeGreaterThan(1000);
  });

  it("intensity scales the spatial footprint + count up, but not playback tempo", () => {
    const lo = resolve({ intensity: 0.1 });
    const hi = resolve({ intensity: 1.0 });
    // size/extent (footprint = spread + launch DISTANCE) + count + piece size all
    // correlate with intensity. `spread` is LINEAR (≈10% at 0.1); `launchSpeed`
    // floors at 40%; together a low-intensity burst is a small, short puff of a
    // few pieces.
    expect(hi.pieceCount).toBeGreaterThan(lo.pieceCount as number);
    expect(hi.spread).toBeGreaterThan(lo.spread as number);
    expect(hi.launchSpeed).toBeGreaterThan(lo.launchSpeed as number);
    expect(hi.pieceSize).toBeGreaterThan(lo.pieceSize as number);
    // PLAYBACK TEMPO comes only from mood — invariant across intensity.
    expect(hi.flutter).toBe(lo.flutter as number);
    expect(hi.durationMs).toBe(lo.durationMs as number);
    // linear footprint: at intensity 0.1 the spread is ~10% of the intensity-1 value.
    expect((lo.spread as number) / (hi.spread as number)).toBeCloseTo(0.1, 5);
  });

  it("whimsy drives style (raw control passthrough)", () => {
    expect(resolve({ whimsy: 0 }).style).toBe(0);
    expect(resolve({ whimsy: 1 }).style).toBe(1);
  });

  it("a pinned seed reproduces the palette + scatter byte-for-byte", () => {
    const a = resolve({ seed: 9876 });
    const b = resolve({ seed: 9876 });
    expect(a.pieceSeed).toBe(b.pieceSeed);
    expect(a.palette).toEqual(b.palette);
    // and a different seed gives a different per-fire scatter offset
    const c = resolve({ seed: 5555 });
    expect(c.pieceSeed).not.toBe(a.pieceSeed);
  });
});

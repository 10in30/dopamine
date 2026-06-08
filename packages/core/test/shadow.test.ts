import { describe, expect, it } from "vitest";
import { shadowGeometry } from "../src/engine/shadow.js";

const base = { minDim: 800, heightFrac: 0.7, amp: 1, style: 0 };

describe("shadowGeometry", () => {
  it("casts the shadow down-and-right (key light up-left)", () => {
    const g = shadowGeometry(base);
    // gl coords: Y up, so a downward screen shadow is -Y; leans right (+X).
    expect(g.offsetX).toBeGreaterThan(0);
    expect(g.offsetY).toBeLessThan(0);
    // Lean is shallower than the drop.
    expect(Math.abs(g.offsetX)).toBeLessThan(Math.abs(g.offsetY));
  });

  it("offset grows with height (a higher source throws a longer shadow)", () => {
    const low = shadowGeometry({ ...base, heightFrac: 0.4 });
    const high = shadowGeometry({ ...base, heightFrac: 0.9 });
    expect(Math.abs(high.offsetY)).toBeGreaterThan(Math.abs(low.offsetY));
  });

  it("offset grows with amplitude but saturates", () => {
    const quiet = shadowGeometry({ ...base, amp: 0.3 });
    const peak = shadowGeometry({ ...base, amp: 1.5 });
    const over = shadowGeometry({ ...base, amp: 3.0 });
    expect(Math.abs(peak.offsetY)).toBeGreaterThan(Math.abs(quiet.offsetY));
    // amp is clamped at 1.5 internally, so beyond that it stops growing.
    expect(Math.abs(over.offsetY)).toBeCloseTo(Math.abs(peak.offsetY), 5);
  });

  it("penumbra tightens toward the cel/graphic end", () => {
    const photoreal = shadowGeometry({ ...base, style: 0 });
    const cel = shadowGeometry({ ...base, style: 1 });
    expect(cel.soft).toBeLessThan(photoreal.soft);
    expect(cel.soft).toBeGreaterThan(0);
  });

  it("strength stays subtle and within 0..1", () => {
    for (const style of [0, 0.5, 1]) {
      const g = shadowGeometry({ ...base, style });
      expect(g.strength).toBeGreaterThan(0);
      expect(g.strength).toBeLessThanOrEqual(1);
      // Subtle ambient at the photoreal end; a firmer graphic drop-shadow toward
      // cel, but never a harsh full blackout.
      expect(g.strength).toBeLessThan(0.8);
    }
  });

  it("is more pronounced toward the cel/graphic end", () => {
    const photoreal = shadowGeometry({ ...base, style: 0 });
    const cel = shadowGeometry({ ...base, style: 1 });
    expect(cel.strength).toBeGreaterThan(photoreal.strength);
  });

  it("scales geometry with canvas size", () => {
    const small = shadowGeometry({ ...base, minDim: 400 });
    const large = shadowGeometry({ ...base, minDim: 1600 });
    expect(large.soft).toBeGreaterThan(small.soft);
    expect(Math.abs(large.offsetY)).toBeGreaterThan(Math.abs(small.offsetY));
    // strength is size-independent.
    expect(large.strength).toBeCloseTo(small.strength, 5);
  });
});

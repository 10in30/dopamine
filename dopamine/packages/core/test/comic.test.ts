import { describe, expect, it } from "vitest";
import {
  resolveComicParams,
  pickWord,
  isCheckmark,
  COMIC_WORDS,
  COMIC_GLYPHS,
  COMIC_CHECK,
} from "../src/engine/mood.js";
import {
  impactScale,
  impactPresence,
  IMPACT_MS,
} from "../src/engine/tempo.js";
import type { DopamineMood } from "../src/types.js";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

describe("success-affirmation set + checkmark", () => {
  it("uses success affirmations, not fight onomatopoeia", () => {
    // This is a successful-completion effect: the words must affirm the win.
    expect([...COMIC_WORDS]).toEqual(["YES!", "DONE!", "NICE!", "OKAY!", "WIN!", "GREAT!", "WOO!"]);
    // The old fight-scene onomatopoeia must be gone.
    for (const banned of ["BAM!", "POW!", "BIFF!", "WHAM!", "ZAP!", "KAPOW!"]) {
      expect(COMIC_WORDS).not.toContain(banned);
    }
  });

  it("the selection pool is the words plus the checkmark", () => {
    expect(COMIC_GLYPHS).toContain(COMIC_CHECK);
    expect(COMIC_GLYPHS.length).toBe(COMIC_WORDS.length + 1);
  });

  it("isCheckmark only recognises the checkmark glyph", () => {
    expect(isCheckmark(COMIC_CHECK)).toBe(true);
    for (const w of COMIC_WORDS) expect(isCheckmark(w)).toBe(false);
  });
});

describe("pickWord (affirmation / checkmark selection)", () => {
  it("is deterministic for a fixed seed", () => {
    expect(pickWord(42)).toBe(pickWord(42));
    expect(pickWord(123456)).toBe(pickWord(123456));
  });

  it("always returns a glyph from the published pool", () => {
    for (let s = 0; s < 500; s++) {
      expect(COMIC_GLYPHS).toContain(pickWord(s));
    }
  });

  it("scatters across the whole pool as the seed varies (per-fire variety)", () => {
    const seen = new Set<string>();
    for (let s = 0; s < 2000; s++) seen.add(pickWord(s));
    // Should hit every glyph — every affirmation AND the checkmark.
    expect(seen.size).toBe(COMIC_GLYPHS.length);
  });

  it("can select the checkmark (it's a real per-fire outcome)", () => {
    let sawCheck = false;
    for (let s = 0; s < 2000 && !sawCheck; s++) sawCheck = isCheckmark(pickWord(s));
    expect(sawCheck).toBe(true);
  });
});

describe("resolveComicParams (Comic Impact)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolveComicParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 42 });
    const b = resolveComicParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });

  it("ties the word to the seed (same word the picker gives)", () => {
    const p = resolveComicParams({ mood: "electric", intensity: 0.8, whimsy: 0.9, seed: 99 });
    expect(p.word).toBe(pickWord(99));
  });

  it("produces sane, in-range params for every mood", () => {
    for (const mood of MOODS) {
      const p = resolveComicParams({ mood, intensity: 0.7, whimsy: 0.5, seed: 7 });
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(Number.isInteger(p.burstPoints)).toBe(true);
      expect(p.burstPoints).toBeGreaterThan(0);
      expect(Number.isInteger(p.actionLines)).toBe(true);
      expect(p.actionLines).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
      expect(p.scale).toBeGreaterThan(0);
      expect(p.halftone).toBeGreaterThanOrEqual(0);
      expect(p.halftone).toBeLessThanOrEqual(1);
      expect(p.saturation).toBeGreaterThanOrEqual(0);
      expect(p.saturation).toBeLessThanOrEqual(1);
      expect(p.dotSize).toBeGreaterThan(0);
      expect(COMIC_GLYPHS).toContain(p.word);
      // Every mood carries a font stack that ends in a robust fallback chain.
      expect(p.fontStack).toContain("sans-serif");
      expect(p.outlineLayers).toBeGreaterThanOrEqual(1);
    }
  });

  it("higher intensity raises exposure and slam overshoot", () => {
    const lo = resolveComicParams({ mood: "celebratory", intensity: 0.1, whimsy: 0.5, seed: 5 });
    const hi = resolveComicParams({ mood: "celebratory", intensity: 0.95, whimsy: 0.5, seed: 5 });
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
    expect(hi.scale).toBeGreaterThan(lo.scale);
  });

  it("whimsy is the NOIR->POP-ART axis: louder halftone + more saturation + style", () => {
    const noir = resolveComicParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.0, seed: 5 });
    const pop = resolveComicParams({ mood: "celebratory", intensity: 0.7, whimsy: 1.0, seed: 5 });
    expect(noir.style).toBe(0);
    expect(pop.style).toBe(1);
    // Toward pop-art the Ben-Day dots scream and color floods in.
    expect(pop.halftone).toBeGreaterThan(noir.halftone);
    expect(pop.saturation).toBeGreaterThan(noir.saturation);
    expect(pop.dotSize).toBeGreaterThan(noir.dotSize); // larger, louder dots
    expect(pop.inkWeight).toBeGreaterThan(noir.inkWeight); // fatter ink
  });

  it("typography differs by MOOD (distinct faces + character)", () => {
    const e = resolveComicParams({ mood: "electric", intensity: 0.7, whimsy: 0.5, seed: 3 });
    const c = resolveComicParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 3 });
    const s = resolveComicParams({ mood: "serene", intensity: 0.7, whimsy: 0.5, seed: 3 });
    // Each mood leads with its own bundled display face.
    expect(e.fontStack).toContain("Anton");
    expect(c.fontStack).toContain("Bangers");
    expect(s.fontStack).toContain("Luckiest Guy");
    // Electric reads aggressive: harder italic skew + more condensed than serene.
    expect(Math.abs(e.fontSkew)).toBeGreaterThan(Math.abs(s.fontSkew));
    expect(e.fontStretchX).toBeLessThan(s.fontStretchX);
    // Serene reads calmer/rounder than electric.
    expect(s.inkRoundness).toBeGreaterThan(e.inkRoundness);
  });

  it("typography differs by WHIMSY (noir restrained -> pop-art inflated)", () => {
    const noir = resolveComicParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.0, seed: 3 });
    const pop = resolveComicParams({ mood: "celebratory", intensity: 0.7, whimsy: 1.0, seed: 3 });
    // Noir = clean single inked contour, flat, composed.
    expect(noir.outlineLayers).toBe(1);
    expect(noir.extrudeDepth).toBeCloseTo(0, 5);
    expect(noir.letterRotJitter).toBeCloseTo(0, 5);
    // Pop-art = fat multi-layer ink, 3D extrude/drop, inflated + bouncier.
    expect(pop.outlineLayers).toBeGreaterThan(noir.outlineLayers);
    expect(pop.extrudeDepth).toBeGreaterThan(noir.extrudeDepth);
    expect(pop.letterRotJitter).toBeGreaterThan(noir.letterRotJitter);
    expect(pop.letterBaselineJitter).toBeGreaterThan(noir.letterBaselineJitter);
    expect(pop.fontStretchX).toBeGreaterThan(noir.fontStretchX);
    expect(pop.inkRoundness).toBeGreaterThan(noir.inkRoundness);
  });

  it("electric is faster and punchier than serene (mood character)", () => {
    const electric = resolveComicParams({ mood: "electric", intensity: 0.7, whimsy: 0.5, seed: 1 });
    const serene = resolveComicParams({ mood: "serene", intensity: 0.7, whimsy: 0.5, seed: 1 });
    expect(electric.durationMs).toBeLessThan(serene.durationMs);
    expect(electric.burstPoints).toBeGreaterThan(serene.burstPoints);
    expect(electric.actionLines).toBeGreaterThan(serene.actionLines);
  });
});

describe("impactScale (the slam/recoil)", () => {
  it("arrives oversized then settles to rest size by IMPACT_MS", () => {
    expect(impactScale(0, 1)).toBeGreaterThan(1.2); // caught mid-slam, big
    expect(impactScale(IMPACT_MS, 1)).toBeCloseTo(1, 5); // settled to rest
    expect(impactScale(IMPACT_MS * 3, 1)).toBeCloseTo(1, 5); // stays at rest
  });

  it("a stronger overshoot starts bigger (harder punch)", () => {
    expect(impactScale(0, 1.4)).toBeGreaterThan(impactScale(0, 0.5));
  });
});

describe("impactPresence (snap-in, hold, clean fade)", () => {
  it("snaps in, holds at 1, then fades to ~0 at the end", () => {
    expect(impactPresence(0)).toBeCloseTo(0, 5);
    expect(impactPresence(0.04)).toBeCloseTo(1, 5);
    expect(impactPresence(0.5)).toBeCloseTo(1, 5); // proud hold
    expect(impactPresence(1)).toBeCloseTo(0, 5); // cleared by the end
  });

  it("is within [0,1] across the whole life", () => {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const v = impactPresence(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.0001);
    }
  });
});

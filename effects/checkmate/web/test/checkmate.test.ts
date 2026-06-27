import { describe, expect, it } from "vitest";
import { clamp01, easeOutBack, envelope, parseDope, resolveDopeParams } from "@dopaminefx/core";
import doc from "../src/checkmate.dope.json";

// Per the authoring guide (§7.5) we exercise the production loader path directly
// and pin a seed to assert the params + mood/intensity/whimsy mapping we expect.
const DOPE = parseDope(doc as object);

const resolve = (mood: string, intensity: number, whimsy: number, seed: number) =>
  resolveDopeParams(DOPE, { mood, intensity, whimsy, seed }, {}, "checkmateSeed") as unknown as {
    palette: unknown[];
    durationMs: number;
    style: number;
    exposure: number;
    bling: number;
    swoosh: number;
    rays: number;
    spin: number;
    sizeFrac: number;
    overshoot: number;
    checkmateSeed: number;
  };

const MOODS = ["serene", "celebratory", "electric"];

// Local mirrors of the tempo.frame expressions, to pin the pop/amp behaviour.
const pop = (life: number, overshoot: number) => easeOutBack(clamp01(life / 0.28), overshoot);
const amp = (life: number, overshoot: number) => envelope(life, overshoot);

describe("checkmate resolve (pride chess-queen win)", () => {
  it("is deterministic for a fixed seed", () => {
    expect(resolve("celebratory", 0.75, 0.6, 42)).toEqual(resolve("celebratory", 0.75, 0.6, 42));
  });

  it("produces sane, in-range params for every mood", () => {
    for (const mood of MOODS) {
      const p = resolve(mood, 0.75, 0.6, 7);
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
      expect(p.bling).toBeGreaterThan(0);
      expect(p.swoosh).toBeGreaterThan(0);
      expect(Number.isInteger(p.rays)).toBe(true);
      expect(p.rays).toBeGreaterThanOrEqual(4);
      expect(p.spin).toBeGreaterThan(0);
      expect(p.sizeFrac).toBeGreaterThan(0);
      expect(p.sizeFrac).toBeLessThan(0.5);
      expect(p.overshoot).toBeGreaterThan(0);
    }
  });

  it("intensity drives the bling, swoosh reach and pop overshoot (look/extent, not speed)", () => {
    const lo = resolve("celebratory", 0.05, 0.6, 5);
    const hi = resolve("celebratory", 0.98, 0.6, 5);
    expect(hi.bling).toBeGreaterThan(lo.bling);
    expect(hi.swoosh).toBeGreaterThan(lo.swoosh);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
  });

  it("intensity scales icon size 40%→100% of the baseline (extent, not speed)", () => {
    const baseline = 0.3; // celebratory sizeFrac baseline
    const lo = resolve("celebratory", 0.0, 0.6, 5);
    const hi = resolve("celebratory", 1.0, 0.6, 5);
    expect(lo.sizeFrac).toBeCloseTo(baseline * 0.4, 5);
    expect(hi.sizeFrac).toBeCloseTo(baseline, 5);
    expect(hi.sizeFrac).toBeGreaterThan(lo.sizeFrac);
  });

  it("intensity grows ray count from a floor of 4 up to the mood baseline", () => {
    const baseline = 10; // celebratory rays baseline
    const lo = resolve("celebratory", 0.0, 0.6, 5);
    const hi = resolve("celebratory", 1.0, 0.6, 5);
    expect(lo.rays).toBe(4);
    expect(hi.rays).toBe(baseline);
    expect(hi.rays).toBeGreaterThan(lo.rays);
  });

  it("intensity does NOT affect speed/timing (spin + durationMs are baseline-only)", () => {
    const lo = resolve("celebratory", 0.05, 0.6, 5);
    const hi = resolve("celebratory", 0.98, 0.6, 5);
    expect(hi.spin).toBe(lo.spin);
    expect(hi.durationMs).toBe(lo.durationMs);
  });

  it("whimsy is the stylization axis (style == raw whimsy)", () => {
    expect(resolve("celebratory", 0.75, 0.0, 5).style).toBe(0);
    expect(resolve("celebratory", 0.75, 1.0, 5).style).toBe(1);
  });

  it("electric is bigger, faster-spinning and blingier than serene (mood character)", () => {
    const electric = resolve("electric", 0.75, 0.6, 1);
    const serene = resolve("serene", 0.75, 0.6, 1);
    expect(electric.durationMs).toBeLessThan(serene.durationMs);
    expect(electric.sizeFrac).toBeGreaterThan(serene.sizeFrac);
    expect(electric.spin).toBeGreaterThan(serene.spin);
    expect(electric.bling).toBeGreaterThan(serene.bling);
  });

  it("degrades an undeclared mood to its own default", () => {
    const p = resolve("nonexistent-mood", 0.75, 0.6, 3);
    const def = resolve("celebratory", 0.75, 0.6, 3); // controls.mood.default
    expect(p).toEqual(def);
  });
});

describe("checkmate tempo (a bounce-in queen, then a fading celebration)", () => {
  it("pop overshoots past 1 then settles to exactly 1 and HOLDS", () => {
    const o = 1.5;
    expect(pop(0, o)).toBeCloseTo(0, 5);
    // somewhere in the bounce it swells past 1 (the overshoot)
    const peak = Math.max(pop(0.18, o), pop(0.2, o), pop(0.22, o));
    expect(peak).toBeGreaterThan(1);
    // by the end of the bounce window it has settled to 1 and stays there
    expect(pop(0.28, o)).toBeCloseTo(1, 5);
    expect(pop(0.9, o)).toBeCloseTo(1, 5);
  });

  it("amp is the held-breath envelope: 0 → peak → 0 (a transient reward)", () => {
    expect(amp(0, 1)).toBeCloseTo(0, 5);
    expect(amp(0.18, 1)).toBeGreaterThan(0.9);
    expect(amp(1, 1)).toBeCloseTo(0, 5);
  });
});

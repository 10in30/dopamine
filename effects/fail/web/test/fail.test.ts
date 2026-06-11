/**
 * Phase 4 — the FAIL / error effect.
 *
 * The fail effect is authored against the Phase 1–3 seams: its params/palette
 * come from fail.dope.json via the loader, its ✗ icon from the .dope svgPath via
 * the geometry→SDF seam, and it's loadable via the public loadEffect(). These
 * tests cover: the doc loads + is standalone; params resolve sensibly across the
 * fail moods; the baked ✗ SDF is present + decodable; the fail tempo envelope is
 * a punchy negative (no afterglow); and loadEffect binds it to the "fail"
 * program. (Visual reading-as-failure is verified by screenshots.)
 */

import { describe, expect, it } from "vitest";

import { clamp01, easeOutCubic, parseDope, resolveDopeParams, getOutline, decodeSdf, hasMood, loadEffectSync } from "@dopamine/core";
// Importing the effect registers its moods + program.
import "../src/index.js";
import failDoc from "../src/fail.dope.json";

// The fail tempo now lives in fail.dope.json (`tempo.frame` — amp/stamp/shake
// expression trees, evaluated by the generic dope factory; the frame-parity
// suite pins them). Local mirrors for the property checks below.
const failEnvelope = (life: number): number => {
  const t = clamp01(life);
  if (t < 0.05) return easeOutCubic(t / 0.05);
  if (t < 0.55) return 1;
  return Math.pow(clamp01(1 - (t - 0.55) / 0.45), 1.7);
};
const stampProgress = (elapsedMs: number): number => 1 - Math.pow(1 - clamp01(elapsedMs / 170), 5);
const shakeOffset = (elapsedMs: number, amount = 1): number =>
  elapsedMs <= 0
    ? 0
    : Math.sin((elapsedMs / 300) * Math.PI * 7.0) * Math.exp(-elapsedMs / (300 * 0.35)) * amount;

describe("fail .dope", () => {
  const doc = parseDope(failDoc as object); // standalone guard passes

  it("registers the gentle→harsh fail moods", () => {
    expect(hasMood("try-again")).toBe(true);
    expect(hasMood("error")).toBe(true);
    expect(hasMood("denied")).toBe(true);
  });

  it("resolves error-biased params across the fail moods", () => {
    for (const mood of ["try-again", "error", "denied"]) {
      const p = resolveDopeParams(doc, { mood, intensity: 0.8, whimsy: 0.5, seed: 7 }, {}, "failSeed");
      expect(p.durationMs as number).toBeGreaterThan(300);
      expect(p.durationMs as number).toBeLessThan(1100); // short + punchy, not a lingering bloom
      expect(p.severity).toBe(0.8); // == intensity control
      expect(p.style).toBe(0.5); // == whimsy
      expect(Array.isArray(p.palette)).toBe(true);
      expect((p.palette as unknown[]).length).toBe(3);
    }
  });

  it("harsher moods recoil + collapse faster than gentler ones", () => {
    const gentle = resolveDopeParams(doc, { mood: "try-again", intensity: 0.8, whimsy: 0.5, seed: 1 }, {}, "failSeed");
    const harsh = resolveDopeParams(doc, { mood: "denied", intensity: 0.8, whimsy: 0.5, seed: 1 }, {}, "failSeed");
    expect(harsh.shakeAmount as number).toBeGreaterThan(gentle.shakeAmount as number);
    expect(harsh.durationMs as number).toBeLessThan(gentle.durationMs as number);
  });

  it("ships a baked ✗ SDF driven by the svgPath (geometry seam)", () => {
    const cross = getOutline(doc, "cross");
    expect(cross?.svgPath).toContain("M");
    expect(cross?.sdf).toBeDefined();
    const dec = decodeSdf(cross!.sdf!);
    expect(dec.size * dec.size).toBe(dec.bytes.length);
  });
});

describe("fail tempo envelope (negative + punchy)", () => {
  it("slams in and collapses with no lingering afterglow", () => {
    expect(failEnvelope(0)).toBeCloseTo(0, 5);
    expect(failEnvelope(0.1)).toBeGreaterThan(0.9); // up almost immediately
    expect(failEnvelope(0.5)).toBeGreaterThan(0.9); // brief hold
    expect(failEnvelope(0.9)).toBeLessThan(0.2); // collapsed by the tail
    expect(failEnvelope(1)).toBeCloseTo(0, 5);
  });

  it("stamps the ✗ fast (most of the draw early)", () => {
    expect(stampProgress(0)).toBeCloseTo(0, 5);
    expect(stampProgress(60)).toBeGreaterThan(0.8); // hard, fast stamp
  });

  it("shake is a damped oscillation that settles", () => {
    const early = Math.abs(shakeOffset(20, 1));
    const late = Math.abs(shakeOffset(280, 1));
    expect(early).toBeGreaterThan(late); // decays
    expect(shakeOffset(0, 1)).toBe(0);
  });
});

describe("fail loads via the public loadEffect", () => {
  it("binds the .dope to the 'fail' program and resolves", () => {
    const { factory, name } = loadEffectSync(failDoc as object, { name: "test.fail" });
    expect(name).toBe("test.fail");
    const p = factory.resolve({ mood: "denied", intensity: 0.9, whimsy: 0.7, seed: 3 }, {} as never) as Record<string, unknown>;
    expect(p.severity).toBe(0.9);
    expect(p.palette).toBeDefined();
  });

  it("a host can recolor / re-icon the fail effect with no code (override)", () => {
    const { doc } = loadEffectSync(failDoc as object, {
      name: "test.fail.skin",
      overrides: { outlines: { cross: "M 30 30 L 70 70 M 70 30 L 30 70" } },
    });
    const cross = getOutline(doc, "cross")!;
    expect(cross.svgPath).toBe("M 30 30 L 70 70 M 70 30 L 30 70");
    expect(cross.sdf?.data.startsWith("data:")).toBe(true);
  });
});

/**
 * P2 frame-parity gate — halo (the CONTINUOUS looping effect).
 *
 * The per-frame logic hooks (frame() / shadowHeightFrac / bindings / uniforms)
 * moved from the hand-written factory + halo-tempo.ts into halo.dope.json,
 * evaluated by the generic `dopePassConfig`. This suite pins the datafied
 * output EXACTLY (===) against the frozen pre-P2 hand-written logic, across a
 * feeling grid × a clock grid, and pins the derived uniforms/bindings against
 * the old config literals. Halo's amp stays a steady PERIODIC breathe (its
 * loop-seam contract), not an envelope.
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope, resolveDopeParams } from "@dopamine/core";
import { HALO_FRAGMENT_SRC, HALO_VERTEX_SRC } from "../src/halo-shader.js";
import doc from "../src/halo.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: HALO_VERTEX_SRC, fragment: HALO_FRAGMENT_SRC });

// ── FROZEN pre-P2 oracle (copied verbatim from the old factory + tempo file) ──
const TAU = Math.PI * 2;
const haloBreathe = (timeS: number, periodS: number): number => {
  const ph = (TAU * timeS) / Math.max(periodS, 1e-3);
  return 0.85 + 0.15 * Math.sin(ph);
};
const oracleFrame = (animMs: number, p: Record<string, number>) => ({
  amp: haloBreathe(animMs / 1000, p.period),
});
const oracleShadow = (p: Record<string, number>) => Math.min(p.ringRadius + p.ringWidth * 2, 1);

const MOODS = ["serene", "celebratory", "electric"];
const LIVES = [0, 0.01, 0.049, 0.05, 0.1, 0.18, 0.3, 0.549, 0.55, 0.7, 0.9, 0.999, 1];

describe("halo datafied frame/shadow === the hand-written hooks", () => {
  it("matches exactly across the feeling × clock grid", () => {
    for (const mood of MOODS) {
      for (const intensity of [0.15, 0.6, 0.95]) {
        for (const whimsy of [0, 0.5, 1]) {
          for (const seed of [1, 42]) {
            const p = resolveDopeParams(
              DOPE, { mood, intensity, whimsy, seed }, DOPE.render.consts ?? {}, "haloSeed",
            ) as Record<string, number> & { durationMs: number };
            const sh = CONFIG.shadowHeightFrac;
            expect(typeof sh === "function" ? sh(p as never) : sh).toBe(oracleShadow(p));
            for (const life of LIVES) {
              const animMs = life * p.durationMs;
              for (const elapsedMs of [animMs, animMs / 0.7]) {
                const got = CONFIG.frame({ animMs, life, elapsedMs }, p as never);
                const want = oracleFrame(animMs, p);
                expect(got.amp).toBe(want.amp);
                expect(Object.keys(got)).toEqual(["amp"]);
              }
            }
          }
        }
      }
    }
  });

  it("the datafied amp keeps the loop-seam contract (t==durationMs matches t==0)", () => {
    const p = resolveDopeParams(
      DOPE, { mood: "electric", intensity: 0.8, whimsy: 0.5, seed: 3 }, {}, "haloSeed",
    ) as Record<string, number> & { durationMs: number };
    const at = (animMs: number) =>
      CONFIG.frame({ animMs, life: Math.min(animMs / p.durationMs, 1), elapsedMs: animMs }, p as never).amp;
    expect(at(p.durationMs)).toBeCloseTo(at(0), 9);
  });

  it("derives the old config literals (uniforms as a set, bindings deep-equal)", () => {
    // The pre-P2 hand-written literals, inlined as the frozen expectation.
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uExposure", "uRingRadius", "uRingWidth", "uBreathe", "uSweepArc", "uSweepTurns", "uGlow", "uPeriod"]),
    );
    expect(CONFIG.bindings).toEqual({ haloSeed: null });
    expect(CONFIG.usesOrigin).toBe(true);
  });
});

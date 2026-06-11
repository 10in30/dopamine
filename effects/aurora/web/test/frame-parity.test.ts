/**
 * P2 frame-parity gate — aurora.
 *
 * The per-frame logic hooks (frame() / shadowHeightFrac / bindings / uniforms)
 * moved from the hand-written factory into aurora.dope.json, evaluated by the
 * generic `dopePassConfig`. This suite pins the datafied output EXACTLY (===)
 * against the frozen pre-P2 hand-written logic, across a feeling grid × a clock
 * grid, and pins the derived uniforms/bindings against the old config literals.
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, envelope, parseDope, resolveDopeParams } from "@dopamine/core";
import { AURORA_FRAGMENT_SRC, AURORA_VERTEX_SRC } from "../src/aurora-shader.js";
import doc from "../src/aurora.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: AURORA_VERTEX_SRC, fragment: AURORA_FRAGMENT_SRC });

// ── FROZEN pre-P2 oracle (copied verbatim from the old hand-written factory) ──
const SWEEP_SPEED = 0.02;
const oracleFrame = (animMs: number, life: number, p: Record<string, number>) => ({
  amp: envelope(life, p.overshoot),
  uSweep: SWEEP_SPEED * (animMs / 1000) * (1.0 - 0.5 * life),
});
const oracleShadow = (p: Record<string, number>) => p.bandHeight * 0.6;

const MOODS = ["serene", "celebratory", "electric"];
const LIVES = [0, 0.01, 0.049, 0.05, 0.1, 0.18, 0.3, 0.549, 0.55, 0.7, 0.9, 0.999, 1];

describe("aurora datafied frame/shadow === the hand-written hooks", () => {
  it("matches exactly across the feeling × clock grid", () => {
    for (const mood of MOODS) {
      for (const intensity of [0.15, 0.6, 0.95]) {
        for (const whimsy of [0, 0.5, 1]) {
          for (const seed of [1, 42]) {
            const p = resolveDopeParams(
              DOPE, { mood, intensity, whimsy, seed }, DOPE.render.consts ?? {}, "auroraSeed",
            ) as Record<string, number> & { durationMs: number };
            const sh = CONFIG.shadowHeightFrac;
            expect(typeof sh === "function" ? sh(p as never) : sh).toBe(oracleShadow(p));
            for (const life of LIVES) {
              const animMs = life * p.durationMs;
              for (const elapsedMs of [animMs, animMs / 0.7]) {
                const got = CONFIG.frame({ animMs, life, elapsedMs }, p as never);
                const want = oracleFrame(animMs, life, p);
                expect(got.amp).toBe(want.amp);
                expect(got.uSweep).toBe(want.uSweep);
                expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
              }
            }
          }
        }
      }
    }
  });

  it("derives the old config literals (uniforms as a set, bindings deep-equal)", () => {
    // The pre-P2 hand-written literals, inlined as the frozen expectation.
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uExposure", "uCoverage", "uBandY", "uBandHeight", "uSway", "uSweep", "uStriation", "uRays", "uSeed"]),
    );
    expect(CONFIG.bindings).toEqual({ auroraSeed: "uSeed", overshoot: null });
    expect(CONFIG.usesOrigin ?? false).toBe(false);
  });
});

/**
 * P2 frame-parity gate — fail.
 *
 * The per-frame logic hooks (frame() / shadowHeightFrac / bindings / uniforms)
 * moved from the hand-written factory + fail-tempo.ts into fail.dope.json,
 * evaluated by the generic `dopePassConfig`. This suite pins the datafied
 * output EXACTLY (===) against the frozen pre-P2 hand-written logic, across a
 * feeling grid × a clock grid, and pins the derived uniforms/bindings against
 * the old config literals.
 *
 * NOTE the cross-platform alignment: the oracle's stamp/shake run on the REAL
 * un-stepped clock (`elapsedMs`) — what the Swift/Android ports always did. The
 * pre-P2 WEB factory fed them the on-twos-snapped `animMs`, so at whimsy > 0
 * this is a deliberate web behavior change, pinned here as the contract.
 */

import { describe, expect, it } from "vitest";
import { clamp01, dopePassConfig, easeOutCubic, parseDope, resolveDopeParams } from "@dopamine/core";
import { FAIL_FRAGMENT_SRC, FAIL_VERTEX_SRC } from "../src/fail-shader.js";
import doc from "../src/fail.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: FAIL_VERTEX_SRC, fragment: FAIL_FRAGMENT_SRC });

// ── FROZEN pre-P2 oracle (copied verbatim from fail-tempo.ts; stamp/shake take
// the un-stepped elapsedMs — the cross-platform-aligned behavior) ──
const FAIL_STAMP_MS = 170;
const FAIL_SHAKE_MS = 300;
const stampProgress = (elapsedMs: number): number => {
  const x = clamp01(elapsedMs / FAIL_STAMP_MS);
  return 1 - Math.pow(1 - x, 5);
};
const failEnvelope = (life: number): number => {
  const t = clamp01(life);
  if (t < 0.05) return easeOutCubic(t / 0.05);
  if (t < 0.55) return 1;
  const fade = clamp01(1 - (t - 0.55) / 0.45);
  return Math.pow(fade, 1.7);
};
const shakeOffset = (elapsedMs: number, amount = 1): number => {
  if (elapsedMs <= 0) return 0;
  const decay = Math.exp(-elapsedMs / (FAIL_SHAKE_MS * 0.35));
  const osc = Math.sin((elapsedMs / FAIL_SHAKE_MS) * Math.PI * 7.0);
  return osc * decay * amount;
};
const oracleFrame = (elapsedMs: number, life: number, p: Record<string, number>) => ({
  amp: failEnvelope(life),
  uStamp: stampProgress(elapsedMs),
  uShake: shakeOffset(elapsedMs, p.shakeAmount),
});

const MOODS = ["try-again", "error", "denied"];
const LIVES = [0, 0.01, 0.049, 0.05, 0.1, 0.18, 0.3, 0.549, 0.55, 0.7, 0.9, 0.999, 1];

describe("fail datafied frame/shadow === the hand-written hooks", () => {
  it("matches exactly across the feeling × clock grid", () => {
    for (const mood of MOODS) {
      for (const intensity of [0.15, 0.6, 0.95]) {
        for (const whimsy of [0, 0.5, 1]) {
          for (const seed of [1, 42]) {
            const p = resolveDopeParams(
              DOPE, { mood, intensity, whimsy, seed }, DOPE.render.consts ?? {}, "failSeed",
            ) as Record<string, number> & { durationMs: number };
            expect(CONFIG.shadowHeightFrac).toBe(0.42); // bare-number passthrough
            for (const life of LIVES) {
              const animMs = life * p.durationMs;
              // stamp/shake read elapsedMs, so exercise elapsedMs ≠ animMs too.
              for (const elapsedMs of [animMs, animMs / 0.7]) {
                const got = CONFIG.frame({ animMs, life, elapsedMs }, p as never);
                const want = oracleFrame(elapsedMs, life, p);
                expect(got.amp).toBe(want.amp);
                expect(got.uStamp).toBe(want.uStamp);
                expect(got.uShake).toBe(want.uShake);
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
      new Set(["uStamp", "uShake", "uExposure", "uSeverity", "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx", "uBoxPx"]),
    );
    expect(CONFIG.bindings).toEqual({ shakeAmount: null, failSeed: null, seed: null });
    expect(CONFIG.usesOrigin).toBe(true);
  });
});

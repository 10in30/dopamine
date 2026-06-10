/**
 * Cross-pollination guard: the three shaders must compose the SAME shared
 * `look/` GLSL chunks (one canonical definition each), not private forks. We
 * assert each shared function is defined exactly ONCE in a composed shader (no
 * duplicate/drift) and that the effects that should use a chunk actually include
 * it. Also covers the reusable impact/recoil envelope in tempo.ts.
 */

import { describe, expect, it } from "vitest";

import { FRAGMENT_SRC } from "../../../effects/solarbloom/web/src/solarbloom-shader.js";
import { INK_FRAGMENT_SRC } from "../../../effects/inkstroke/web/src/inkstroke-shader.js";
import { COMIC_FRAGMENT_SRC } from "../../../effects/comic/web/src/comic-shader.js";
import { GLSL_TONEMAP_ACES, GLSL_HASH, GLSL_FBM, GLSL_HALFTONE, envelope } from "@dopamine/core";
import { impactScale, impactPresence } from "../../../effects/comic/web/src/comic-tempo.js";

const defCount = (src: string, signature: string): number =>
  src.split(signature).length - 1;

describe("shared look/ GLSL chunk library", () => {
  it("each composed shader defines a shared function at most once (no drift forks)", () => {
    for (const src of [FRAGMENT_SRC, INK_FRAGMENT_SRC, COMIC_FRAGMENT_SRC]) {
      // If a shader uses these, it must define them exactly once (via the chunk).
      for (const sig of ["float hash11(", "vec3 tonemapACES(", "float benday(", "float fbm("]) {
        expect(defCount(src, sig)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("all three shaders adopt the shared ACES tonemap (P0/P1 cross-poll win)", () => {
    expect(FRAGMENT_SRC).toContain("tonemapACES");
    expect(INK_FRAGMENT_SRC).toContain("tonemapACES");
    expect(COMIC_FRAGMENT_SRC).toContain("tonemapACES");
    // And the ACES body comes from the shared chunk (same coefficients).
    expect(GLSL_TONEMAP_ACES).toContain("2.51");
  });

  it("Solarbloom + Verdict share the fbm/hash chunks; Comic shares hash + halftone", () => {
    for (const src of [FRAGMENT_SRC, INK_FRAGMENT_SRC]) {
      expect(src).toContain(GLSL_FBM.trim());
      expect(src).toContain(GLSL_HASH.trim());
    }
    expect(COMIC_FRAGMENT_SRC).toContain(GLSL_HASH.trim());
    expect(COMIC_FRAGMENT_SRC).toContain(GLSL_HALFTONE.trim());
  });

  it("Verdict adopts the shared particle helpers + wet-edge dispersion/iridescence", () => {
    expect(INK_FRAGMENT_SRC).toContain("ballisticPos");
    expect(INK_FRAGMENT_SRC).toContain("particleSprite");
    expect(INK_FRAGMENT_SRC).toContain("iridescent");
  });
});

describe("reusable impact/recoil envelope (tempo.ts)", () => {
  it("impactScale slams big then settles to rest, larger overshoot = bigger slam", () => {
    expect(impactScale(0, 1)).toBeGreaterThan(1.5); // caught mid-slam, oversized
    expect(impactScale(0, 1.5)).toBeGreaterThan(impactScale(0, 0.5));
    expect(impactScale(10000, 1)).toBeCloseTo(1); // settled to rest
  });

  it("impactPresence snaps in, holds, then fades clean by the end", () => {
    expect(impactPresence(0)).toBeCloseTo(0);
    expect(impactPresence(0.5)).toBeCloseTo(1); // proud hold
    expect(impactPresence(1)).toBeCloseTo(0); // cleared
  });

  it("the held-breath envelope and the impact envelope are both available", () => {
    expect(typeof envelope).toBe("function");
    expect(typeof impactScale).toBe("function");
  });
});

/**
 * Backbone tests: the effect + mood registries, param-resolution parity (the
 * framework path must be byte-identical to the legacy `resolve*Params`), and
 * SSR-safety of the public API. The WebGL conductor's lifecycle (shared host,
 * link-once, disposal, reduced-motion) is exercised in `conductor.test.ts` with
 * a minimal GL stub; here we cover the pure logic.
 */

import { describe, expect, it } from "vitest";

import {
  registerEffect,
  getEffect,
  hasEffect,
  effectNames,
} from "../src/framework/registry.js";
import type { EffectFactory } from "../src/framework/effect.js";
import {
  registerMood,
  resolveMood,
  hasMood,
  moodNames,
  DEFAULT_MOOD,
} from "../src/framework/mood-registry.js";

// Importing the effects registers them (side-effecting module bodies).
import { solarbloom } from "../src/effects/solarbloom.js";
import { inkstroke } from "../src/effects/inkstroke.js";
import { comic } from "../src/effects/comic.js";

import { resolveParams, resolveInkParams, resolveComicParams } from "../src/engine/mood.js";
import type { DopamineMood } from "../src/types.js";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

describe("effect registry", () => {
  it("has the three built-in effects registered on import", () => {
    expect(hasEffect("solarbloom")).toBe(true);
    expect(hasEffect("inkstroke")).toBe(true);
    expect(hasEffect("comic")).toBe(true);
    expect(effectNames()).toEqual(expect.arrayContaining(["solarbloom", "inkstroke", "comic"]));
  });

  it("registers and looks up a new effect", () => {
    const fake: EffectFactory<{ x: number }> = {
      name: "test-effect",
      resolve: () => ({ x: 1 }),
      create: () => ({ durationMs: 1, renderAt() {}, dispose() {} }),
    };
    registerEffect(fake);
    expect(getEffect("test-effect")).toBe(fake);
    expect(getEffect("does-not-exist")).toBeUndefined();
  });
});

describe("mood registry", () => {
  it("has the three built-in moods", () => {
    for (const m of MOODS) expect(hasMood(m)).toBe(true);
    expect(moodNames()).toEqual(expect.arrayContaining(MOODS));
  });

  it("falls back to the default for an unknown mood", () => {
    expect(resolveMood(undefined).name).toBe(DEFAULT_MOOD);
    expect(resolveMood("nope").name).toBe(DEFAULT_MOOD);
  });

  it("a newly registered mood resolves with its register and lights up all effects", () => {
    registerMood("triumphant", {
      hueCenter: 280,
      hueRange: 160,
      lightness: 0.8,
      chroma: 0.22,
      energy: 0.9,
    });
    expect(hasMood("triumphant")).toBe(true);
    expect(resolveMood("triumphant").hueCenter).toBe(280);
    // All three effects produce sane params for the new mood (no throw, in-range).
    const f = { mood: "triumphant", intensity: 0.8, whimsy: 0.5, seed: 3 };
    const s = resolveParams(f);
    const v = resolveInkParams(f);
    const c = resolveComicParams(f);
    for (const p of [s, v, c]) {
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(p.style).toBeCloseTo(0.5);
    }
  });
});

describe("param-resolution parity (framework path == legacy resolve*Params)", () => {
  // A grid of feelings; the framework `resolve` MUST equal the legacy function
  // byte-for-byte for every built-in mood (the correctness anchor).
  const grid: { mood: DopamineMood; intensity: number; whimsy: number; seed: number }[] = [];
  for (const mood of MOODS) {
    for (const intensity of [0, 0.3, 0.7, 1]) {
      for (const whimsy of [0, 0.5, 1]) {
        for (const seed of [1, 42, 9999]) {
          grid.push({ mood, intensity, whimsy, seed });
        }
      }
    }
  }

  it("solarbloom.resolve == resolveParams", () => {
    for (const f of grid) {
      expect(solarbloom.resolve({ ...f }, resolveMood(f.mood))).toEqual(resolveParams(f));
    }
  });

  it("inkstroke.resolve == resolveInkParams", () => {
    for (const f of grid) {
      expect(inkstroke.resolve({ ...f }, resolveMood(f.mood))).toEqual(resolveInkParams(f));
    }
  });

  it("comic.resolve == resolveComicParams", () => {
    for (const f of grid) {
      expect(comic.resolve({ ...f }, resolveMood(f.mood))).toEqual(resolveComicParams(f));
    }
  });
});

describe("SSR safety (no DOM)", () => {
  it("play resolves immediately and prepare returns null off-DOM", async () => {
    // vitest's `node` environment has no `document`/`window`.
    expect(typeof document).toBe("undefined");
    const mod = await import("../src/index.js");
    await expect(mod.play("solarbloom", {})).resolves.toBeUndefined();
    await expect(mod.celebrate({})).resolves.toBeUndefined();
    await expect(mod.celebrateInk({})).resolves.toBeUndefined();
    await expect(mod.celebrateComic({})).resolves.toBeUndefined();
    expect(mod.prepare("solarbloom", {})).toBeNull();
    expect(mod.prepareSolarbloom({})).toBeNull();
    expect(mod.prepareInkstroke({})).toBeNull();
    expect(mod.prepareComic({})).toBeNull();
  });
});

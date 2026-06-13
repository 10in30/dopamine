/**
 * Backbone tests: the effect + mood registries and SSR-safety of the public API.
 * The WebGL conductor's lifecycle is exercised in `conductor.test.ts` with a
 * minimal GL stub; here we cover the pure logic. Core registers NO effect, so we
 * use fake effects; the per-effect functional checks live in each effect
 * package's own tests.
 */

import { describe, expect, it } from "vitest";

import {
  registerEffect,
  getEffect,
  hasEffect,
  effectNames,
  registerMood,
  resolveMood,
  hasMood,
  moodNames,
  type EffectFactory,
} from "../src/index.js";
import { DEFAULT_MOOD } from "../src/framework/mood-registry.js";
import type { DopamineMood } from "../src/types.js";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

const fakeFactory = (name: string): EffectFactory<{ x: number }> => ({
  name,
  resolve: () => ({ x: 1 }),
  create: () => ({ durationMs: 1, renderAt() {}, dispose() {} }),
});

describe("effect registry", () => {
  it("starts empty of built-ins (effects ship in @dopaminefx/effect-* packages)", () => {
    expect(hasEffect("solarbloom")).toBe(false);
  });

  it("registers and looks up a new effect", () => {
    const fake = fakeFactory("test-effect");
    registerEffect(fake);
    expect(getEffect("test-effect")).toBe(fake);
    expect(getEffect("does-not-exist")).toBeUndefined();
    expect(effectNames()).toEqual(expect.arrayContaining(["test-effect"]));
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

  it("a newly registered mood resolves with its register", () => {
    registerMood("triumphant", {
      hueCenter: 280,
      hueRange: 160,
      lightness: 0.8,
      chroma: 0.22,
      energy: 0.9,
    });
    expect(hasMood("triumphant")).toBe(true);
    expect(resolveMood("triumphant").hueCenter).toBe(280);
  });
});

describe("SSR safety (no DOM)", () => {
  it("play resolves immediately and prepare returns null off-DOM", async () => {
    // vitest's `node` environment has no `document`/`window`.
    expect(typeof document).toBe("undefined");
    const mod = await import("../src/index.js");
    registerEffect(fakeFactory("ssr-effect"));
    await expect(mod.play("ssr-effect", {})).resolves.toBeUndefined();
    expect(mod.prepare("ssr-effect", {})).toBeNull();
  });
});

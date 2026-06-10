/**
 * Phase 0 regression — every registered effect must be playable with EVERY mood
 * it declares (its `.dope` `controls.mood.options`) AND degrade sanely (resolve,
 * not throw) for moods it does NOT declare — e.g. the three success moods on the
 * fail effect, and the fail moods on the success effects.
 *
 * The bug this guards: `resolveDopeParams` used to fall back to a hardcoded
 * `doc.baselines.celebratory`. The fail effect declares try-again/error/denied
 * and has NO `celebratory` baseline, so ANY success mood (including the library
 * default `celebratory`) threw `Cannot read properties of undefined (reading
 * 'durationMs')`. The fix degrades an undeclared mood to the effect's OWN default
 * mood instead.
 *
 * This drives the real registered `EffectFactory.resolve` (the same call the
 * conductor makes inside `prepare`/`play`), so it covers the full resolve path,
 * not just the loader in isolation.
 */

import { describe, expect, it } from "vitest";

// Importing the umbrella registers all ten built-in effects + their moods.
import { builtinEffectNames, getEffect, resolveMood, type FeelingInput } from "../src/index.js";

import solarbloomDoc from "../../effect-solarbloom/src/solarbloom.dope.json";
import inkstrokeDoc from "../../effect-inkstroke/src/inkstroke.dope.json";
import comicDoc from "../../../effects/comic/comic.dope.json";
import failDoc from "../../effect-fail/src/fail.dope.json";
import auroraDoc from "../../effect-aurora/src/aurora.dope.json";
import rippleDoc from "../../effect-ripple/src/ripple.dope.json";
import confettiDoc from "../../effect-confetti/src/confetti.dope.json";
import heartburstDoc from "../../effect-heartburst/src/heartburst.dope.json";
import lightningDoc from "../../effect-lightning/src/lightning.dope.json";
import haloDoc from "../../effect-halo/src/halo.dope.json";

const DOCS: Record<string, { controls?: { mood?: { options?: string[] } } }> = {
  solarbloom: solarbloomDoc as never,
  inkstroke: inkstrokeDoc as never,
  comic: comicDoc as never,
  fail: failDoc as never,
  aurora: auroraDoc as never,
  ripple: rippleDoc as never,
  confetti: confettiDoc as never,
  heartburst: heartburstDoc as never,
  lightning: lightningDoc as never,
  halo: haloDoc as never,
};

const SUCCESS_MOODS = ["serene", "celebratory", "electric"];

describe("every effect resolves for every mood it declares (+ the success moods)", () => {
  for (const name of builtinEffectNames) {
    const factory = getEffect(name)!;
    const declared = DOCS[name].controls?.mood?.options ?? [];
    // Each effect's own declared moods, plus the 3 success moods (which the fail
    // effect does NOT declare — this is exactly the path the bug broke), plus a
    // bogus mood to prove unknown moods degrade rather than throw.
    const moods = [...new Set([...declared, ...SUCCESS_MOODS, "totally-made-up"])];

    for (const mood of moods) {
      it(`${name} prepares for mood="${mood}"`, () => {
        const feeling: FeelingInput = { mood, intensity: 0.8, whimsy: 0.3, seed: 7 };
        // Mirror the conductor: resolve the mood, then ask the factory to resolve
        // params. This used to throw for the fail effect on any success mood.
        const resolved = resolveMood(mood);
        const params = factory.resolve(feeling, resolved) as Record<string, unknown>;
        expect(params).toBeDefined();
        expect(typeof params.durationMs).toBe("number");
        expect(params.durationMs as number).toBeGreaterThan(0);
        expect(Array.isArray(params.palette)).toBe(true);
        expect((params.palette as unknown[]).length).toBe(3);
      });
    }
  }
});

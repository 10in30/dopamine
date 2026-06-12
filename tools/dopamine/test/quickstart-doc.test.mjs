/**
 * Docs-stay-true gate: the `.dope` skeleton in docs/authoring-quickstart.md.
 *
 * The quickstart promises its skeleton "parses and derives a complete pass
 * config as-is" — an agent's first contact with the format. This test extracts
 * the JSONC block from the doc and runs it through the REAL pipeline (parse →
 * resolve → derive the pass config → the factory-generatability guard), so a
 * format change that would silently rot the doc fails CI instead.
 */

import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertFactoryGeneratable } from "../src/factory.mjs";
import { dopePassConfig, parseDope, resolveDopeParams } from "@dopamine/core";

const QUICKSTART = fileURLToPath(new URL("../../../docs/authoring-quickstart.md", import.meta.url));

/** Extract the (first) ```jsonc block and strip its // comments + trailing commas. */
function quickstartDope() {
  const md = readFileSync(QUICKSTART, "utf8");
  const m = md.match(/```jsonc\n([\s\S]*?)```/);
  expect(m, "the quickstart must contain a ```jsonc skeleton block").toBeTruthy();
  const jsonc = m[1]
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([,{[\s])\/\/.*$/gm, "$1")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(jsonc);
}

test("the quickstart .dope skeleton parses, resolves and derives a full pass config", () => {
  const doc = parseDope(quickstartDope());

  // The whole declarative derivation works on the skeleton as documented.
  const config = dopePassConfig(doc, { vertex: "v", fragment: "f" });
  expect(new Set(config.uniforms)).toEqual(new Set(["uExposure", "uSpread", "uSeed"]));
  expect(config.usesOrigin).toBe(true);

  // It resolves deterministically and animates.
  const params = resolveDopeParams(
    doc, { mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 42 }, {}, "sparkleSeed",
  );
  expect(params.durationMs).toBeGreaterThan(0);
  expect(params.palette).toHaveLength(3);
  const frame = config.frame({ animMs: 400, life: 0.25, elapsedMs: 400 }, params);
  expect(frame.amp).toBeGreaterThan(0);

  // And the platform factory shells are generatable from it (no swift/android folders).
  expect(() => assertFactoryGeneratable(doc, "sparkle", "swift")).not.toThrow();
});

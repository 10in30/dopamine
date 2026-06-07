/**
 * `.dope` loader VALIDATION — the generic schema / standalone-guard checks.
 *
 * The per-effect byte-parity guards (loader output == frozen legacy
 * `resolve*Params`) live in each effect package's `parity.test.ts` (they need
 * that effect's bundled `.dope` + its oracle). Here we exercise only the
 * effect-agnostic loader rules against a representative bundled fixture.
 */

import { describe, expect, it } from "vitest";

import { parseDope } from "../src/index.js";

// A real shipped `.dope` (ripple's), copied in as an effect-agnostic fixture so
// the core loader tests stay self-contained (core depends on no effect package).
import sampleDoc from "./fixtures/sample.dope.json";

describe(".dope loader validation", () => {
  it("rejects a bad magic or unsupported major version", () => {
    expect(() => parseDope({ fmt: "nope", v: "1.0.0" })).toThrow();
    expect(() =>
      parseDope({ fmt: "dopamine-effect", v: "2.0.0", render: { params: {} }, palette: { perMood: {} }, baselines: {} }),
    ).toThrow();
  });

  it("the shipped fixture carries the schema-required top-level keys", () => {
    const doc = sampleDoc as Record<string, unknown>;
    for (const key of ["fmt", "v", "id", "controls", "palette", "tempo", "render"]) {
      expect(doc[key], `missing ${key}`).toBeDefined();
    }
    expect(doc.fmt).toBe("dopamine-effect");
    expect(() => parseDope(doc)).not.toThrow();
  });
});

describe("standalone guard", () => {
  it("accepts the bundled self-contained doc", () => {
    expect(() => parseDope(sampleDoc as object)).not.toThrow();
  });

  it("rejects a remote/external asset reference", () => {
    const bad = JSON.parse(JSON.stringify(sampleDoc));
    bad.render.backends.webgl2.shader = { $ref: "https://cdn.example.com/x.frag.glsl" };
    expect(() => parseDope(bad)).toThrow(/self-contained|external asset/);
  });

  it("rejects an absolute-path reference", () => {
    const bad = JSON.parse(JSON.stringify(sampleDoc));
    bad.render.backends.webgl2.shader = { $ref: "/usr/share/shaders/x.glsl" };
    expect(() => parseDope(bad)).toThrow(/self-contained|external asset/);
  });
});

/**
 * `.dope` loader VALIDATION — the generic schema / standalone-guard checks.
 *
 * Cross-platform resolve parity is gated by the Swift/Android 192-case grids
 * against the web-dumped fixture (`ParityTests.swift` / `ParityTest.kt`); the
 * per-effect behavioral checks live in each effect package's tests. Here we
 * exercise only the effect-agnostic loader rules against a representative
 * bundled fixture.
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

describe("tempo.loop validation (the continuous-loop seam invariants)", () => {
  type Mutable = {
    tempo: { loop?: { periodMs?: unknown; snapAligned?: boolean } };
    baselines: Record<string, Record<string, number>>;
  };
  const withLoop = (loop: object, durationMs?: number): Mutable => {
    const doc = JSON.parse(JSON.stringify(sampleDoc)) as Mutable;
    doc.tempo.loop = loop;
    if (durationMs !== undefined) {
      for (const row of Object.values(doc.baselines)) row.durationMs = durationMs;
    }
    return doc;
  };

  it("rejects a missing/non-positive periodMs", () => {
    expect(() => parseDope(withLoop({}))).toThrow(/periodMs/);
    expect(() => parseDope(withLoop({ periodMs: 0 }))).toThrow(/periodMs/);
    expect(() => parseDope(withLoop({ periodMs: -1500 }))).toThrow(/periodMs/);
  });

  it("rejects a period off the animate-on-twos grid (snapAligned defaults true)", () => {
    // 100 ms is not a whole number of 1000/12 ms steps.
    expect(() => parseDope(withLoop({ periodMs: 100 }))).toThrow(/animate-on-twos/);
  });

  it("accepts an off-grid period when snapAligned is explicitly false", () => {
    // The fixture's durations (2400/1800/1300) are all whole multiples of 100.
    expect(() => parseDope(withLoop({ periodMs: 100, snapAligned: false }))).not.toThrow();
  });

  it("rejects a baseline durationMs that is not a whole number of periods", () => {
    // 250 ms = 3 on-twos steps (grid-aligned), but 2400 / 250 = 9.6 periods.
    expect(() => parseDope(withLoop({ periodMs: 250 }))).toThrow(
      /durationMs.*whole number of tempo.loop periods/,
    );
  });

  it("accepts a grid-aligned period that tiles every baseline duration", () => {
    // halo's contract: 1500 ms = 18 steps; 6000 ms = 4 whole periods.
    expect(() => parseDope(withLoop({ periodMs: 1500 }, 6000))).not.toThrow();
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

/**
 * The lightning logic-parity GRID — shared by the fixture regen script
 * (scripts/regen-logic-parity.mjs) and the vitest gate (lightning-logic-parity
 * .test.ts), so the committed fixture and the web assertion can never use
 * different inputs.
 *
 * The fixture (web/test/lightning-logic-parity.json, COMMITTED) is the ground
 * truth the generated Swift + Kotlin renderers are asserted against: the
 * toolchain embeds it into the dist SwiftPM package's generated XCTest target
 * and syncs it (with a generated JUnit test) into dopamine-core's testGenerated
 * source set. Plain .mjs (no types) so node can run the regen script with
 * nothing but --experimental-strip-types for the logic module itself.
 *
 * Coverage: the three mood registers' parameter shapes + a max-forks overdrive
 * set; portrait/landscape/square canvases with centered and edge-biased
 * origins; times spanning pre-strike (0 → the early-return path), the crack-in
 * window, the on-twos beat boundaries, and the decaying tail.
 */

const SETS = [
  // serene-ish: a soft single arc, no forks, photoreal (style 0).
  { style: 0, thickness: 0.012, jagged: 0.55, branches: 0, boltSeed: 0.4375, width: 800, height: 600, originX: 400, originY: 300, durationMs: 1400 },
  // celebratory-ish: a lively branched bolt on a portrait phone canvas.
  { style: 0.5, thickness: 0.016, jagged: 0.85, branches: 3, boltSeed: 7.77, width: 390, height: 844, originX: 120.5, originY: 633.25, durationMs: 1100 },
  // electric-ish: a violent multi-fork strike, edge-biased origin, big canvas.
  { style: 1, thickness: 0.02, jagged: 1.15, branches: 6, boltSeed: 42.42, width: 1920, height: 1080, originX: 1700, originY: 980, durationMs: 850 },
  // overdrive: MAX_FORKS forks, hard cel, origin near the top edge.
  { style: 0.25, thickness: 0.024, jagged: 1.3, branches: 7, boltSeed: 1013.5, width: 1024, height: 1024, originX: 512, originY: 12, durationMs: 850 },
];

const TIMES_MS = [0, 8.5, 16.6667, 33.3333, 66.6667, 130, 247.125, 500, 849];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The flat case-input list (params + geometry + clocks; no outputs). */
export const GRID = SETS.flatMap((s) =>
  TIMES_MS.map((elapsedMs) => ({
    style: s.style,
    thickness: s.thickness,
    jagged: s.jagged,
    branches: s.branches,
    boltSeed: s.boltSeed,
    width: s.width,
    height: s.height,
    originX: s.originX,
    originY: s.originY,
    elapsedMs,
    life: clamp01(elapsedMs / s.durationMs),
  })),
);

/**
 * Build the fixture TEXT (deterministic: one compact case per line) by running
 * the web logic across the grid. `compute` is lightning-logic.ts's
 * `computeLightningArrays` — passed in so callers control how the TS module is
 * loaded (vitest transform vs node --experimental-strip-types).
 */
export function buildFixtureText(compute) {
  const note =
    "Ground-truth dump of effects/lightning/web/src/lightning-logic.ts across the logic-parity grid " +
    "(regen: node --experimental-strip-types effects/lightning/web/scripts/regen-logic-parity.mjs). " +
    "Asserted byte/epsilon-identically by the web vitest gate, the generated pure-JVM JUnit test, " +
    "and the generated XCTest target in the dist SwiftPM package.";
  const lines = GRID.map((c) => {
    const { verts, meta } = compute(
      c.style, c.thickness, c.jagged, c.branches, c.boltSeed,
      c.width, c.height, c.originX, c.originY, c.elapsedMs, c.life,
    );
    return "    " + JSON.stringify({ ...c, verts: Array.from(verts), meta: Array.from(meta) });
  });
  return `{\n  "note": ${JSON.stringify(note)},\n  "cases": [\n${lines.join(",\n")}\n  ]\n}\n`;
}

/**
 * Pins the committed logic-parity fixture to the CURRENT web logic, byte for
 * byte: the fixture is the cross-platform ground truth (the generated Kotlin +
 * Swift renderers are asserted against it), so any change to lightning-logic.ts
 * must come with a fixture regen — and any fixture edit that doesn't match the
 * web output fails here.
 *
 * Regen: node --experimental-strip-types effects/lightning/web/scripts/regen-logic-parity.mjs
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeLightningArrays, MAX_BOLTS, VERTS_PER_BOLT } from "../src/lightning-logic.js";
// eslint-disable-next-line — plain .mjs so the node regen script shares the exact grid.
import { buildFixtureText, GRID } from "./logic-parity-grid.mjs";

const fixturePath = fileURLToPath(new URL("./lightning-logic-parity.json", import.meta.url));

describe("lightning logic parity fixture", () => {
  it("matches the committed fixture byte-for-byte (web logic is the ground truth)", () => {
    const committed = readFileSync(fixturePath, "utf8");
    expect(buildFixtureText(computeLightningArrays)).toBe(committed);
  });

  it("covers the early-return, partial-strike and settled phases", () => {
    // The grid must keep exercising the interesting paths: elapsedMs 0 (strike
    // <= 0 → all-zero arrays), mid-crack-in times, and the settled bolt.
    expect(GRID.some((c) => c.elapsedMs === 0)).toBe(true);
    expect(GRID.some((c) => c.elapsedMs > 0 && c.elapsedMs < 130)).toBe(true);
    expect(GRID.some((c) => c.elapsedMs >= 130)).toBe(true);
    expect(GRID.some((c) => c.branches === 7)).toBe(true); // MAX_FORKS overdrive

    const zero = GRID.find((c) => c.elapsedMs === 0)!;
    const { verts, meta } = computeLightningArrays(
      zero.style, zero.thickness, zero.jagged, zero.branches, zero.boltSeed,
      zero.width, zero.height, zero.originX, zero.originY, zero.elapsedMs, zero.life,
    );
    expect(verts).toEqual(new Float32Array(MAX_BOLTS * VERTS_PER_BOLT * 2));
    expect(meta.every((v) => v === 0)).toBe(true);
  });
});

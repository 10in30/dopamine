/**
 * TS-subset logic transpiler gate (logic.mjs — CPU-precomputed per-frame geometry).
 *
 * Effects with `x-build.logic` no longer ship hand-ported renderer logic — the
 * toolchain TRANSPILES `<Name>Renderer.swift` / `<Name>Renderer.kt` from the
 * single web TS source. The output (and the generated parity-test shells) is
 * gated byte-for-byte against committed snapshots (`golden-logic/`), so a
 * transpiler regression shows up as a reviewable diff. The snapshots were
 * seeded from — and verified numerically equal to — the historical hand ports
 * before those were deleted (the committed web-dumped fixture replays the same
 * grid through the generated Swift/Kotlin in `swift test` / the pure-JVM
 * `:dopamine-core:test`).
 *
 * Like the GLSL→MSL transpiler, logic.mjs covers exactly the subset the source
 * uses and THROWS on anything outside it — pinned below.
 */

import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  transpileLogic,
  parseLogicModule,
  emitKotlinLogicParityTest,
  emitSwiftLogicParityTests,
  loadLogic,
} from "../src/logic.mjs";
import { loadEffect } from "../src/build.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const golden = (name) => readFileSync(new URL(`./golden-logic/${name}`, import.meta.url), "utf8");

const SOURCE_PATH = "effects/lightning/web/src/lightning-logic.ts";
const source = readFileSync(new URL(SOURCE_PATH, new URL("../../../", import.meta.url)), "utf8");

test("lightning: the transpiled renderers match the committed snapshots", () => {
  const { swift, kotlin } = transpileLogic({
    slug: "lightning",
    source,
    sourcePath: SOURCE_PATH,
    namespace: "ai.dopamine.effect.lightning",
  });
  expect(swift).toBe(golden("LightningRenderer.swift"));
  expect(kotlin).toBe(golden("LightningRenderer.kt"));
});

test("lightning: the generated parity-test shells match the committed snapshots", () => {
  const model = parseLogicModule(source, SOURCE_PATH);
  expect(emitKotlinLogicParityTest(model, "lightning", "ai.dopamine.effect.lightning"))
    .toBe(golden("LightningLogicParityTest.kt"));
  expect(emitSwiftLogicParityTests(model, "lightning", "DopamineEffectLightning"))
    .toBe(golden("LightningLogicParityTests.swift"));
});

test("lightning: loadLogic wires the x-build.logic block (src + committed fixture)", async () => {
  const eff = await loadEffect(root, "effects/lightning");
  const logic = await loadLogic(eff);
  expect(logic).not.toBeNull();
  expect(logic.swift).toBe(golden("LightningRenderer.swift"));
  expect(logic.kotlin).toBe(golden("LightningRenderer.kt"));
  expect(logic.namespace).toBe("ai.dopamine.effect.lightning");
  const fixture = JSON.parse(logic.fixture);
  expect(fixture.cases.length).toBeGreaterThan(0);
  // Every entry param + every bundle field must be present in each fixture case
  // (the generated JUnit/XCTest replays look them up by name).
  const paramNames = logic.model.entry.params.map((p) => p.name);
  const bundle = logic.model.interfaces[logic.model.entry.returnType.slice(7)];
  for (const c of fixture.cases) {
    for (const p of paramNames) expect(c).toHaveProperty(p);
    for (const f of bundle.fields) expect(Array.isArray(c[f])).toBe(true);
  }
});

// The transpiler must THROW on constructs outside the supported subset — never
// emit silently-wrong native code (same posture as the GLSL→MSL transpiler).
const REJECTS = [
  ["imports", `import { x } from "./y.js";\nexport interface A { v: Float32Array }\nexport function f(): A { const v = new Float32Array(1); return { v }; }`, /self-contained/],
  ["closures / arrow functions", `export interface A { v: Float32Array }\nconst f = (x: number) => x;\nexport function g(): A { const v = new Float32Array(1); return { v }; }`, /unsupported/],
  ["while loops", `export interface A { v: Float32Array }\nexport function f(n: number): A { const v = new Float32Array(1); while (n < 1) { n = n + 1; } return { v }; }`, /unsupported statement/],
  ["non-canonical for loops", `export interface A { v: Float32Array }\nexport function f(n: number): A { const v = new Float32Array(1); for (let i = 0; i < n; i += 2) { v[0] = i; } return { v }; }`, /incrementor/],
  ["unknown Math members", `export interface A { v: Float32Array }\nexport function f(n: number): A { const v = new Float32Array(1); v[0] = Math.cbrt(n); return { v }; }`, /Math\.cbrt/],
  ["string typed params", `export interface A { v: Float32Array }\nexport function f(s: string): A { const v = new Float32Array(1); return { v }; }`, /unknown type/],
  ["typed-array reads", `export interface A { v: Float32Array }\nexport function f(n: number): A { const v = new Float32Array(2); v[0] = v[1]; return { v }; }`, /READS/],
  ["two entry functions", `export interface A { v: Float32Array }\nexport function f(): A { const v = new Float32Array(1); return { v }; }\nexport function g(): A { const v = new Float32Array(1); return { v }; }`, /exactly ONE exported bundle-returning entry/],
];

for (const [label, src, re] of REJECTS) {
  test(`logic transpiler rejects ${label}`, () => {
    expect(() => transpileLogic({ slug: "x", source: src, sourcePath: "x.ts", namespace: "x" })).toThrow(re);
  });
}

test("logic transpiler keeps JS numeric semantics for division and rounding", () => {
  const src = [
    `export interface Out { v: Float32Array }`,
    `export function f(n: number): Out {`,
    `  const v = new Float32Array(4);`,
    `  for (let i = 0; i < 2; i++) {`,
    `    const t = i / 2;`, // int/int must NOT integer-divide
    `    v[i] = t;`,
    `  }`,
    `  v[2] = Math.round(n);`, // JS Math.round == floor(x + 0.5)
    `  return { v };`,
    `}`,
  ].join("\n");
  const { swift, kotlin } = transpileLogic({ slug: "x", source: src, sourcePath: "x.ts", namespace: "x" });
  expect(kotlin).toContain("i.toDouble() / 2.0");
  expect(swift).toContain("Double(i) / 2.0");
  expect(kotlin).toContain("floor(n + 0.5)");
  expect(swift).toContain("floor(n + 0.5)");
});

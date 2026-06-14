/**
 * The "one list" gate.
 *
 * Every effect registry (the web umbrella + demo, the README gallery, and the
 * Swift + Android demo registries + dependency manifests) is GENERATED from the
 * single folder-discovered list (scripts/lib/effects.mjs) by
 * scripts/gen-registries.mjs. These tests are how a NEW effect can't go missing
 * from one of them again (which is how `checkmate` was absent from the reels):
 *
 *   1. every discovered effect's slug appears in every generated registry block;
 *   2. the generator is idempotent — `--check` passes against the committed tree.
 */
import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverEffects } from "../../../scripts/lib/effects.mjs";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EFFECTS = discoverEffects(ROOT);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// Each registry + a per-effect token that MUST appear for the effect to be wired.
const REGISTRIES = {
  "packages/effects/src/index.ts": (e) => `${e.slug} as ${e.slug}Effect`,
  "examples/demo/src/main.ts": (e) => `${e.slug}: () => import("${e.webPackage}")`,
  "examples/demo/index.html": (e) => `data-effect="${e.slug}"`,
  "README.md": (e) => `docs/media/${e.slug}.gif`,
  "swift/Demo/Sources/EffectRegistry.swift": (e) => `DemoEffect(name: "${e.slug}")`,
  "swift/Demo/project.yml": (e) => `path: "../../dist/swift/${e.swiftModule}"`,
  "android/dopamine-effects/src/main/kotlin/ai/dopamine/effects/Dopamine.kt": (e) => `${e.Name}.register(app)`,
  "android/dopamine-effects/build.gradle.kts": (e) => `api(project(":${e.androidModule}"))`,
};

test("there are effects to check", () => {
  expect(EFFECTS.length).toBeGreaterThan(0);
  expect(EFFECTS.map((e) => e.slug)).toContain("checkmate");
});

for (const [rel, token] of Object.entries(REGISTRIES)) {
  test(`${rel} lists every effect from effects/`, () => {
    const text = read(rel);
    for (const e of EFFECTS) {
      expect(text, `${e.slug} missing from ${rel}`).toContain(token(e));
    }
  });
}

test("the generated registries are up to date (gen-registries --check passes)", () => {
  // Throws (non-zero exit) if any registry is stale — the CI gate, run locally.
  expect(() =>
    execFileSync("node", ["scripts/gen-registries.mjs", "--check"], { cwd: ROOT, stdio: "pipe" }),
  ).not.toThrow();
});

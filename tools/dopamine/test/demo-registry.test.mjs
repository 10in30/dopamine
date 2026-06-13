/**
 * iOS demo registry consistency gate.
 *
 * `swift/Demo/Sources/EffectRegistry.swift` is hand-maintained Swift that only
 * compiles on the macOS CI job — so a stale reference to a DELETED hand factory
 * (e.g. calling `ComicConfig()` after comic moved to the generated panel seam)
 * is invisible to every Linux gate and only surfaces ~10 min into the macOS run.
 * This pins the invariant on Linux: an effect whose Swift factory is GENERATED
 * (no `effects/<name>/swift/<Name>.swift`) must be wired as `<Name>.passConfig()`
 * and must NOT reference a bare `<Name>Config()`; an effect that ships a
 * hand-written factory (solarbloom, confetti) uses `<Name>Config()`.
 */

import { test, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const registry = readFileSync(`${root}swift/Demo/Sources/EffectRegistry.swift`, "utf8");
const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Effects with a generated vs hand-written Swift factory. */
const effects = readdirSync(`${root}effects`, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

test("the iOS demo registry references the right factory per effect (generated vs hand)", () => {
  for (const name of effects) {
    const Name = pascal(name);
    // Only effects actually wired into the demo registry are in scope.
    if (!registry.includes(`name: "${name}"`)) continue;

    const handFactory = existsSync(`${root}effects/${name}/swift/${Name}.swift`);
    if (handFactory) {
      expect(registry, `${name} ships a hand Swift factory → expected ${Name}Config()`)
        .toContain(`${Name}Config(`);
    } else {
      // Generated factory: must use the generated entry point, never the
      // (now-deleted) hand `<Name>Config()`.
      expect(registry, `${name}'s factory is generated → expected ${Name}.passConfig()`)
        .toContain(`${Name}.passConfig()`);
      expect(registry, `${name}'s hand ${Name}Config() was deleted but the demo still references it`)
        .not.toContain(`${Name}Config(`);
    }
  }
});

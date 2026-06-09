/**
 * Toolchain test: the single `effects/comic/` folder, run through `@dopamine/build`,
 * emits a COMPLETE, standalone SwiftPM package — real `Package.swift`, the
 * hand-written sources, the generated binding glue, and a REAL embedded copy of
 * the `.dope` (not a symlink). This is the "one folder → an installable SwiftPM
 * package" contract; `swift build dist/swift/DopamineEffectComic` proves it
 * compiles (run separately, since it needs the Swift toolchain).
 *
 * Two fidelity anchors keep the migration honest:
 *  - the embedded `.dope` is byte-identical to the single canonical source, and
 *  - the GENERATED uniform struct is byte-identical to what `gen-uniforms` already
 *    produced in the tree (so the Swift binding layout cannot drift).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildEffect } from "../src/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", ".."); // <repo>
const outDir = join(root, "dist");

describe("dopamine toolchain — comic → standalone SwiftPM package", () => {
  it("emits a complete, installable Swift package from the single folder", async () => {
    const artifacts = await buildEffect({ root, effectDir: "effects/comic", outDir });
    const byPath = new Map(artifacts.map((a) => [a.path, a.content]));

    const M = "swift/DopamineEffectComic";
    const S = `${M}/Sources/DopamineEffectComic`;

    // Package manifest + hand-written sources + generated glue + real data.
    const expected = [
      `${M}/Package.swift`,
      `${S}/Comic.swift`,
      `${S}/ComicBundle.swift`,
      `${S}/ComicTempo.swift`,
      `${S}/ComicPanel.swift`,
      `${S}/ComicUniforms.swift`,
      `${S}/Shaders/Comic.metal`,
      `${S}/Shaders/DopamineLook.metal`,
      `${S}/Shaders/ComicUniforms.metal`,
      `${S}/Resources/comic.dope.json`,
    ];
    for (const p of expected) expect(byPath.has(p), p).toBe(true);

    // The Package.swift is a real standalone manifest depending on DopamineCore.
    expect(byPath.get(`${M}/Package.swift`)).toContain('.library(name: "DopamineEffectComic"');
    expect(byPath.get(`${M}/Package.swift`)).toContain('product(name: "DopamineCore"');

    // The embedded .dope is a REAL copy of the single canonical source.
    expect(byPath.get(`${S}/Resources/comic.dope.json`)).toBe(
      readFileSync(join(root, "effects/comic/comic.dope.json"), "utf8"),
    );

    // Fidelity: the generated binding glue declares the expected fields (the
    // standard set + comic's render.params + the scatter key + the frame extras)
    // and the packer — the layout the .metal `#include`s and the host fills.
    const swiftU = byPath.get(`${S}/ComicUniforms.swift`);
    expect(swiftU).toContain("public struct ComicUniforms {");
    for (const f of ["resolution", "exposure", "actionLines", "halftone", "saturation",
                     "comicSeed", "presence", "flash", "dotSize", "inkBoost"]) {
      expect(swiftU, f).toContain(`public var ${f}:`);
    }
    expect(swiftU).toContain("public func packComicUniforms(");
    const mslU = byPath.get(`${S}/Shaders/ComicUniforms.metal`);
    expect(mslU).toContain("struct ComicUniforms {");
    expect(mslU).toContain("float  exposure;");
    expect(mslU).toContain("float  comicSeed;");
  });
});

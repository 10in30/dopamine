/**
 * Aggregate root Package.swift gate.
 *
 * SwiftPM has no mainstream registry, so the effects are published as ONE
 * aggregate package at the repo root (DopamineCore + every DopamineEffect<Name>
 * product), installable by git URL + semver tag. The emitter is pure (entries →
 * manifest text); this pins its shape so a refactor can't silently break a
 * published consumer's `.product(name:)` / target paths. The macOS CI compiles
 * the same generated sources via the per-effect dist packages.
 */

import { test, expect } from "vitest";
import { emitAggregateSwiftPackage } from "../src/aggregate.mjs";

const ENTRIES = [
  { module: "DopamineEffectComic", slug: "comic", hasFonts: true },
  { module: "DopamineEffectInkstroke", slug: "inkstroke", hasFonts: false },
];

test("aggregate: products + targets for core and every effect, fonts only where declared", () => {
  const pkg = emitAggregateSwiftPackage(ENTRIES);

  // The package is named Dopamine and ships DopamineCore as a product + target
  // sourced from the in-repo runtime (not the gitignored dist/ tree).
  expect(pkg).toContain('name: "Dopamine"');
  expect(pkg).toContain('.library(name: "DopamineCore", targets: ["DopamineCore"]),');
  expect(pkg).toContain('.target(name: "DopamineCore", path: "swift/Sources/DopamineCore"),');

  // Each effect is a product + a target pointing at its generated dist sources,
  // depending on the in-package DopamineCore target.
  for (const e of ENTRIES) {
    expect(pkg).toContain(`.library(name: "${e.module}", targets: ["${e.module}"]),`);
    expect(pkg).toContain(`path: "dist/swift/${e.module}/Sources/${e.module}"`);
    expect(pkg).toContain(`.copy("Resources/${e.slug}.dope.json"),`);
  }

  // Fonts are copied ONLY for the effect that bundles faces (comic), not inkstroke.
  const comicBlock = pkg.slice(pkg.indexOf('path: "dist/swift/DopamineEffectComic'),
                               pkg.indexOf('path: "dist/swift/DopamineEffectInkstroke'));
  expect(comicBlock).toContain('.copy("Resources/fonts"),');
  const inkBlock = pkg.slice(pkg.indexOf('path: "dist/swift/DopamineEffectInkstroke'));
  expect(inkBlock).not.toContain('.copy("Resources/fonts"),');
});

test("aggregate: platforms clause is configurable and defaults to iOS 15 / macOS 12", () => {
  expect(emitAggregateSwiftPackage(ENTRIES)).toContain("platforms: [.iOS(.v15), .macOS(.v12)],");
  expect(emitAggregateSwiftPackage(ENTRIES, { platforms: ["iOS(.v16)", "macOS(.v13)"] }))
    .toContain("platforms: [.iOS(.v16), .macOS(.v13)],");
});

test("aggregate: deterministic — same entries produce identical bytes", () => {
  expect(emitAggregateSwiftPackage(ENTRIES)).toBe(emitAggregateSwiftPackage(ENTRIES));
});

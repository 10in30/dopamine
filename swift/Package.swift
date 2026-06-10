// swift-tools-version:5.9
//
// Dopamine — Swift / Metal port.
//
// This monorepo package now ships ONLY the shared `DopamineCore` runtime (the
// `.dope` loader + mapping grammar, OKLCH color, tempo primitives, the registry +
// mood-registry, and the resolve pipeline). Every EFFECT has migrated to the
// consolidated single-folder model under `effects/<name>/` and is built into a
// STANDALONE, installable SwiftPM package under `dist/swift/DopamineEffect<Name>`
// by the `@dopamine/build` toolchain (run `node tools/dopamine/src/cli.mjs build`).
// The iOS demo (swift/Demo/project.yml) consumes those dist packages by path,
// exactly like an external app would — the effect packages are no longer targets
// of this package.
//
// HARD PORTABILITY RULE: DopamineCore must build on Linux with NO Apple toolchain,
// so every Metal / MetalKit / UIKit type stays wrapped in `#if canImport(Metal)` /
// `#if canImport(UIKit)`. The Linux CI job is the guard. DopamineCore is now
// effect-agnostic — it ships NO effect data. The cross-platform byte-parity test
// carries the solarbloom `.dope` (a representative resolve vector) as a TEST
// FIXTURE alongside its expected-output fixture; it is not part of the library.

import PackageDescription

let package = Package(
    name: "Dopamine",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(name: "DopamineCore", targets: ["DopamineCore"]),
    ],
    targets: [
        .target(
            name: "DopamineCore"
        ),
        .testTarget(
            name: "DopamineCoreTests",
            dependencies: ["DopamineCore"],
            resources: [
                // The parity vector: solarbloom's `.dope` (input) + the web loader's
                // dumped output. Both live with the test, not in the shipped core.
                .copy("Fixtures/solarbloom.dope.json"),
                .copy("Fixtures/solarbloom-parity.json"),
            ]
        ),
    ]
)

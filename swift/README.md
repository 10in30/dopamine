# Dopamine — Swift / Metal port

This SwiftPM package ships the shared **`DopamineCore`** runtime for iOS/macOS and
**reuses the web `.dope` data verbatim**. Every effect lives in the consolidated
single-folder model at `effects/<name>/` (repo root) and is compiled by the
`@dopamine/build` toolchain into a STANDALONE `dist/swift/DopamineEffect<Name>`
SwiftPM package — so this package is just the runtime + its parity test; the iOS
demo consumes each effect from its `dist/` package by path.

## Layout

```
swift/
├─ Package.swift                       # DopamineCore library + the parity test target
├─ Sources/
│  ├─ DopamineCore/                    # the shared runtime (mirrors packages/core)
│  │  ├─ Seed.swift                    # mulberry32 (bit-exact JS port)            [PORTABLE]
│  │  ├─ Color.swift                   # OKLCH → linear sRGB, golden-angle palette [PORTABLE]
│  │  ├─ Tempo.swift                   # easeOutCubic/Back, envelope, NPR step     [PORTABLE]
│  │  ├─ Loader.swift                  # DopeDoc + evalExpr + resolveDopeParams    [PORTABLE]
│  │  ├─ ParseDope.swift               # parse/validate + ExprNode decode          [PORTABLE]
│  │  ├─ JSONOrdered.swift             # order-preserving JSON (authored mood order)[PORTABLE]
│  │  ├─ MoodRegistry.swift            # shared mood register                       [PORTABLE]
│  │  ├─ Registry.swift                # effect registry                           [PORTABLE]
│  │  ├─ Content.swift                 # pickBand / pickFromList / typography       [PORTABLE]
│  │  ├─ Shadow.swift                  # shadow-pass geometry math                  [PORTABLE]
│  │  ├─ Resources.swift               # bundled-.dope loader (effect-agnostic)     [PORTABLE]
│  │  ├─ MetalPassRunner.swift         # generic pass-runner + uniform binding     [METAL-ONLY]
│  │  └─ MetalOverlayHost.swift        # CAMetalLayer screen/multiply overlay      [METAL-ONLY]
│  └─ DopamineDemoiOS/                 # iOS demo app SKELETON (UIKit+Metal, CI-built only)
├─ Tests/DopamineCoreTests/
│  ├─ CoreUnitTests.swift              # PRNG/OKLCH/tempo/grammar                   [PORTABLE]
│  ├─ ParityTests.swift                # cross-platform byte + resolve parity       [PORTABLE]
│  └─ Fixtures/
│     ├─ solarbloom.dope.json          # parity vector (portable bytes; refreshed by regen-parity.sh)
│     └─ solarbloom-parity.json        # web loader's expected grid output
└─ Scripts/{dump-parity.ts,regen-parity.sh}   # regenerate the fixtures from web code
```

Each effect's hand-written Swift + `.metal` sources live at
`effects/<name>/swift/`; `dopamine build` emits them — plus the generated
`<Name>Uniforms.{swift,metal}` and the bundled `.dope` — into
`dist/swift/DopamineEffect<Name>` (a real, installable SwiftPM package).

## Portability

`swift build` / `swift test` work on **Linux** with no Apple toolchain: every
Metal/MetalKit/UIKit type is behind `#if canImport(Metal)` / `#if canImport(UIKit)`.
On Linux you get the portable core; the Metal host + shader pass-runner + each
effect's `.metal` shaders are verified only on macOS (see CI). `DopamineCore` is
**effect-agnostic** — it ships no effect data; the parity vector is a test fixture.

## The shared `.dope`

The canonical `effects/solarbloom/solarbloom.dope.json` is the single source of
truth. The toolchain embeds a byte-identical PORTABLE copy into the dist package
(and `regen-parity.sh` mirrors the same bytes into `Tests/.../Fixtures` as the
parity vector). `Tests/.../ParityTests` loads that `.dope`, resolves a **mood ×
intensity × whimsy × seed** grid, and asserts the numbers equal the web loader's
dumped output. Same data, same math, two platforms.

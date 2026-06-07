# Dopamine — Swift / Metal port (vertical slice)

A SwiftPM package that mirrors the web monorepo's architecture for iOS/macOS and
**reuses the web `.dope` data verbatim**. This is ONE vertical slice (the
Solarbloom effect), not all nine effects.

## Layout

```
dopamine/swift/
├─ Package.swift                       # DopamineCore + DopamineEffectSolarbloom libs + tests
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
│  │  ├─ Content.swift                 # pickBand / pickFromList                    [PORTABLE]
│  │  ├─ Shadow.swift                  # shadow-pass geometry math                  [PORTABLE]
│  │  ├─ Resources.swift               # bundled-.dope loader                       [PORTABLE]
│  │  ├─ MetalPassRunner.swift         # generic pass-runner + uniform binding     [METAL-ONLY]
│  │  ├─ MetalOverlayHost.swift        # CAMetalLayer screen/multiply overlay      [METAL-ONLY]
│  │  └─ Resources/solarbloom.dope.json   # SAME bytes as the web .dope (parity copy)
│  ├─ DopamineEffectSolarbloom/        # the ONE effect (mirrors effect-solarbloom)
│  │  ├─ Solarbloom.swift              # resolve via .dope + the Metal PassConfig
│  │  ├─ SolarbloomTempo.swift         # bespoke check-draw tempo (the ONLY bespoke timing)
│  │  ├─ Shaders/DopamineLook.metal    # shared MSL "look" lib (mirrors look/glsl.ts)
│  │  ├─ Shaders/Solarbloom.metal      # the bloom MSL fragment shader              [METAL-ONLY]
│  │  └─ Resources/solarbloom.dope.json   # SAME bytes as the web .dope (runtime data)
│  └─ DopamineDemoiOS/                 # iOS demo app SKELETON (UIKit+Metal, CI-built only)
├─ Tests/DopamineCoreTests/
│  ├─ CoreUnitTests.swift              # PRNG/OKLCH/tempo/grammar                   [PORTABLE]
│  ├─ ParityTests.swift                # cross-platform byte + resolve parity       [PORTABLE]
│  ├─ MetalTests.swift                 # uniform layout / config / frame hook      [METAL-ONLY]
│  └─ Fixtures/solarbloom-parity.json  # web loader's expected grid output
└─ Scripts/{dump-parity.ts,regen-parity.sh}   # regenerate the fixture from web code
```

## Portability

`swift build` / `swift test` work on **Linux** with no Apple toolchain: every
Metal/MetalKit/UIKit type is behind `#if canImport(Metal)` / `#if canImport(UIKit)`.
On Linux you get the portable core + the portable parts of the effect (its tempo,
its uniform-struct shape, and the bundled `.dope`); the Metal host + shader
pass-runner + the `.metal` shaders are verified only on macOS (see CI).

## The shared `.dope`

`packages/effect-solarbloom/src/solarbloom.dope.json` is copied **byte-for-byte**
into both Swift packages' `Resources/` (same md5). The loader, the OKLCH math,
the grammar, and the PRNG order are ported faithfully; `Tests/.../ParityTests`
loads the bundled `.dope`, resolves a **mood × intensity × whimsy × seed** grid,
and asserts the numbers equal the web loader's dumped output. Same data, same
math, two platforms.

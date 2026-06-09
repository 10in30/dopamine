# CLAUDE.md

Guidance for AI agents (and humans) working in this repository.

## What this is

Dopamine is a cross-platform visual-effects library. There are **ten effects**
today — solarbloom, aurora, comic, confetti, fail, heartburst, inkstroke,
lightning, ripple, halo — implemented from **one shared data spine** across three
stacks: a web stack (TypeScript + WebGL2), a Swift stack (Swift + Metal), and an
**Android stack (Kotlin + OpenGL ES 3.0)**. We will add many more effects and
expand the mechanisms in existing ones. **The portable `.dope` file matters more
than any of the code** — the code on every platform is an interpreter for that
data.

> **`halo` is the first CONTINUOUS effect.** The other nine are one-shot reward
> moments (`amp = envelope(life)`, a 0→peak→0 fade); `halo` is a calm ambient
> "loading" ring that LOOPS SEAMLESSLY. It departs from the envelope convention:
> all motion is periodic in `uTimeS` (period 1.5 s) and `tempo.durationMs` (6000)
> is an integer number of periods, so the frame at `t == durationMs` matches
> `t == 0` at every whimsy. See `docs/cross-platform-effects-rfc.md` for a
> proposal to make looping a first-class format/runner feature.

> **Android status.** The portable core (`android/dopamine-core`,
> byte-parity-tested), the GL rendering backbone (`android/dopamine-gl`), and **all
> ten effects** now ship on the same `.dope` spine (each its own
> `dopamine-effect-<name>` module + the `dopamine-effects` umbrella). See
> `android/README.md` for the per-effect porting contract.

## The shared `.dope` spine

Each effect ships a `<name>.dope.json` (the format is specced in
`docs/effect-format.md`, JSON-schema in `docs/effect-format.schema.json`). It
declares the effect's mood→params mapping (a tiny expression grammar:
`lerp`/`mul`/`baseline`/`control`/`round`/`clamp…`), its content pool and
typography (comic), and its icon (solarbloom's SDF). The loader evaluates that
grammar plus an OKLCH golden-angle palette into the render params the shader
consumes — **consuming the PRNG in the same order on both platforms**, so a
given `mood × intensity × whimsy × seed` resolves to byte-identical numbers in
TS and Swift.

**The same `.dope` bytes live on both sides.** Each effect's `.dope` is copied
verbatim into the matching Swift package's `Resources/` (same md5). Do not edit
one copy without the other.

### Parity is gated by tests, not by trust

- **Web:** `packages/core/test/loader.test.ts` proves the data path is
  byte-identical to the (historical) code path.
- **Swift:** `swift/Tests/DopamineCoreTests/ParityTests.swift` loads the bundled
  `.dope`, resolves a **192-case** `mood × intensity × whimsy × seed` grid, and
  asserts every scalar equals the web loader's dumped fixture
  (`Fixtures/solarbloom-parity.json`). Regenerate the fixture from web code with
  `swift/Scripts/regen-parity.sh` (→ `dump-parity.ts`).

## The generalization boundary (read before adding an effect)

Both `@dopamine/core` (web) and `DopamineCore` (Swift) are thin **backbones**.
Everything general lives there; only three things are genuinely **per-effect**:

1. the **shader** (`<name>-shader.ts` / `<Name>.metal` + the shared
   `DopamineLook` look lib),
2. the **bespoke tempo** (`<name>-tempo.ts` / `<Name>Tempo.swift`) — the only
   bespoke timing,
3. the **uniform config** (the `.dope` `render.params` + a small manifest entry;
   see gen-uniforms below).

If you find yourself editing the backbone to add an effect, stop — that almost
always means something that should be generalized is being special-cased.

**Web:** scaffold a new `packages/effect-<name>` (its own shader + tempo + `.dope`
+ factory + test, depends on `@dopamine/core`, self-registers on import). Add it
to the `@dopamine/effects` umbrella deps + the `build` script in `package.json`.
No core edits.

**Swift key architecture:**
- `PassConfig` — an effect's declarative description of its Metal render pass.
- `MetalPassRunner` — the generic pass-runner + uniform binding (Metal-only).
- `MetalOverlayHost` — the `CAMetalLayer` screen/multiply overlay host, with a
  **`prepare(params:)` / `play()`** split and a **`PanelDrawing`** protocol hook
  that lets the backbone draw/upload an offscreen panel texture for the **hybrid
  effects (comic + heartburst)**. New simple effects need none of this; hybrids
  implement `PanelDrawing`.

**Android key architecture** (`android/`, a Gradle multi-module build; full
detail in `android/README.md`):
- `dopamine-core` — the portable spine as a **pure Kotlin/JVM** library (no
  Android deps), so the **192-case byte-parity grid runs on a plain JVM with no
  Android SDK** (the analog of swift's Linux job). It also holds the shared GLSL
  "look" chunks **once** (`Look.kt`) — an improvement on the Swift port, which had
  to copy `DopamineLook.metal` into every package.
- `dopamine-gl` — the OpenGL ES 3.0 backbone: `DopamineView` (the `GLSurfaceView`
  overlay host + conductor) and the generic `GlPassRunner` / `GlPanelRunner` (+
  `PanelConfig`'s `Canvas` `draw` hook for hybrids — the analog of swift's
  `PanelDrawing`).
- `dopamine-effect-<name>` — one Android library per effect: its GLSL shader
  (Kotlin string), bespoke tempo, `.dope` (in `assets/`, byte-identical), panel
  draw (hybrids), config + registration. `dopamine-effects` is the umbrella.

Two simplifications the Android port surfaces (Kotlin has no `#if canImport`, so
the Metal/portable split is by MODULE instead):
1. **The shaders are the web's GLSL, near-verbatim** — Android OpenGL ES 3.0 is
   GLSL ES 3.00, *the same language as WebGL2*. The only per-shader change is the
   final emit (`dopLightOut(col)` — premultiplied light) for the self-contained
   overlay; the RGB look is byte-identical.
2. **No `gen-uniforms` is needed.** GL ES sets uniforms one-by-one **by name**
   (like WebGL), so the web's `name → u<Name>` auto-bind ports verbatim. The
   Metal struct-packing codegen exists only because a `.metal` reads one packed
   `Uniforms` struct; Android (like web) has no such struct.

## gen-uniforms — the web↔Swift uniform generator (STALENESS-GATED)

WebGL sets uniforms one-by-one by name at runtime; Metal reads one
`constant Uniforms &u [[buffer(0)]]` struct. That mismatch used to force a
hand-written MSL struct + Swift packer per effect — three places that silently
drift. `scripts/gen-uniforms.mjs` makes that binding map **data**: from each
effect's `.dope` `render.params` + a small per-effect manifest in the script
(`EFFECTS`, one block per effect) it generates, from one source of truth:

- the MSL `struct <Name>Uniforms { … }` the shader `#include`s,
- the Swift `<Name>Uniforms` struct + `pack<Name>Uniforms(...)`,
- the web `u<Name>` uniform-name list.

```bash
node scripts/gen-uniforms.mjs            # regenerate all (or pass effect names)
node scripts/gen-uniforms.mjs --check    # CI gate: regenerate to temp + diff
```

**`swift.yml` fails if the generated files drift** (it runs `--check`, then
regenerates and `git diff --exit-code -- swift/Sources swift/Generated`). So:

- **NEVER hand-edit generated uniform files.** They carry
  `// @generated by scripts/gen-uniforms.mjs — do not edit`. Edit the `.dope`
  (and/or the manifest entry) and re-run `gen-uniforms`.
- After changing any `.dope` `render.params`, run `gen-uniforms` and commit the
  regenerated `swift/Sources/**/*Uniforms.*` + `swift/Generated/*`.

## Build / test / reel — both stacks

**Web** (from repo root):
```bash
npm install
npm test                 # vitest across every package (incl. the parity suites)
npm run build            # core → effect-* → effects → react → demo (topo order)
npm run dev              # interactive demo
npm run reel             # render every effect in headless Chromium + stitch → e2e/output/dopamine-suite.mp4
node scripts/gen-uniforms.mjs --check
```

**Swift** (from `swift/`):
```bash
swift build              # DopamineCore + every DopamineEffect<Name>
swift test               # portable + (macOS) Metal-guarded + the 192-case parity grid
cd Demo && xcodegen generate && xcodebuild -project DopamineDemo.xcodeproj \
  -scheme DopamineDemo -destination 'platform=iOS Simulator,name=iPhone 16' build
```

**Android** (from `android/`):
```bash
./gradlew :dopamine-core:test   # the 192-case byte-parity grid — NO Android SDK needed
./gradlew assembleDebug         # GL backbone + effects + demo APK (needs the Android SDK)
```
`dopamine-core` builds + tests on a plain JVM (no SDK); the GL/effect/demo modules
are auto-included only when an Android SDK is present (`ANDROID_HOME` /
`local.properties`). Adding an effect = a new `dopamine-effect-<name>` module
(auto-discovered by `settings.gradle.kts`); no backbone edits.

## CI layout

- **`.github/workflows/web-reel.yml`** (ubuntu) — builds the web packages and
  runs `npm run reel`; uploads `dopamine-web-reel` (`e2e/output/dopamine-suite.mp4`).
  Triggers on `packages/**`, `examples/**`, `scripts/**`, and the workflow file.
- **`.github/workflows/swift.yml`** — two jobs:
  - **macOS** (`macos-15-xlarge`, M2): `swift build`/`test` (Metal compiles + the
    Metal-guarded tests), the **gen-uniforms staleness gate**, then XcodeGen →
    `xcodebuild` the iOS-Simulator demo, boot a sim, autoplay all ten, and
    `simctl recordVideo` a sequence (uploaded as `solarbloom-sim-clip`).
    build+test+gate are MUST-PASS; the record step is best-effort.
  - **linux** (`swift:6.0.3`, no Apple SDK): build + the parity test — proves the
    `canImport` guards keep the portable core compiling.
  Triggers on `swift/**`, `scripts/gen-uniforms.mjs`, and the workflow file.
- **`.github/workflows/android.yml`** — three ubuntu jobs:
  - **jvm** (free runner, no SDK): the 192-case parity grid (`:dopamine-core:test`)
    + a `.dope` byte-parity check (Android copies == canonical web). MUST-PASS.
  - **build**: install the Android SDK + `assembleDebug` (GL backbone + effects +
    demo APK). MUST-PASS.
  - **emulator** (best-effort): boot an emulator, autoplay every effect at slow-mo,
    `screenrecord` a clip (proves the GLSL compiles + runs on a real GL ES driver).
  Triggers on `android/**`, the canonical `.dope` files, and the workflow file.

Both workflows trigger on pushes to **`main`** (plus `workflow_dispatch`). The
macOS job requires the `macos-15-xlarge` larger runner and a **non-zero Actions
spending limit** on the owning account; the Linux jobs run on free runners.

## Conventions a future agent MUST follow

- **`canImport` guards keep `DopamineCore` building on Linux.** Any
  Metal/MetalKit/UIKit/CoreAnimation usage must sit behind
  `#if canImport(Metal)` / `#if canImport(UIKit)`. The Linux CI job is the guard
  against breaking this — don't disable it.
- **Never hand-edit generated uniform files** (`swift/Generated/*`,
  `swift/Sources/**/*Uniforms.{swift,metal}`). Edit the `.dope` + manifest and
  re-run `gen-uniforms`.
- **Keep each effect's `.dope` byte-identical across web, Swift, AND Android
  copies.** The Android copy lives in `android/dopamine-effect-<name>/src/main/
  assets/<name>.dope.json`; `android.yml`'s jvm job md5-checks it against the
  canonical web file.
- **Android: keep the Metal/portable split by MODULE** (Kotlin has no
  `canImport`). Nothing in `dopamine-core` may import `android.*` — it must stay a
  pure-JVM library so the parity grid runs with no SDK. Android code touching
  `android.*` lives in `dopamine-gl` or an effect module. **Do NOT hand-port
  shaders to a new dialect or add uniform codegen for Android** — reuse the web
  GLSL (same GLSL ES 3.00) and bind uniforms by name (see `android/README.md`).
- **Don't special-case the backbone for one effect** — generalize, or use the
  existing per-effect seams (shader / tempo / uniform config / `PanelDrawing`).
- **Don't break the gates:** the vitest parity suite, the gen-uniforms staleness
  check, the Swift build (Linux + macOS), and either reel pipeline.
- **Commit author must be `Claude <noreply@anthropic.com>`** so commits aren't
  flagged Unverified:
  ```bash
  git config user.email noreply@anthropic.com && git config user.name Claude
  ```

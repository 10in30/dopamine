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
typography (comic), its icon (solarbloom's SDF), and — for the datafied effects
— its PER-FRAME logic (`tempo.frame`, a per-frame expression grammar over
`animMs`/`life`/`elapsedMs` + the resolved params; see
`docs/effect-format.md` §7.1) plus `render.shadowHeightFrac`/`consts`/`config`
and the uniform `binding` contract. The loader evaluates the mapping grammar
plus an OKLCH golden-angle palette into the render params the shader
consumes — **consuming the PRNG in the same order on both platforms**, so a
given `mood × intensity × whimsy × seed` resolves to byte-identical numbers in
TS and Swift.

**The same `.dope` bytes live on both sides.** Each effect's `.dope` is copied
verbatim into the matching Swift package's `Resources/` (same md5). Do not edit
one copy without the other.

### Parity is gated by tests, not by trust

- **Web:** `packages/core/test/loader.test.ts` exercises the effect-agnostic
  loader rules (schema + standalone guards); each effect's own tests pin its
  production resolve behavior.
- **Swift:** `swift/Tests/DopamineCoreTests/ParityTests.swift` loads the bundled
  `.dope`, resolves a **192-case** `mood × intensity × whimsy × seed` grid, and
  asserts every scalar equals the web loader's dumped fixture
  (`Fixtures/solarbloom-parity.json`). Regenerate the fixture from web code with
  `swift/Scripts/regen-parity.sh` (→ `dump-parity.ts`). Android runs the same
  grid pure-JVM (`ParityTest.kt`).

## The generalization boundary (read before adding an effect)

Both `@dopamine/core` (web) and `DopamineCore` (Swift) are thin **backbones**.
Everything general lives there; only three things are genuinely **per-effect**:

1. the **shader** — authored ONCE as the web GLSL ES 3.00 (`<name>-shader.ts`).
   For effects with an `x-build.shader` block (aurora, ripple, inkstroke, halo,
   fail today), the **MSL `<Name>.metal` AND the Android `<Name>Shader.kt` are
   GENERATED from that one web GLSL** by `@dopamine/build`'s transpiler
   (`tools/dopamine/src/shader.mjs` for MSL; `android-shader.mjs` for the `.kt`) —
   no hand-ported shader to drift. See "Single-source shaders" below. (The panel
   effects — comic, heartburst, solarbloom, confetti — keep hand-written shaders.)
2. the **bespoke tempo** — for the five DATAFIED effects (aurora, ripple,
   inkstroke, halo, fail) this is now **`.dope` DATA**, not code: `tempo.frame`
   (the per-frame amp + extras as expression trees), `tempo.reducedMotion`,
   `render.shadowHeightFrac`, `render.consts` and `render.config`, evaluated by
   the core per-frame evaluator (web: `framework/frame-expr.ts`, unit-tested by
   the frame-expr suites on all three stacks; the per-effect `dope-config` tests
   pin the derived uniforms/bindings/consts contract). The non-datafied effects
   still ship `<name>-tempo.ts` / `<Name>Tempo.swift` code,
3. the **uniform config** (the `.dope` `render.params` + the `.dope` `binding`
   contract; see the build toolchain below).

For a datafied effect the WEB FACTORY IS A SHIM: the shader consts + one
`registerDopeEffect(DOPE, shader, opts?)` call (`framework/dope-pass.ts`), which
derives the whole `PassConfig` — uniforms, bindings, `frame()`,
`shadowHeightFrac`, `usesOrigin` — from the `.dope` + its `binding` contract and
registers the factory (+ a bundled program). Genuinely code-shaped bits (fail's
SDF aux texture + canvas-dependent pass uniforms) ride the `hooks` escape hatch.

If you find yourself editing the backbone to add an effect, stop — that almost
always means something that should be generalized is being special-cased.

**Every effect lives in the single-folder model** at `effects/<name>/`: the unified
`<name>.dope.json` (data spine + the `binding` contract + the per-platform
`x-build` config) plus the hand-written `web/`, `swift/`, and `android/` sources
(and `fonts/` if it bundles faces). The `@dopamine/build` toolchain
(`tools/dopamine`, run `node tools/dopamine/src/cli.mjs build`) reads that one
folder and emits STANDALONE, installable platform packages into `dist/` (an npm
package, a SwiftPM package, a Gradle library) — each with a byte-identical
embedded portable `.dope`. Demos + external consumers load from `dist/`.

**Web:** scaffold a new `effects/<name>/web` workspace package (its own shader +
tempo + factory + test, depends on `@dopamine/core`, self-registers on import; it
imports `./<name>.dope.json`, the gitignored portable copy the toolchain syncs in).
The root `workspaces` glob (`effects/*/web`) + the auto-discovering vitest/Vite
aliases pick it up; add it to the `@dopamine/effects` umbrella deps + the `build`
script in `package.json`. No core edits.

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

## Uniform binding — the `.dope` `binding` contract (ships portable + drives codegen)

WebGL sets uniforms one-by-one by name at runtime; Metal reads one
`constant Uniforms &u [[buffer(0)]]` struct. That mismatch used to force a
hand-written MSL struct + Swift packer per effect — three places that silently
drift. The `.dope` `binding` contract (`excludeParams` / `scatterKey` /
`scatterWeb` / `extras` / `samplers` — which params are NOT shader uniforms, the
seed-keyed scatter field, the per-frame/host extras, the texture samplers) is the
one source of truth, and it **SHIPS in the portable `.dope`** (it is no longer
stripped): the web runtime derives the `u<Name>` uniform list + the binding
exceptions from it at load time (`framework/dope-pass.ts`). The build toolchain
(`tools/dopamine`) consumes the same contract + `render.params` to generate, into
the effect's `dist/` SwiftPM package:

- the MSL `struct <Name>Uniforms { … }` the shader `#include`s,
- the Swift `<Name>Uniforms` struct + `pack<Name>Uniforms(...)`,
- (web sets uniforms by name, so it needs no generated struct — same as Android.)

> The standalone `scripts/gen-uniforms.mjs` generator has been **retired** — the
> toolchain owns this for every (now single-folder) effect. Its old hand-written
> per-effect `EFFECTS` manifest moved into each `.dope`'s `binding` block.

```bash
node tools/dopamine/src/cli.mjs build            # regenerate all (or name effects)
node tools/dopamine/src/cli.mjs build --check    # CI staleness gate (idempotent build)
```

**`swift.yml` fails if the build isn't idempotent** (it runs `dopamine build`,
then `--check`). So:

- **NEVER hand-edit generated uniform files** (they live in gitignored `dist/` and
  carry `// @generated by @dopamine/build — do not edit`). Edit the `.dope`
  `render.params` and/or its `binding` contract and re-run `dopamine build`.
- The generated files are not committed (they're rebuilt into `dist/` from the
  `.dope` on every build); only the `effects/<name>/` source is tracked.

## Single-source shaders — GLSL → MSL + Android, generated by the toolchain

The web GLSL ES 3.00 (`<name>-shader.ts`) is the **single source** for an effect's
shader. When the `.dope` declares an `x-build.shader` block
(`{ web, vertexExport, fragmentExport, generateMSL }`), `dopamine build` GENERATES the
other platforms' shaders from it — there is no hand-ported `.metal`/`.kt` to drift:

- **MSL** (`tools/dopamine/src/shader.mjs`): a scoped GLSL→MSL transpiler — `vecN→floatN`,
  `matN(scalars)`→column-grouped `floatNxN`, 2-arg `atan`→`atan2`, per-name uniforms →
  one `constant <Name>Uniforms &u` struct (a `u`-injection fixpoint threads it through
  the call graph; a GLSL param named `u` is renamed `uu`), `paletteMix`→`dop_paletteMix`
  + the 3 stops, `out T`→`thread T &`, texture samplers → `texture2d<float> … [[texture(n)]]`
  + a shared `sampler texSampler [[sampler(0)]]` (texture(0) = the panel slot; a `needsTex`
  fixpoint threads them) with `texture(uX,uv)`→`<name>.sample(texSampler,uv)`, `main()`→ the
  `<slug>_vertex`/`_fragment` entries with the y-flip preamble + the premultiplied light-out
  tail. It throws on anything outside this subset.
- **Android** (`android-shader.mjs`): emits `<Name>Shader.kt` from the same web GLSL — body
  reused verbatim (GL ES 3.0 == GLSL ES 3.00), `${GLSL_*}` look-chunk refs kept (look stays
  in `Look.kt` once), consts resolved, `+ ${GLSL_LIGHT_OUT}` and the `dopLightOut(col)` emit.
- The resolved web GLSL is loaded by esbuild-bundling the `.ts` (`glsl-load.mjs`); **esbuild
  is a declared dep — swift.yml/android.yml run `npm ci --ignore-scripts` before `dopamine build`.**

**Gates (don't edit generated shaders by hand — edit the web GLSL + re-run the build):**
- `tools/dopamine/test/shader-msl.test.mjs` snapshots the generated MSL + Android `.kt`
  byte-for-byte (`golden-msl/` + `golden-android/`).
- The macOS Metal compile (`swift.yml`) + the self-contained mid-frame gate
  (`scripts/shader-goldens.mjs`, in `web-reel.yml` — renders the literal web AND Android-derived
  GLSL through SwiftShader and asserts web↔Android RGB Δ0; no committed golden images).

> **Migrated:** aurora, ripple, inkstroke, halo, fail. **Not migrated** (multi-pass *panel*
> effects — hand-written shaders, like the comic/heartburst hybrids): solarbloom, confetti.
> **lightning** stays hand-written until its CPU bolt-precompute (the `[[buffer]]` vertex array)
> is datafied/transpiled.

## Build / test / reel — both stacks

**Web** (from repo root):
```bash
npm install
npm test                 # vitest across every package (incl. the parity suites)
npm run build            # core → effect-* → effects → react → demo (topo order)
npm run dev              # interactive demo
npm run reel             # render every effect in headless Chromium + stitch → e2e/output/dopamine-suite.mp4
node tools/dopamine/src/cli.mjs build --check   # toolchain staleness gate (all effects)
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
  Triggers on `packages/**`, `effects/**`, `tools/dopamine/**`, `examples/**`,
  `scripts/**`, and the workflow file.
- **`.github/workflows/swift.yml`** — two jobs:
  - **macOS** (`macos-15-xlarge`, M2): `swift build`/`test` (Metal compiles + the
    Metal-guarded tests), the **`dopamine build --check` staleness gate**, then
    XcodeGen → `xcodebuild` the iOS-Simulator demo (consuming every effect's
    `dist/` SwiftPM package), boot a sim, autoplay all ten, and `simctl recordVideo`
    a sequence (uploaded as `solarbloom-sim-clip`).
    build+test+gate are MUST-PASS; the record step is best-effort.
  - **linux** (`swift:6.0.3`, no Apple SDK): build + the parity test — proves the
    `canImport` guards keep the portable core compiling.
  Triggers on `swift/**`, `effects/**`, `tools/dopamine/**`, and the workflow file.
- **`.github/workflows/android.yml`** — three ubuntu jobs:
  - **jvm** (free runner, no SDK): the 192-case parity grid (`:dopamine-core:test`)
    + a `.dope` byte-parity check (every effect's three `dist/` embeds identical +
    the core JVM grid resource matches). MUST-PASS.
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
- **Never hand-edit generated uniform files** (the `*Uniforms.{swift,metal}` in
  gitignored `dist/`). Edit the `.dope` `render.params` and/or its `binding`
  contract and re-run `node tools/dopamine/src/cli.mjs build`.
- **There is ONE `.dope` per effect** — the canonical `effects/<name>/<name>.dope.json`.
  The toolchain embeds a byte-identical PORTABLE copy into each platform package
  under `dist/`; `android.yml`'s jvm job md5-checks all three embeds are identical.
  Never hand-maintain per-platform `.dope` copies.
- **Android: keep the Metal/portable split by MODULE** (Kotlin has no
  `canImport`). Nothing in `dopamine-core` may import `android.*` — it must stay a
  pure-JVM library so the parity grid runs with no SDK. Android code touching
  `android.*` lives in `dopamine-gl` or an effect module. **Do NOT hand-port
  shaders to a new dialect or add uniform codegen for Android** — reuse the web
  GLSL (same GLSL ES 3.00) and bind uniforms by name (see `android/README.md`).
- **Don't special-case the backbone for one effect** — generalize, or use the
  existing per-effect seams (shader / tempo / uniform config / `PanelDrawing`).
- **Don't break the gates:** the vitest parity suite, the `dopamine build --check`
  staleness gate, the Swift build (Linux + macOS), and either reel pipeline.
- **Commit author must be `Claude <noreply@anthropic.com>`** so commits aren't
  flagged Unverified:
  ```bash
  git config user.email noreply@anthropic.com && git config user.name Claude
  ```

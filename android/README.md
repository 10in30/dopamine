# Dopamine — Android (Kotlin + OpenGL ES 3.0)

The Android port of Dopamine. Like the web (TypeScript + WebGL2) and Swift
(Swift + Metal) stacks, it is an **interpreter for the shared `.dope` files** —
the same bytes drive all three platforms. This directory mirrors `swift/`.

> **Status: all nine effects ship.** The portable core, the GL rendering
> backbone, and every effect — solarbloom, aurora, comic, confetti, fail,
> heartburst, inkstroke, lightning, ripple — are ported on the same `.dope` spine
> (each its own `dopamine-effect-<name>` module). See
> [Porting an effect](#porting-an-effect) for the per-effect contract.

## Why OpenGL ES 3.0

Android OpenGL ES 3.0 uses **GLSL ES 3.00 — the exact shading language the web's
WebGL2 already uses.** Two consequences shape the whole port, and are the reason
it is *smaller* than the Metal port:

1. **The shaders are the web's GLSL, near-verbatim.** No hand-port to a new
   dialect (the Metal port rewrote every shader into MSL). The shared GLSL "look"
   chunks (`hash`, `fbm`, `paletteMix`, `tonemapACES`, `benday`, …) live **once**
   in `dopamine-core` (`Look.kt`) and effects compose them exactly like the web
   (`"#version 300 es …" + GLSL_HASH + …`). The Metal port had to copy
   `DopamineLook.metal` into every package; here there is one canonical copy.
2. **No uniform codegen.** GL ES sets uniforms one-by-one **by name**
   (`glUniform*`), exactly like WebGL — so the web's `name → u<Name>` auto-bind
   ports verbatim, and Android needs **none** of the `scripts/gen-uniforms.mjs`
   struct-packing machinery (that exists only because a `.metal` reads one packed
   `Uniforms` struct).

The single deliberate divergence from the web shaders is the final pixel: see
[the overlay model](#the-self-contained-overlay).

## Module layout

```
android/
├─ settings.gradle.kts      # auto-discovers dopamine-effect-* modules; core-only when no SDK
├─ dopamine-core/           # PURE Kotlin/JVM — the portable spine. NO android.* imports.
│   ├─ src/main/kotlin/…     #   Seed, Color, Tempo, Shadow, Json, Loader, ParseDope,
│   │                        #   Registry, MoodRegistry, Content, Look (GLSL chunks)
│   └─ src/test/…            #   ParityTest — the 192-case byte-parity grid (runs on the JVM)
├─ dopamine-gl/             # Android lib — OpenGL ES 3.0 backbone (the analog of swift's
│                           #   Metal-guarded half): DopamineView host + GlPassRunner +
│                           #   GlPanelRunner + PassConfig/PanelConfig + DrawableEffect.
├─ dopamine-effect-<name>/  # Android lib per effect — shader + tempo + .dope (asset) +
│                           #   panel draw (hybrids) + factory (self-registers via register()).
├─ dopamine-effects/        # umbrella — registers all nine (activates once all are present).
└─ demo/                    # Android app — translucent overlay, tap / autoplay.
```

**Why the module split (vs swift's single guarded target).** Swift keeps the
portable core and the Metal host in ONE target, gated by `#if canImport(Metal)`.
Kotlin has no per-import compile guard, so the split is by **module**:
`dopamine-core` is a **pure-JVM** library (it must never import `android.*`), so
the byte-parity grid builds + runs on a plain JVM with **no Android SDK** — the
analog of swift's Linux job. Everything that touches `android.*` (the GL host,
the `Canvas` panel draws) lives in the Android-library modules, which need the
SDK. `settings.gradle.kts` includes those modules only when an SDK is present.

## Build & test

```bash
cd android

# The correctness gate — the 192-case byte-parity grid. NO Android SDK required.
./gradlew :dopamine-core:test

# The full Android build (GL backbone + effect packages + demo APK). Needs the SDK
# (ANDROID_HOME / ANDROID_SDK_ROOT, or android/local.properties with sdk.dir=…).
./gradlew assembleDebug
```

With no SDK, `settings.gradle.kts` configures **only** `dopamine-core`, so the
parity gate runs anywhere a JVM + Gradle exist (it auto-downloads the Kotlin
plugin + JUnit). CI runs this on a free runner.

## Parity is gated by tests, not by trust

`dopamine-core/src/test/.../ParityTest.kt` loads the **same**
`solarbloom-parity.json` fixture the swift `ParityTests` asserts against (dumped
by running the ACTUAL web `loader.ts` across a `mood × intensity × whimsy × seed`
grid — ground truth, not a reimplementation), resolves the bundled
`solarbloom.dope.json` across that **192-case** grid in Kotlin, and asserts every
scalar + palette stop is identical to the web output. This catches any drift in
the PRNG order (`mulberry32` in `UInt` space), the OKLCH math, the mapping
grammar, the clamp flags, or the default-mood fallback.

The `.dope` bytes are **byte-identical** across web, Swift, and Android (the
Android copy is the effect module's `src/main/assets/<name>.dope.json`); the
`android.yml` jvm job md5-checks them against the canonical web file.

## The self-contained overlay

The web composites its light canvas over the page with CSS
`mix-blend-mode: screen`. Android — like Core Animation on iOS (see swift's
`MetalOverlayHost`) — has **no** per-surface screen-blend against arbitrary view
content. So `DopamineView` is a **self-contained** overlay: a **translucent**
`GLSurfaceView`, cleared transparent, that **additively accumulates premultiplied
light**. Dark regions stay transparent (the host UI shows through); bright light
reads as cast light over it — the web's light layer, achieved within one surface.

The one shader change from the web: the final emit is `dopLightOut(col)`
(premultiplied alpha = brightness; `Look.kt`) instead of `vec4(col, 1.0)`. The
RGB look is byte-identical. (Solarbloom's web shader already emits exactly this.)

A `uShadow` multiply pass exists in the config/shader contract for portability,
but the single-surface host renders **light only** (a multiply shadow needs the
backdrop the GL surface can't read — the same limitation swift documents on iOS).

### Coordinate conventions (match the web)

- `gl_FragCoord` is y-UP (bottom-left origin), like WebGL — pure-shader effects
  reuse the web math directly. `uOrigin` / `uCenter` are device px, y-flipped
  from the (y-down) anchor.
- The hybrid **panel** is drawn in a **y-down, top-left** `Canvas` (identical to
  the web Canvas2D renderer); `GlPanelRunner` pre-flips the Canvas so the uploaded
  texel orientation matches the web's `UNPACK_FLIP_Y_WEBGL`. Path geometry flips
  cleanly; a text effect flips its glyph block back locally (as swift's comic does).

## Porting an effect

Everything for an effect lives in its own `dopamine-effect-<name>` module; no
backbone edits. **heartburst** is the worked reference for a hybrid; a pure-shader
effect is simpler (no panel). The recipe:

1. **Scaffold** `android/dopamine-effect-<name>/` (copy heartburst's
   `build.gradle.kts` + `src/main/AndroidManifest.xml`, change the `namespace` to
   `ai.dopamine.effect.<name>`). `settings.gradle.kts` auto-discovers it.

2. **`.dope`** → `src/main/assets/<name>.dope.json`, copied **byte-identical**
   from `packages/effect-<name>/src/<name>.dope.json`:
   ```bash
   cp packages/effect-<name>/src/<name>.dope.json \
      android/dopamine-effect-<name>/src/main/assets/<name>.dope.json
   ```

3. **Shader** → `<Name>Shader.kt`: a Kotlin string that is the web
   `<name>-shader.ts` source **verbatim**, composing the same `Look.kt` chunks,
   with the **one** change — the final `fragColor = …` becomes
   `fragColor = dopLightOut(col);` (premultiplied light). Keep the vertex as
   `GLSL_FULLSCREEN_VERTEX` (it exposes `vUv`, matching the web).

4. **Tempo** → `<Name>Tempo.kt`: a faithful port of `<name>-tempo.ts` (pure Kotlin
   on the `dopamine-core` primitives `easeOutCubic` / `easeOutBack` / `envelope` /
   `tempoClamp01`).

5. **Panel** (HYBRIDS ONLY — comic) → `<Name>Panel.kt`: port the web
   `<name>-renderer.ts` draw to `android.graphics.Canvas` / `Path` / `Paint`. Use
   `PorterDuff.Mode.ADD` for the additive channel encoding the web does with
   `globalCompositeOperation = "lighter"`. (See `HeartburstPanel.kt`.)

6. **Factory** → `<Name>.kt`: a `class <Name>(context) : DrawableEffect` that
   - loads the `.dope` from assets (`context.assets.open("<name>.dope.json")`),
   - `resolve()` calls `resolveDopeParams(doc, feeling, consts, scatterKey)` with
     the **exact** `consts` + `scatterKey` the web uses (from
     `packages/effect-<name>/src/index.ts`'s `resolveDopeParams(...)` call — e.g.
     solarbloom `{ "MAX_MOTES": 80 }` / `"moteSeed"`; heartburst `{}` /
     `"heartburstSeed"`),
   - `create()` calls `createPassInstance(CONFIG, …)` (pure-shader) or
     `createPanelInstance(CONFIG, …)` (hybrid),
   - defines `CONFIG` (`PassConfig` / `PanelConfig`) mirroring the web `index.ts`
     `CONFIG` **exactly**: the `uniforms` list, the `bindings` map (every web
     `bindings: { x: null }` → `"x" to null`; `{ x: "uY" }` → `"x" to "uY"`),
     `usesOrigin` (true for anchored/radial effects), `shadowHeightFrac`,
     `passUniforms`, and `frame` (mirror swift's `frame()` for the exact extras),
   - exposes `companion object { fun register(context): <Name> { … } }`.

7. **Register.** The `dopamine-effects` umbrella calls `<Name>.register(context)`
   in `Dopamine.registerAll`; the demo picks it up automatically.

**Sanity checks.** `./gradlew :dopamine-core:test` stays green (the spine is
unchanged); `./gradlew assembleDebug` builds the new module; the `android.yml`
jvm job confirms the `.dope` is byte-identical to the web file; the best-effort
emulator job proves the GLSL compiles + runs on a real GL ES driver.

## What is deliberately NOT here

- **No `gen-uniforms` equivalent** — uniforms bind by name (see above).
- **No second shader dialect** — the shaders are the web's GLSL ES 3.00.
- **No multiply shadow pass in the host** — the overlay is light-only (the shader
  `uShadow` branch is kept for contract parity).

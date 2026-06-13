# Roadmap

Forward-looking ideas for the `.dope` format, the shared runtimes, and the
build toolchain. The direction throughout: make every effect **as declarative
as possible** — a portable `.dope` document interpreted identically on every
platform — while keeping per-platform sources a fully supported authoring path
for the genuinely platform-shaped parts.

## Looping — remaining work

`tempo.loop` is now a first-class format/runner feature (see
`docs/effect-format.md` §7.2): the parser validates the seam invariants, the
runners derive the standard `uLoopS`/`uPhase` clocks (+ the `loopS`/`phase`
frame-expr inputs), and the conductors re-arm at `durationMs` with a stop
handle (halo + dots ride it end to end).

- **Idle/visibility economics — LANDED.** The play handle now carries
  drift-free `pause()`/`resume()` on all three conductors, and a perpetual loop
  in a long-lived background view AUTO-PAUSES so it never costs battery:
  - **Web** (`framework/conductor.ts`): a paused effect freezes its timeline
    (the RAF parks when every live effect is paused — no idle churn); `resume()`
    shifts `startedAt` by the paused span so the clock/loop-seam continues
    exactly where it left off. A document-level `visibilitychange` listener
    auto-pauses on a hidden tab and auto-resumes (drift-free) when shown — a
    manual `pause()` survives a hide/show, and a manual `resume()` doesn't defeat
    the idle policy. Gated by `packages/core/test/conductor.test.ts`.
  - **Swift** (`MetalOverlayHost.pause/resume/isPaused`): a paused `tick` holds
    the last frame and spends no GPU; `resume` shifts `startTime`.
  - **Android** (`DopamineView` / `PlayHandle.pause/resume`): paused effects
    freeze and the GL render mode parks (`RENDERMODE_WHEN_DIRTY`);
    `onWindowVisibilityChanged` auto-pauses the perpetual loop off-screen and
    auto-resumes it on return (the `dopamine-gl` module only — `dopamine-core`
    stays pure-JVM). The interactive web demo's **Pause loop** button exercises
    it on a running halo/dots loop.
- **More continuous effects — IN PROGRESS.** `dots` (a calm "thinking" row of
  breathing dots with a pulse traveling across them) is the second continuous
  effect, fully declarative (no `swift/`/`android/` folder): `periodMs = 1000`
  (12 on-twos steps), `durationMs = 4000` (4 periods). A pulsing "recording"
  dot / breathing skeleton placeholder is still open.

## A transpiler for CPU-precomputed per-frame geometry — LANDED

The restricted TypeScript-subset transpiler now exists
(`tools/dopamine/src/logic.mjs`, declared per effect via `x-build.logic`):
lightning's bolt precompute is authored ONCE in
`effects/lightning/web/src/lightning-logic.ts` and the toolchain generates
`LightningRenderer.swift` / `LightningRenderer.kt` from it — gated byte-for-byte
(`tools/dopamine/test/logic.test.mjs`, `golden-logic/`) and numerically by a
committed web-dumped fixture replayed through a generated pure-JVM JUnit test
(dopamine-core's `testGenerated` source set) and a generated XCTest target in
the dist SwiftPM package (Linux-runnable).

The follow-on work landed too — **lightning is now fully declarative** (it
ships NO `swift/` or `android/` folder, like aurora/ripple/inkstroke/halo/fail):

- **Generated shaders.** The GLSL→MSL transpiler grew a buffer-array seam: the
  `.dope` `binding.arrays` section (`docs/effect-format.md` §8.2) declares each
  CPU-precomputed uniform array's web name / vec size / Metal fragment-buffer
  index, and `glslToMSL` turns the declared `uniform vecN uX[…]` arrays into
  `constant floatN *` params threaded through the call graph (snapshot-gated:
  `golden-msl/lightning.metal`, `golden-android/LightningShader.kt`; pixel-gated
  by `scripts/shader-goldens.mjs`, whose uniform capture handles array uniforms).
- **Datafied tempo.** `flashStrobe` + the envelope/strike frame hook fit
  `tempo.frame` exactly (bit-parity pinned by the web/JVM/Swift dope-config
  tests); `strikeProgress` stays in the logic module (the precompute keys off
  it) with the strike extra expressed in frame-expr data.
- **A generated-factory `frameArrays` seam.** `buildFrameArraysSpec`
  (tools/dopamine/src/factory.mjs) wires the transpiled renderer into each
  runner's frameArrays hook from `binding.arrays` — Swift `DopePassConfig` grew
  an optional `frameArrays` closure (same posture as `packExtras`), the Kotlin
  shim passes the lambda `dopePassConfig` already accepted, and the web factory
  is a thin `registerDopeEffect` shim with the one code-shaped
  `hooks.frameArrays` call.

## Extend the declarative path to panel/hybrid effects — LANDED

The panel pipeline is declarative everywhere except the draw itself: the
`.dope` carries `render.panel` (sampler + texture-unit wiring) and
`render.config.stepping: "none"` (the panel-clock semantics), the GLSL→MSL
path handles the panel sampler, and the generated factory shells wire a
hand-written PANEL-DRAW file — the one genuinely code-shaped piece — into the
shared runners (`DopePanelPassConfig` on Swift; the panel-aware `dopePanelConfig`
on web/Android). **heartburst is the prover**: its platform folders contain
exactly one file each (`HeartburstPanel.swift` / `HeartburstPanel.kt`);
factory, tempo, shader and bundle accessor are all generated or data. The three
named follow-ons all landed:

- **comic** — **DONE.** A fully generated panel hybrid: `tempo.frame` +
  `render.panel` + `render.config.stepping: "none"`, single-source GLSL
  (generated MSL/Kotlin), generated factory/bundle/uniforms; it ships exactly
  one hand file per platform (`ComicPanel.swift` / `ComicPanel.kt`). The
  typography/lettering pipeline stays in that panel draw — code by design, not
  forced into data (per the explicit guidance).
- **confetti** — **CONVERGED.** The web was already a Canvas2D panel hybrid;
  the native Swift/Android sides were a full-screen PROCEDURAL GPU pass
  (hand-written Metal/GLSL re-deriving every piece pose per pixel). The piece
  motion was identical across all three, so the divergence was incidental, not
  essential. Converged onto the heartburst path: single-source GLSL (the
  panel-sampling finish shader, generated MSL/Kotlin), datafied
  `tempo.frame.amp` (the launch-then-fall envelope), `render.panel`, the
  MAX_PIECES clamp in `render.consts`, a generated factory/bundle/uniforms, and
  exactly one hand-written panel draw per platform (`ConfettiPanel.swift` /
  `ConfettiPanel.kt`, faithful CoreGraphics / android.graphics ports of the web
  Canvas2D draw). Snapshot-gated in the shader-msl + factory suites; the iOS
  demo wires the generated `Confetti.passConfig()`.
- **solarbloom** — **FULLY CONVERGED** (the PASS-with-sprite-panel prover). The
  two explicit asks landed first — `tempo.frame` (amp = the held-breath
  envelope; `check` = the ~240 ms draw-in on the real clock) retired
  `SolarbloomTempo.{swift,kt}`, and the baked checkmark SDF binds declaratively
  via `binding.samplers[].outline`/`on` (the fail precedent) with the
  box/stroke/range in `render.pass`. The remaining native-runtime
  generalization (below) then landed too, so solarbloom now ships its shader as
  the single canonical web GLSL (generated MSL `Solarbloom.metal` +
  `SolarbloomShader.kt`, sampling the mote panel + the baked-✓ SDF on EVERY
  platform), a GENERATED factory + bundle, and exactly ONE hand file per native
  platform — the mote sprite-panel draw (`SolarbloomPanel.swift` /
  `SolarbloomPanel.kt`, faithful CoreGraphics / android.graphics ports of the
  web `solarbloom-renderer.ts`). The web keeps an OPTIONAL glyph-fallback
  canvas hook the canonical effect never needs (it always ships the baked SDF).
  Snapshot-gated (`golden-msl/solarbloom.metal`,
  `golden-android/SolarbloomShader.kt`, `golden-factory/Solarbloom.{swift,kt}`)
  + the factory suite; the iOS demo wires the generated `Solarbloom.passConfig()`.

### Follow-on: a native sprite-panel + aux-texture seam — LANDED

solarbloom drove the generalization the shared **native** runtimes needed for a
PASS effect (not just a panel-kind one): a dynamic sprite panel bindable at an
ARBITRARY texture unit (not only texture 0) AND baked-SDF aux-texture upload,
together in the SAME pass. It is a GENERAL seam (any future effect can use it),
driven entirely by the `.dope` `render.panel` / `binding.samplers` contract:

- **Web** was already general (`pass-runner.ts` binds the panel at
  `render.panel.texture` and composes the `binding.samplers[].outline`/`on` SDF
  aux at its declared unit) — no change.
- **Swift** (`MetalPassRunner` + `MetalOverlayHost` + `DopeSpritePanelPassConfig`):
  the panel binds at `config.panelTextureUnit`; each baked SDF is decoded
  (`decodeDopeSdf`, the Swift port of `engine/sdf.ts`), uploaded as an `r8Unorm`
  texture, bound at its declared unit, and its `on` extra flipped to 1 — in BOTH
  the light and shadow encoders (the shadow silhouette samples the panel + ✓ too).
- **Android** (`GlPassRunner` + `dopePassConfig(draw=)`): the pass runner gained
  an optional sprite panel (an `android.graphics.Canvas` draw + Bitmap upload at
  `panel.unit`) AND baked-SDF aux (`decodeDopeSdf` in pure-JVM `dopamine-core`,
  uploaded as an R8 GL texture); `derivePassUniforms` now flips a sampler's `on`
  flag to 1 when its SDF actually binds (it pinned them to 0 before).
- The toolchain factory generator (`tools/dopamine/src/factory.mjs`,
  swift.mjs/android.mjs) grew a third panel MODE — `"sprite"` (distinct from the
  panel-kind `"panel"` and the pure `"none"`), keyed off the top-level `kind`:
  it emits `DopeSpritePanelPassConfig` / `dopePassConfig(draw=)` wiring the
  hand-written `draw<Name>Panel`, and relaxes the "panel must be at texture(0)"
  guard (that constraint stays for panel-kind effects only).

## Shared capability modules

Lift the strongest mechanism of each effect into shared, composable modules,
and let other effects adopt them where doing so sharpens (never blurs) their
own metaphor — borrow **capabilities, not looks**:

- a unified parametric GPU **particle** module (emit shape, ballistic/curl
  motion, depth tiers, motion-blur streaks, twinkle, lifetime);
- a **gesture/reveal** primitive (swept-path "draws itself in light" with a
  racing tip) reusable for checkmarks, words, and underlines;
- broader reuse of the **typography/lettering** pipeline (per-letter layout,
  display faces) so any effect can render a word or swap an icon.

## Format ideas

- **Bodymovin/Lottie import for `geometry.outlines`** — the outline encodings
  are already Lottie-shaped; a converter would let designers paste exports
  directly.
- **Effect composition** — a `compose` block (sequence/overlay multiple effect
  ids on a shared clock); reserved in the spec, not yet designed.

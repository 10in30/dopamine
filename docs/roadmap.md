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
handle (halo rides it end to end). Still open:

- **Idle/visibility economics:** the web conductor already skips GPU work on
  hidden tabs and the loop re-arm is drift-free across stalls, but a perpetual
  loop in a long-lived background view (native hosts especially) should get an
  explicit idle/visibility pause so it never costs battery.
- **More continuous effects** (a pulsing "recording" dot, a breathing skeleton
  placeholder) to exercise the contract beyond halo.

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

## Extend the declarative path to panel/hybrid effects — PROVER LANDED; remaining work

The panel pipeline is now declarative everywhere except the draw itself: the
`.dope` carries `render.panel` (sampler + texture-unit wiring) and
`render.config.stepping: "none"` (the panel-clock semantics), the GLSL→MSL
path handles the panel sampler, and the generated factory shells wire a
hand-written PANEL-DRAW file — the one genuinely code-shaped piece — into the
shared runners (`DopePanelPassConfig` on Swift; the panel-aware `dopePassConfig`
on web/Android). **heartburst is the prover**: its platform folders contain
exactly one file each (`HeartburstPanel.swift` / `HeartburstPanel.kt`);
factory, tempo, shader and bundle accessor are all generated or data. Still
open:

- **solarbloom** — datafy its code tempo + aux-texture hooks (the fail
  precedent covers the baked-SDF half; the canvas-rasterized glyph texture
  needs a panel-style seam or stays a hook).
- **confetti** — the web (Canvas2D panel) and Swift (full-screen GPU pass)
  render paths differ ARCHITECTURALLY; converging them on the panel path is a
  redesign decision, not a mechanical migration.
- **comic** — the typography/lettering pipeline is the heaviest code-shaped
  piece; datafy its tempo/config alongside, but don't force the lettering into
  data.

## Transpiler gates: exercise capabilities, not effects

The transpiler gates today pin each effect's **whole transpiled output**
byte-for-byte: `shader-msl.test.mjs` snapshots `golden-msl/<slug>.metal` +
`golden-android/<Name>Shader.kt` for aurora/ripple/inkstroke/halo/fail/
lightning/heartburst/comic, and `logic.test.mjs` snapshots
`golden-logic/LightningRenderer.{swift,kt}` (+ the parity-test shells). The
golden lives in the wrong place: it is keyed to a specific effect's evolving
look, so **retuning aurora's shader — a look change with zero transpiler
impact — still forces a `golden-msl/aurora.metal` regen**, and the reviewable
diff is dominated by look noise instead of transpiler behaviour. The snapshots
also overlap heavily (every `vecN→floatN`, every 2-arg `atan→atan2` is
re-asserted in eight files), and a genuine transpiler regression can hide
inside a large effect diff.

Move the gate to the transpiler's **capabilities**, each pinned by a minimal
synthetic fixture that exercises exactly one rule and changes only when that
rule's contract changes — independent of any effect's look. This generalizes
the pattern `logic.test.mjs` already uses for its `REJECTS` table and the
"JS numeric semantics" test (small inline sources, not lightning's full
output). Concretely:

- **A GLSL→MSL capability suite.** One tiny fragment per transpiler rule, each
  asserting the focused output token(s): `vecN→floatN`, `matN(scalars)`→
  column-grouped `floatNxN`, 2-arg `atan→atan2`, `radians()` inlining, the
  per-name-uniform → `constant <Name>Uniforms &u` rewrite **and the
  `u`-injection fixpoint** (a uniform-reading helper deep in the call graph; a
  GLSL param named `u` renamed `uu`), `paletteMix→dop_paletteMix` + the three
  stops, `out T`→`thread T &`, the texture-sampler rewrite (`texture(uX,uv)`→
  `<name>.sample(texSampler,uv)` + the `needsTex` fixpoint), the panel sampler
  at `texture(0)` + the y-up `vUv` reconstruction (today only covered via
  heartburst/comic), and the `binding.arrays` buffer-array seam (`uniform vecN
  uX[…]`→`constant floatN *` at the declared index). The existing throw-path
  probes (the `uCenter`→`uOrigin` unbindable-uniform guard; the
  declared-array-not-flagged case; the array-contract size/missing-entry
  throws) already follow this shape and stay.
- **An Android-emit capability suite.** The few rules that differ from the web
  GLSL — `${GLSL_*}` look-chunk refs kept verbatim, consts resolved, the
  `+ ${GLSL_LIGHT_OUT}` / `dopLightOut(col)` premultiplied emit — pinned on a
  synthetic shader, not on eight `<Name>Shader.kt`.
- **logic.mjs:** keep the `REJECTS` table + numeric-semantics tests; add
  positive capability fixtures (canonical `for`, `Math.*` whitelist, typed-array
  WRITES, the bundle-return contract, the generated parity-shell shape) so the
  one remaining effect-keyed golden (`LightningRenderer.*`) can retire.

**What still guards real effects after the move:** byte-identity to a
hand-port is no longer the contract (those hand-ports are long deleted), so
nothing is lost by dropping the per-effect snapshots. Each effect's transpiled
output is still **compiled and run**: the macOS Metal compile + the
`scripts/shader-goldens.mjs` pixel gate (web vs Android-derived GLSL, RGB Δ0)
for shaders, and the committed web-dumped parity fixtures replayed through the
generated Swift/Kotlin (`swift test` / pure-JVM `:dopamine-core:test`) for
logic. Those are the behavioural oracles; the capability suite replaces the
byte-snapshot's *transpiler-correctness* role without coupling it to a look.

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

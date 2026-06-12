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

## A transpiler for CPU-precomputed per-frame geometry — LANDED; remaining work

The restricted TypeScript-subset transpiler now exists
(`tools/dopamine/src/logic.mjs`, declared per effect via `x-build.logic`):
lightning's bolt precompute is authored ONCE in
`effects/lightning/web/src/lightning-logic.ts` and the toolchain generates
`LightningRenderer.swift` / `LightningRenderer.kt` from it — gated byte-for-byte
(`tools/dopamine/test/logic.test.mjs`, `golden-logic/`) and numerically by a
committed web-dumped fixture replayed through a generated pure-JVM JUnit test
(dopamine-core's `testGenerated` source set) and a generated XCTest target in
the dist SwiftPM package (Linux-runnable). Still open:

- **Generate lightning's shaders too.** The hand `.metal` reads the polyline
  from `constant float2 *uVerts [[buffer(1)]]` while the web GLSL uses uniform
  arrays, so `x-build.shader.generateMSL` needs a buffer-array seam in the
  GLSL→MSL transpiler (see the PENDING note in
  `tools/dopamine/test/shader-msl.test.mjs`) before lightning's `.metal`/`.kt`
  shaders can be generated.
- **Datafy lightning's remaining tempo** (`flashStrobe` is ~10 lines — likely
  fits `tempo.frame`) and grow a generated-factory `frameArrays` seam so
  lightning can drop its platform folders entirely.

## Extend the declarative path to panel/hybrid effects

Effects that render through an offscreen panel or multiple passes (offscreen
render targets, Canvas2D panel textures) author their shaders and panel draws
per platform. Candidate work: multi-pass / aux-texture support in the shader
generation path, and a declarative vocabulary for the panel pipeline, so more
of the hybrid class can ride the data path.

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

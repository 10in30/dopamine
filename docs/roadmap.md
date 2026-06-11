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

## A transpiler for CPU-precomputed per-frame geometry

Effects that precompute per-frame geometry on the CPU — e.g. lightning's bolt
vertex array, fed to the shader as a vertex buffer — author that logic per
platform today, and their shaders can't be generated until the logic is
portable. A restricted TypeScript-subset transpiler (`<name>.logic.ts` →
Swift + Kotlin, the same posture as the scoped GLSL→MSL shader transpiler)
would let that logic be authored once. This is the largest and most niche
single-source gap.

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

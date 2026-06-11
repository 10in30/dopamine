# Roadmap

Forward-looking ideas for the `.dope` format, the shared runtimes, and the
build toolchain. The direction throughout: make every effect **as declarative
as possible** — a portable `.dope` document interpreted identically on every
platform — while keeping per-platform sources a fully supported authoring path
for the genuinely platform-shaped parts.

## Looping as a first-class format/runner feature

Continuous effects (a calm "loading" ring like halo, a pulsing "recording"
dot, a breathing skeleton placeholder) currently build their loop by hand:
drive all motion off `uTimeS`, pick a period that tiles both `durationMs` and
the 12 Hz animate-on-twos grid (so the seam survives at every whimsy), and
supply a steady periodic `amp` instead of `envelope(life)`. Each of those
choices is general math, not per-effect logic, so it belongs in the format and
the runners:

- **Format:** an optional `tempo.loop` block — `periodMs` (required) +
  `snapAligned` (default true). `parseDope()` validates that `periodMs` is an
  integer multiple of the on-twos step (`NPR_TIME_STEP_MS`) and that
  `durationMs` is a whole number of periods, so the seam guarantee moves from
  convention into the parser. A schema'd contract also gives hosts a
  machine-readable way to know an effect loops and what its period is.
- **Runners:** standard seamless periodic clock uniforms — `uLoopS`
  (seconds within the current loop) and `uPhase` (normalized phase in
  `[0, 1)`) — computed once in the shared pass-runner layer so all platforms
  get them from one place. Shaders then use `sin(TAU * uPhase)` for a breathe
  and `uPhase` for a sweep, with no per-effect period plumbing.
- **Conductor:** for a looping effect, re-arm at `durationMs` instead of
  tearing down; the host stops it via a returned handle / `dispose()`. The
  reduced-motion fallback renders ONE calm phase and holds (never loops);
  background-tab pausing and an idle/visibility stop keep a perpetual loop
  from costing battery.

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

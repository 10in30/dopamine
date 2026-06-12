# Dopamine docs — start here

Dopamine effects are **data**: one portable `.dope` document per effect,
interpreted identically by the web (WebGL2), Swift (Metal) and Android
(OpenGL ES) runtimes. Most authoring work is writing that document plus one
GLSL shader — the toolchain generates everything else.

This index routes you to the **smallest read** for your task. Sizes are
approximate, so you can budget a context window.

## Pick your task

| Task | Read | Size |
|---|---|---|
| **Author a new effect** (the common case: fully declarative pure-shader) | [`authoring-quickstart.md`](./authoring-quickstart.md) — complete and self-sufficient | ~3k tokens |
| Extend an existing effect (new param / mood / timing tweak) | The effect's own `<name>.dope.json` + quickstart §2 for the block you're touching; grammar in [`effect-format.md`](./effect-format.md) §4.1/§7.1 | ~2–4k |
| A continuous / looping effect (loading ring, pulse) | quickstart, then `effect-format.md` §7.2 (`tempo.loop`) + `effects/halo` | +1k |
| An SDF icon (✗/✓ glyph) + per-pass uniforms | `effect-format.md` §8.2 (`render.pass`, sampler `outline`/`on`) + `effects/fail` | +2k |
| A Canvas2D-hybrid (sprite panel, lettering, word art) | [`authoring-effects.md`](./authoring-effects.md) §2, §6 + `effects/comic` (typography) or `effects/heartburst` (sprites) | ~5k |
| Custom moods beyond serene/celebratory/electric | `authoring-effects.md` §7.1 + `effects/fail/web/src/index.ts` | ~1k |
| Code-shaped escape hatches (hooks, custom `frame()`, frame arrays) | `authoring-effects.md` §4 + `effects/lightning` (CPU geometry), `effects/solarbloom` (aux textures) | ~3k |
| Host integration (play an effect in an app; load/override a `.dope`) | root [`README.md`](../README.md) quick starts + `effect-format.md` §9/§11 (`loadEffect`) | ~3k |
| The full format spec + design rationale | `effect-format.md` (spec) + [`effect-format.schema.json`](./effect-format.schema.json) (JSON Schema) | ~11k |
| The deep web architecture (conductor, runners, registries) | `authoring-effects.md` §1–§4 | ~5k |
| Swift / Android internals | [`../swift/README.md`](../swift/README.md), [`../android/README.md`](../android/README.md) | ~1k / ~3k |
| Toolchain + repo conventions, CI gates | [`../CLAUDE.md`](../CLAUDE.md) | ~5k |
| What's planned next | [`roadmap.md`](./roadmap.md) | <1k |

## Reference effects (copy, don't invent)

Every archetype has a live, tested reference. Copy the nearest one and adapt:

| Archetype | Effect | Demonstrates |
|---|---|---|
| Pure-shader, fully declarative (NO platform code) | `effects/ripple` | the minimal complete `.dope` + shader |
| Continuous / seamlessly looping | `effects/halo` | `tempo.loop`, the `uPhase`/`uLoopS` clocks, periodic amp |
| Declarative SDF icon + per-pass uniforms + own moods | `effects/fail` | sampler `outline`/`on` source, `render.pass`, `registerMood` |
| Whole-sky composition (no origin anchor) | `effects/aurora` | `usesOrigin: false`, clamp consts |
| Drawn-gesture reveal | `effects/inkstroke` | a per-frame `draw` extra on the real clock |
| Pass effect + baked SDF + glyph + code hooks | `effects/solarbloom` | aux textures, canvas-dependent hooks, code tempo |
| Canvas2D-hybrid with typography + fonts | `effects/comic` | panel `draw()`, content/typography tables, bundled faces |
| Canvas2D-hybrid sprite layer | `effects/heartburst` / `effects/confetti` | panel sprites over a shader finish |
| CPU-precomputed per-frame geometry | `effects/lightning` | `frameArrays` uniform arrays |

## The verification loop

Whatever you change, this loop tells you immediately if it's right:

```bash
node tools/dopamine/src/cli.mjs build    # regen + sync; fails loudly on .dope/shader errors
npm test                                 # vitest across every package (incl. toolchain goldens)
npm run dev                              # look at it in the interactive demo
node tools/dopamine/src/cli.mjs build --check   # CI's staleness gate
```

Cross-platform correctness is gated, not trusted: a pinned
`mood × intensity × whimsy × seed` must resolve byte-identically everywhere
(the Swift/Android parity grids), generated MSL/Kotlin shaders and factory
shells are golden-snapshotted, and a SwiftShader gate renders the web and
Android shader dialects against each other pixel-for-pixel.

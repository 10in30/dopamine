# RFC: Simplifying cross-platform effects — first-class looping + one shader source

Status: DRAFT / RFC. Date: 2026-06-09.
Scope: two concrete refinements to how Dopamine effects are built across the
three stacks (web / Swift+Metal / Android+GL ES), grounded in the friction of
shipping the **tenth** effect — `halo`, the first *continuous / looping* effect —
to all three at once.

> Companion docs: the format spec is [`effect-format.md`](./effect-format.md);
> the build how-to is [`authoring-effects.md`](./authoring-effects.md). This RFC
> proposes changes to BOTH (the format gains a `tempo.loop`; the build gains a
> single-source shader path).

---

## 0. TL;DR

Shipping `halo` exposed two specific costs that every future effect will keep
paying:

1. **The one-shot `envelope(life)` assumption is baked into the runners, so a
   *looping* effect has to fake its loop.** Halo wanted to run forever; the
   conductor instead clamps to `durationMs` and tears the effect down
   (`conductor.ts:186–191`). Halo had to (a) drive every animation off `uTimeS`
   with hand-tuned periods, (b) hand-pick `durationMs = 6000` as an exact integer
   multiple of a 1.5 s period *and* of the 83.3 ms "animate-on-twos" grid so the
   seam survives, and (c) replace `amp = envelope(life)` with a bespoke steady
   `haloBreathe`. None of that is reusable; the next looping effect re-derives it.
   **Proposal A (primary): a `tempo.loop` flag + a periodic clock the runners
   provide, so a looping effect declares "I loop, period = P" and gets a seamless
   `uPhase`/`uLoopS` for free — no bespoke loop math, no magic duration.**

2. **The fragment shader is authored ~2.3×.** Web GLSL and Android GLSL are the
   *same language* (GLSL ES 3.00) and `halo`'s differ by exactly one line
   (`fragColor`), yet they live in two hand-kept-in-sync files. Swift is a full
   hand-port to MSL. **Proposal B (secondary): one shared GLSL source per effect
   that web + Android consume directly, with a documented (and CI-gated) GLSL→MSL
   transform for Swift.**

A. is self-contained and high-leverage (it makes a whole *class* of effects
tractable) and should land first. B. is a larger refactor of an existing seam;
it is specced here but staged behind A.

We also note **Proposal C** (datafy the bespoke tempo into the `.dope`), already
flagged in code as "report (b)" (`MetalPassRunner.swift:86`), as related future
work that A. partially subsumes.

---

## 1. Problem: the runners assume a one-shot reward MOMENT

### 1.1 What the nine reward effects share

Every effect before `halo` is a one-shot: it plays once, `0 → peak → 0`, then
stops. That shape is encoded in three places that all three stacks share:

- The canonical amplitude is `envelope(t)` — `envelope(0) === 0`,
  `envelope(1) === 0`, peak in the first ~18% (`tempo.ts:45`). It is *designed*
  not to loop.
- The runner derives `life = clamp(animMs / durationMs, 0, 1)` and hands it to
  `frame()` (`pass-runner.ts:324`; Swift `MetalPassRunner.swift:322`; Android
  `GlPassRunner.kt:135`), and the conductor **ends the effect at `durationMs`**
  (`conductor.ts:187–191`).
- `frame()` returns `amp` from `envelope(life)` — see every effect, e.g.
  `effect-ripple/src/index.ts:75–77`.

For a *reward*, this is exactly right. For a *loader*, it is wrong in every part.

### 1.2 What `halo` had to do instead (the friction, concretely)

`halo` is a calm ring that should breathe and sweep **indefinitely**. To get a
seamless loop out of one-shot machinery, it had to do all of the following BY
HAND (see `effect-halo/src/{halo-shader.ts,index.ts,halo-tempo.ts}` and their
Swift/Android mirrors):

1. **Drive all motion off `uTimeS`, never `uLife`.** Fine in principle, but the
   author has to *know* that `uLife` is a non-looping ramp and avoid it — nothing
   enforces or documents this. (`halo-shader.ts` reads `uTimeS` everywhere and
   carries a comment that `uLife` is deliberately UNUSED.)

2. **Make every periodic function share one period and that period tile the
   duration.** Halo picks `period = 1.5 s`, then must choose `durationMs` so that
   `durationMs / 1000` is an integer number of periods. It chose `6000`
   (4 periods).

3. **Defeat the "animate-on-twos" snap at the seam.** The pass-runner snaps the
   clock toward a `NPR_TIME_STEP_MS = 1000/12 ≈ 83.3 ms` grid as `style` rises
   (`pass-runner.ts:321–323`). A snapped clock is only periodic if the period is
   an integer number of steps. `1.5 s = 18 steps` *exactly* — but the author had
   to discover and verify that (the `halo` test asserts `periodMs / NPR_TIME_STEP_MS
   === 18` precisely so a future edit can't silently break the seam). Pick
   `period = 1.4 s` instead and the loop tears at high whimsy, with nothing to
   warn you.

4. **Replace `envelope(life)` with a steady periodic `amp`.** Halo invents
   `haloBreathe(timeS, period) = 0.85 + 0.15·sin(2π·timeS/period)` and ports that
   one line to Swift (`Halo.swift`) and Kotlin (`HaloTempo.kt`). It is trivial —
   but it is per-effect, per-platform, and easy to get subtly wrong (an attack
   ramp, a non-periodic `amp`, anything reading `life`, breaks the loop).

5. **Document the loop contract in prose.** Because the format has no notion of
   looping, `halo.dope.json`'s `meta.description` carries a paragraph explaining
   that `durationMs` is 4 periods, the host must re-fire, etc. A host integrating
   it has no machine-readable way to know it loops or what the period is — they
   read English (`meta.loopPeriodMs` is a bespoke, non-standard key we invented).

Every one of these is a tax the **next** continuous effect (a pulsing "recording"
dot, a breathing skeleton placeholder, an idle shimmer) pays again from scratch,
and each is a chance to ship a visible seam.

### 1.3 Why this is a generalization-boundary issue, not an effect issue

The repo's mandate (CLAUDE.md) is: *only* the shader, the bespoke tempo, and the
uniform config are per-effect; everything general lives in the backbone. "How a
periodic effect gets a seamless clock" is **general** — it is the same math for
every looping effect — yet today it lives in each effect as copy-pasted prose and
hand-tuned constants. That is the smell the mandate warns about.

---

## 2. Proposal A (primary): first-class continuous / looping effects

Make looping a property of the EFFECT (declared in the `.dope`) and a service of
the RUNNER (a seamless periodic clock), so a looping effect needs no bespoke
"fake the loop" code.

### 2.1 Format: `tempo.loop`

Add an optional block to `tempo`:

```jsonc
"tempo": {
  "durationMs": { "from": { "baseline": "durationMs" } },
  "loop": {
    "periodMs": 1500,        // the loop period; REQUIRED when present
    "snapAligned": true      // default true: assert periodMs is an integer # of
                             // NPR_TIME_STEP_MS steps so the on-twos seam holds
  }
}
```

Semantics:

- `tempo.loop` present ⇒ the effect is **continuous**. `durationMs` becomes the
  *minimum* a single fire runs; the runner extends it to the next whole period
  and the conductor **re-arms** instead of tearing down (see 2.3). A host can
  still cap total runtime, but it never sees a seam.
- `parseDope()` validates: `periodMs > 0`; and when `snapAligned` (the default),
  that `periodMs` is an integer multiple of `NPR_TIME_STEP_MS` (1000/12) — the
  check `halo` had to write by hand in its test, now enforced for ALL looping
  effects at parse time. It also validates `durationMs % periodMs === 0` (or
  rounds it, see 2.3) so the seam is exact.

This replaces `halo`'s bespoke `meta.loopPeriodMs` / `meta.loops` keys with a
real, schema'd contract a host can read.

### 2.2 Runner: a seamless periodic clock

The runner already computes `animMs` (the on-twos-snapped clock). When
`tempo.loop` is set it additionally provides two standard uniforms, computed once
and bound by the shared `pass-common` code (so all three stacks get them from one
place):

| Uniform | Meaning |
|---|---|
| `uLoopS` | `mod(animMs/1000, periodMs/1000)` — seconds within the current loop, in `[0, period)` |
| `uPhase` | `uLoopS / (periodMs/1000)` — normalized phase in `[0, 1)` |

Both are, by construction, periodic and seam-exact (the `mod` makes the value at
the loop boundary identical to `0`, independent of the snap, because the snap
grid tiles the period). An effect's shader then uses `sin(TAU * uPhase)` for a
breathe, `uPhase` for a sweep, etc. — and *cannot* accidentally read a
non-looping ramp, because for a looping effect the runner can leave `uLife` at a
fixed sentinel (or, better, also make `uLife` itself loop = `uPhase`).

Implementation surface (small, and in the SHARED layer, not per effect):

- web: extend `STANDARD_COMMON` (`pass-common.ts:150`) with `uLoopS`/`uPhase`,
  set them next to `uTimeS` in `pass-runner.ts:304`.
- Swift: add two fields to `StandardUniforms` (`MetalPassRunner.swift:48`) — they
  then flow through the *generated* packer automatically (gen-uniforms emits the
  standard half from `STANDARD`, so adding two standard fields is a one-line
  manifest change, not per-effect work).
- Android: set them by name in `GlPassRunner.kt:113` (GL ES binds by name, so no
  struct change).

### 2.3 Conductor: re-arm instead of tear down

Today `conductor.ts:187` deletes + disposes the effect at `durationMs`. For a
looping effect, instead:

```ts
if (fx.loops) {
  // keep rendering; never resolve()/dispose() until the host stops it.
  fx.renderAt(elapsed);            // elapsed grows unbounded; uLoopS wraps it
} else if (elapsed >= fx.durationMs) {
  host.active.delete(fx); fx.dispose(); fx.resolve();
}
```

The instance stays warm and the RAF loop keeps running while it is active; the
public API gains `stop(handle)` (or the existing `prepare()` renderer's
`dispose()`) to end it. `play()` for a looping effect resolves immediately (it
has no natural end) or returns a handle. Swift's `MetalOverlayHost` and Android's
`DopamineView` already have a `prepare()/play()` split and a frame clock that
grows unbounded, so the change there is "don't auto-stop at duration".

Because `uLoopS` wraps `elapsed`, the *unbounded* clock is fine — there is no
accumulation error within a period, and re-firing is no longer required for a
seam (it is still supported and still seamless).

### 2.4 What A. simplifies (the `halo` diff, hypothetically)

With A. in place, `halo` collapses to:

- `.dope`: add `"loop": { "periodMs": 1500 }`; delete the bespoke `meta.loopPeriodMs`
  / `meta.loops` keys and the explanatory paragraph; `durationMs` becomes
  optional (the runner derives it).
- shader: `sin(TAU * uPhase)` instead of `sin(TAU * uTimeS / uPeriod)`; drop the
  `uPeriod` uniform entirely (the period is the runner's business now).
- `index.ts` / `Halo.swift` / `HaloTempo.kt`: **delete `haloBreathe`** — `frame()`
  returns a constant `amp = 1.0` (the breathe is `uPhase`-driven in the shader), or
  the runner supplies a default steady `amp` for looping effects so `frame()` can
  be omitted.
- the test's hand-rolled "is the period 18 steps?" assertion is replaced by the
  parser's `snapAligned` validation (still tested, but once, in core).

Net: roughly **40–60 lines of bespoke, thrice-mirrored loop code and prose
deleted**, and the seam guarantee moves from "the author remembered to verify it"
to "the format enforces it." The next looping effect writes a shader and a
`periodMs` and gets a seam for free.

### 2.5 Trade-offs / risks (A)

- **Conductor lifecycle.** A never-ending effect must be stoppable, or it leaks a
  warm GL context + RAF. Mitigation: the looping path REQUIRES a returned handle /
  `dispose()`; `play()` (fire-and-forget) is disallowed (or auto-caps) for
  looping effects. This is a real API addition, but a small one.
- **Reduced motion.** A loader that animates forever is exactly what
  `prefers-reduced-motion` users dislike. Mitigation: for looping effects the
  reduced-motion fallback should render ONE calm phase and hold (not loop) —
  `halo` already sets `reducedMotion: { peakMs: 0, holdMs: 600 }` toward this;
  the conductor's reduced-motion branch should honor "don't re-arm."
- **Background tabs / battery.** A perpetual RAF is costly. The conductor already
  pauses hidden tabs; for looping effects it must also expose an idle/visibility
  stop. Low risk (the plumbing exists), but must be wired.
- **Scope creep.** `tempo.loop` is a new format surface (a v1.x additive field —
  old loaders ignore it, consistent with the format's extension rules). Keeping it
  to `periodMs` + `snapAligned` avoids a general timeline.

---

## 3. Proposal B (secondary): one shared GLSL source per effect

### 3.1 The duplication, measured on `halo`

`halo`'s fragment shader exists as:

- `packages/effect-halo/src/halo-shader.ts` — GLSL ES 3.00, ends `fragColor =
  vec4(max(col,0.0), 1.0)`.
- `android/dopamine-effect-halo/src/main/kotlin/.../HaloShader.kt` — the SAME
  GLSL ES 3.00, ending `fragColor = dopLightOut(col)` — **the only difference is
  that one line** (Android's self-contained overlay wants premultiplied light;
  see `Look.kt`'s `GLSL_LIGHT_OUT`).
- `swift/Sources/DopamineEffectHalo/Shaders/Halo.metal` — a hand-port to MSL
  (`vec3`→`float3`, `mat2`→`float2x2` columns, `atan`→`atan2`, the y-flip, the
  premultiplied return, `dop_`-prefixed look calls).

So the web and Android copies are ~99% identical text kept in sync by hand, and
the Swift copy is a hand-translation. The Android README already calls this out:
the shaders are "the web's GLSL near-verbatim," and the Metal port "had to copy
`DopamineLook.metal` into every package." Every shader edit is a 2–3× edit with a
silent-drift risk; only `swift.yml`'s gen-uniforms gate catches *uniform* drift,
nothing catches *body* drift.

### 3.2 The change

**One canonical GLSL source per effect, consumed directly by web + Android, and
transformed to MSL for Swift by a script.**

- Author `packages/effect-<name>/src/<name>.frag.glsl` (the body, composing the
  shared `look/` chunks as today). Web imports it as a string (Vite `?raw` or the
  existing chunk-concatenation). Android reads the SAME file — the build copies it
  into the effect module's resources (the `.dope` is already copied verbatim; this
  is the same move for the shader), and the final-emit difference is handled by a
  **two-line tail convention**: the shared source ends at `vec3 col = …; ` and a
  per-stack epilogue appends either `fragColor = vec4(col,1.0);` (web) or
  `fragColor = dopLightOut(col);` (Android). (Solarbloom shows this is feasible —
  its web shader already emits the premultiplied form, so the tail can be unified.)
- For Swift, extend the existing codegen story. We already generate the uniform
  struct from data (`gen-uniforms.mjs`); add `gen-shaders` (or fold into it) that
  runs the canonical GLSL through a **scoped GLSL→MSL transform** — the
  divergences are small, finite, and already enumerated in
  `DopamineLook.metal`'s header (types, `mat2` column order, `texture()` →
  `.sample()`, the y-flip, the premultiplied return). It is NOT a general
  transpiler; it is a mechanical rewrite of the subset Dopamine shaders use, gated
  by `swift.yml` the same way uniforms are (regenerate + `git diff --exit-code`).

### 3.3 What B. simplifies

- One shader edit instead of 2–3; drift becomes impossible between web and
  Android (same bytes) and CI-gated for Swift (regenerated, not hand-kept).
- New effects author GLSL once. The Android port step "copy the shader, change the
  final emit" (README §3) disappears; the Swift "rewrite to MSL" step becomes
  "run gen-shaders."

### 3.4 Trade-offs / risks (B)

- **A GLSL→MSL transform is real work and a real maintenance surface.** This is
  the big one. Mitigation: keep it scoped to the documented subset; fail loudly on
  anything outside it (so an effect that uses an un-handled construct gets a build
  error, not wrong pixels); gate it in CI. Start by transforming the *simplest*
  pure-shader effect (aurora) and prove byte-for-byte-equivalent output against
  the existing hand-port before migrating the rest.
- **The look chunks already diverge intentionally** (`GLSL_*` strings vs
  `DopamineLook.metal`'s `dop_*` functions). B. would want the look library itself
  generated from one source too — larger scope. Could be staged (effect bodies
  first, shared chunks later).
- **Tooling weight.** Web no longer just `import`s a `.ts` string; it reads a
  `.glsl`. Minor (Vite handles `?raw`), but it touches the build.
- **Lower urgency than A.** B. removes duplication that EXISTS and is annoying;
  A. unblocks effects that are currently impractical. Ship A. first.

---

## 4. Proposal C (noted, not specced): datafy the bespoke tempo

The third per-effect seam is the bespoke tempo (`<name>-tempo.ts` +
`<Name>Tempo.swift` + `<Name>Tempo.kt`) — the same envelope re-coded three times.
`MetalPassRunner.swift:86` already flags datafying the uniform binding ("report
(b)"); the analogous idea for tempo is to express the envelope as a `.dope`
curve (the format already reuses Lottie's keyframe `{t,s,e,i,o,h}` shape — see
`effect-format.md` §2) the runners evaluate, instead of code.

**Proposal A subsumes the most painful slice of this** — the *looping* tempo,
which is pure periodic math the runner can own outright. The remaining bespoke
tempos (comic's slam, fail's stamp/shake) are genuinely shaped and lower-value to
datafy; we defer C. and let A. handle the looping case it overlaps.

---

## 5. Recommendation & sequencing

1. **Land Proposal A.** Self-contained, unblocks a class of effects, deletes
   `halo`'s fake-loop code, moves the seam guarantee into the parser. Touches the
   format (`tempo.loop`), the shared `pass-common` clock, and the conductor
   lifecycle — all small, all in the backbone where the mandate wants them.
2. **Then evaluate Proposal B** behind a one-effect proof (aurora) before
   committing to the GLSL→MSL transform for all ten.
3. **Defer Proposal C**; revisit only the non-looping bespoke tempos if they keep
   causing drift.

### Appendix: files referenced

- `packages/core/src/engine/tempo.ts` — `NPR_TIME_STEP_MS` (`:18`), `envelope` (`:45`).
- `packages/core/src/framework/pass-runner.ts` — `uTimeS` bind (`:304`), on-twos snap + `life` (`:321–324`).
- `packages/core/src/framework/pass-common.ts` — `STANDARD_COMMON` (`:150`).
- `packages/core/src/framework/conductor.ts` — end-at-duration tear-down (`:186–191`).
- `swift/Sources/DopamineCore/MetalPassRunner.swift` — `StandardUniforms` (`:48`), `timeS` (`:262`), snap (`:320–322`), the "datafy this" note (`:86`).
- `android/dopamine-gl/src/main/kotlin/ai/dopamine/gl/GlPassRunner.kt` — `uTimeS` (`:113`), `steppedAnimMs` (`:134`).
- `packages/effect-halo/src/{halo.dope.json,halo-shader.ts,halo-tempo.ts,index.ts}` and mirrors in `swift/Sources/DopamineEffectHalo/` + `android/dopamine-effect-halo/` — the worked-but-bespoke looping effect this RFC would simplify.

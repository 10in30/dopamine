# Single-source effects — status & roadmap

Status: LIVE. Date: 2026-06-11. Branch: `claude/effects-consolidation-slomo-fix-snj1gb` (PR #25).

This tracks the "write-once effect authoring" work: making the **web sources the single
source** the other platforms are generated from, so an effect isn't re-implemented three
times. It implements the single-source shader path proposed in
[`cross-platform-effects-rfc.md`](./cross-platform-effects-rfc.md) (Proposals B/C) and sets
up the remaining "logic" half. Read this with the **"Single-source shaders"** and
**"Uniform binding"** sections of `CLAUDE.md` (the authoritative architecture reference).

---

## DONE — single-source SHADERS (shipped on PR #25)

The web GLSL ES 3.00 (`effects/<name>/web/src/<name>-shader.ts`) is the only hand-written
shader. When the `.dope` has an `x-build.shader` block
(`{ web, vertexExport, fragmentExport, generateMSL }`), `dopamine build` **generates** the
MSL `.metal` and the Android `<Name>Shader.kt` from it — the hand-ports are deleted.

**Migrated (5):** aurora, ripple, inkstroke, halo, fail.

**Key files:**
- `tools/dopamine/src/shader.mjs` — the scoped GLSL→MSL transpiler.
- `tools/dopamine/src/android-shader.mjs` — the Android `.kt` emitter (keeps `${GLSL_*}`
  chunk refs → look stays in `Look.kt` once; appends `${GLSL_LIGHT_OUT}` + `dopLightOut`).
- `tools/dopamine/src/glsl-load.mjs` — esbuild-bundles the web `.ts` to resolve the GLSL
  (esbuild is a declared devDep; swift.yml/android.yml `npm ci --ignore-scripts` before build).
- `tools/dopamine/src/swift.mjs`, `android.mjs` — wire generation into the package emitters.

**Transpiler covers:** `vecN→floatN`; `matN(scalars)`→column-grouped `floatNxN`; 2-arg
`atan`→`atan2`; per-name uniforms → one `constant <Name>Uniforms &u` struct (a `needsU`
fixpoint threads it through the call graph; a GLSL param named `u` → `uu`); `paletteMix`→
`dop_paletteMix` + the 3 stops; `out T`→`thread T &`; texture samplers (from
`binding.samplers` as `{web,name,texture}` objects) → `texture2d<float> <name> [[texture(n)]]`
+ one shared `sampler texSampler [[sampler(0)]]` (texture(0) = the panel slot; a `needsTex`
fixpoint threads them) with `texture(uX,uv)`→`<name>.sample(texSampler,uv)`; `main()`→ the
`<slug>_vertex`/`_fragment` entries with the y-flip preamble + the premultiplied light-out tail
(handles both `vec4(max(col,0),1)` and `vec4(col,1)`). It THROWS on anything outside the subset.

**Gates:**
- `tools/dopamine/test/shader-msl.test.mjs` — byte-for-byte snapshots of the generated MSL +
  Android `.kt` (`golden-msl/*.metal`, `golden-android/*Shader.kt`). Edit the web GLSL + rebuild;
  never hand-edit a snapshot/generated file.
- `scripts/shader-goldens.mjs` (in `web-reel.yml`) — golden **mid-frame** gate: renders the literal
  web AND the Android-derived GLSL through headless Chromium/SwiftShader (WebGL2 == the Android
  GLSL ES 3.00 dialect) and asserts web↔Android RGB Δ0 vs `e2e/goldens/*.png`. Covers the
  pure-shader effects; textured/panel effects rely on CI's macOS sim + android emulator.
- CI: `swift.yml` macOS compiles the generated MSL; `android.yml` build compiles the `.kt`.

**NOT migrated (stay hand-written):**
- **solarbloom, confetti** — multi-pass **panel** effects (offscreen render targets:
  solarbloom's `uMotePanel` + check-glyph + SDF; confetti's `uPanel`). Same class as the
  comic/heartburst hybrids → out of scope for the shader transpiler.
- **lightning** — its MSL takes a `constant float2 *verts [[buffer]]` (a CPU-precomputed bolt
  vertex array). Needs the logic path (P3) before its shader can be generated.

---

## TODO — P2: datafy the LOGIC hooks (the next pillar)

Goal: move each effect's per-frame `frame()` + `shadowHeightFrac` + consts out of the
hand-written per-platform factories into the `.dope`, evaluated by a generic data-driven
factory in each backbone — so the *logic*, like the shader, is authored once.

> **Recommend a SEPARATE PR/branch:** this touches the **runtime render path** on all three
> stacks (not the build/shader pipeline), so it's a different review surface.

**Inputs (read these — the hooks to datafy):** each migrated effect's web factory
`effects/<name>/web/src/index.ts` — the `CONFIG.frame`, `CONFIG.shadowHeightFrac`,
`CONFIG.bindings`, `consts`, and any module constants (e.g. aurora's `SWEEP_SPEED = 0.02`).
Example (aurora): `shadowHeightFrac = params.bandHeight * 0.6`;
`frame = ({animMs,life}, p) => ({ amp: envelope(life, p.overshoot), uSweep: 0.02*(animMs/1000)*(1 - 0.5*life) })`.

**Design:**
1. **Extend the `.dope` expression grammar** (the mood→params grammar lives in
   `packages/core/src/framework/loader.ts`) with a per-frame evaluation context: inputs
   `animMs`, `life`, `param.<name>`, `const.<name>`; ops it lacks (`sin`, `mod`, `min`/`max`,
   and the tempo primitives `envelope`/`easeOutBack` from `packages/core/src/engine/tempo.ts`).
2. **New `.dope` sections:** `tempo.frame = { amp: <expr>, extras: { uSweep: <expr>, … } }` and
   `render.shadowHeightFrac = <expr>`, plus `render.consts` + `render.config` (vertex/fragment
   entry names, `usesOrigin`) — fully derivable, today hand-set per platform.
3. **Add the per-frame evaluator to all three backbones:** web (`pass-runner.ts` consumes
   `config.frame(info, params)` → `{amp, ...extras}` → uniforms; `bindings` maps resolved param →
   GLSL uniform name), Swift (`swift/Sources/DopamineCore/` MetalPassRunner/Loader/Tempo), Android
   (`android/dopamine-core` + `android/dopamine-gl`). Each effect supplies frame/shadow as
   hand-written code today — replace with the datafied eval.
4. **Generic data-driven factory** per backbone that instantiates from `(dope, shader, hooks)` —
   deletes the per-effect factory boilerplate (the only per-effect web/swift/android source left
   for the migrated effects becomes the `.dope` + the web GLSL).

**Validation (locally verifiable — the safe net):** the parity grids cover the `.dope` *resolve*;
add micro-tests that sample a grid of `(animMs, life, params)` and assert the datafied
`tempo.frame`/`shadowHeightFrac` eval equals the current hand-written `frame()`/`shadowHeightFrac`
output, on web (vitest) + the Swift 192-grid + the Android JVM grid. Then the golden mid-frame gate
+ the reels confirm pixels unchanged.

## TODO — P3: lightning's logic transpiler

lightning precomputes its bolt geometry on the CPU (hash/fbm/writeBolt → a vertex array fed to the
shader via `frameArrays`; the MSL takes it as a `[[buffer]]`). A restricted TypeScript-subset
transpiler (`<name>.logic.ts` → Swift + Kotlin) would let that be authored once; web runs the
`.logic.ts` verbatim. This unblocks lightning's shader generation. Largest/most niche; do last.

---

## Verification reality (dev container)

No `xcrun`/Metal compiler and no Android SDK locally, BUT headless Chromium/SwiftShader works, so
the GLSL ES 3.00 (web + Android) path is locally golden-gated. MSL compiles only on the macOS CI
runner — covered transitively (same web GLSL source + the byte snapshot + the macOS compile). Lean
on CI (`swift.yml` macOS, `android.yml` build) for the compile gates; reverts are cheap.

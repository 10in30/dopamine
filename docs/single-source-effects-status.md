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

## P2: datafy the LOGIC hooks — **DONE on all three stacks**

Goal: move each effect's per-frame `frame()` + `shadowHeightFrac` + consts out of the
hand-written per-platform factories into the `.dope`, evaluated by a generic data-driven
factory in each backbone — so the *logic*, like the shader, is authored once.

### DONE — the web pillar (this branch)

**Format.** Each migrated effect's `.dope` now carries `tempo.frame` (`amp` + `extras`
as PER-FRAME expression trees — inputs `animMs`/`life`/`elapsedMs`, `{param}`, and ops
incl. the tempo primitives `envelope`/`easeOutCubic`/`easeOutBack`; specced in
`docs/effect-format.md` §7.1 + the schema), `tempo.reducedMotion`,
`render.shadowHeightFrac` (a PARAMS-ONLY expression or bare number), `render.consts`
and `render.config` (`usesOrigin`). The `binding` contract now **SHIPS in the portable
doc** (removed from the toolchain's strip list) — the runtime derives uniform bindings
from it. The three committed portable fixtures (the android JVM grid resource, the
swift parity fixture, core's `sample.dope.json`) were regenerated via `portableDope()`.

**Web backbone.** `packages/core/src/framework/frame-expr.ts` (`evalFrameExpr` /
`evalParamExpr` — calls the SAME `engine/tempo.ts` primitives, so datafied output is
bit-identical); `FrameInfo` gained `elapsedMs` (the REAL un-stepped clock, mirroring
the Swift/Android runners); `framework/dope-pass.ts` (`dopePassConfig` +
`registerDopeEffect`) derives the whole `PassConfig` from `(dope, shader, hooks)`.
The five web factories are now thin shims (shader + one `registerDopeEffect` call;
fail keeps its code-shaped SDF/passUniforms `hooks`); `inkstroke-tempo.ts`,
`halo-tempo.ts`, `fail-tempo.ts` and aurora's `SWEEP_SPEED` are deleted.

**Gates.** Per-effect `effects/<name>/web/test/frame-parity.test.ts` pins the datafied
`frame()`/`shadowHeightFrac` EXACTLY (`===`) against the frozen pre-P2 hand-written
logic across a feeling × clock grid, and pins the derived uniforms/bindings against
the old hand-written config literals. The golden mid-frame gate stays Δ0.

**One deliberate behavior change:** fail's stamp/shake now run on the REAL un-stepped
clock (`elapsedMs`) on web — matching what the Swift/Android ports always did. The
pre-P2 web factory fed them the on-twos-snapped `animMs`, so at whimsy > 0 web pixels
shift slightly toward the (already-shipped) native behavior.

### DONE — the Swift pillar (same branch)

`swift/Sources/DopamineCore/FrameExpr.swift` (portable, evaluates the RAW JSON
trees like web, calls the same `Tempo.swift` primitives, identical reduce order)
+ the Metal-guarded `DopePassConfig<U>` generic built from
`(doc, vertex/fragment fn, packUniforms, packExtras?)`. The five effects' Swift
sources are thin shims (`<Effect>.passConfig()`); `InkstrokeTempo.swift`,
`FailTempo.swift`, `haloBreathe`, `SWEEP_SPEED` and the per-effect consts are
deleted (consts come from `render.consts`, scatterKey from `binding.scatterKey`).
Fail keeps its boxPx/sdfStrokePx `packExtras` hook. `FrameParityTests.swift`
pins the datafied eval EXACTLY (`==`) against frozen pre-P2 oracles over the
feeling × clock grid, loading the canonical `.dope`s via `#filePath`. Linux
`swift test`: 20/20 (incl. the 192-case grid). Extras evaluate under their
CANONICAL names ("sweep"/"draw"/…) — the keys the generated packers read.

### DONE — the Android pillar (same branch)

`android/dopamine-core` gains `FrameExpr.kt` (typed decode + eval, same fold
order/primitives) and `DopePass.kt` — a pure-JVM `dopePassPlan(doc)` deriving
uniforms/bindings/shadow/frame/consts/scatterKey/reducedMotion (the web
`dope-pass.ts` rules; `cap()` moved from gl into core). `dopamine-gl`'s
`dopePassConfig(...)` wraps the plan into a `PassConfig`; the five effects'
`<Name>.kt` are thin shims and all five `*Tempo.kt` files are deleted.
`FrameExprTest.kt` + `FrameParityTest.kt` (frozen-oracle grid + derived
uniforms/bindings vs the old hand literals) run with NO Android SDK:
`./gradlew :dopamine-core:test` → 21/21. The five test-resource `.dope`s are
byte-identical to the dist embeds (the android.yml md5 gate covers them).

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

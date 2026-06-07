# Authoring a Dopamine effect

This is the **practical how-to** for adding a new visual effect to Dopamine. For
the *design rationale* of the `.dope` file format (why it looks like it does, the
multi-backend story, the Lottie lineage) read
[`effect-format.md`](./effect-format.md) — this guide is the build instructions,
that doc is the spec.

> **Architecture (package-per-effect).** The monorepo is a slim runtime core plus
> one installable package per effect:
>
> - **`packages/core`** (`@dopamine/core`) — the runtime ONLY: the conductor +
>   registries + `.dope` loader + the generic runners, and the SHARED engine bits
>   (`color`, `sdf`, `shadow`, `seed`, `context`, `gl`, the `look/*` GLSL chunks,
>   and the tempo PRIMITIVES `clamp01`/`easeOutCubic`/`easeOutBack`/`envelope`/
>   `NPR_TIME_STEP_MS`). Core imports + registers **no** effect.
> - **`packages/effect-<name>`** (`@dopamine/effect-<name>`) — one per effect.
>   Each depends on `@dopamine/core` and carries its OWN code + data: its
>   `<name>.dope.json`, `<name>-shader.ts`, its bespoke `<name>-tempo.ts`, its
>   panel `draw()`/renderer + embedded fonts/SDF where applicable, and a factory
>   `index.ts` that **self-registers on import** (`registerEffect` +
>   `registerProgram`). It self-registers, so importing it is all it takes.
> - **`packages/effects`** (`@dopamine/effects`) — the batteries-included
>   umbrella: depends on all nine, re-exports them, and hosts the `celebrate*`
>   conveniences, `builtinEffectNames`, and the `<dopamine-success>` element.
>   `import "@dopamine/effects"` registers everything.
>
> Adding an effect means **scaffolding a new `packages/effect-<name>` package** —
> NO core edits, NO shared-file edits, NO touching another package.

By the end you will be able to add either kind of effect — a **pure-shader**
effect or a **Canvas2D-hybrid** effect — by scaffolding a small package: a `.dope`
data file, a fragment shader (and, for hybrids, a `draw()` function), and ~30
lines of glue that self-registers. Most of what an effect "is" lives in data.

---

## 1. Mental model

Dopamine is a **thin runtime + pluggable effects**. An effect is a small,
self-registering module; the runtime owns everything an effect must not.

### 1.1 The runtime (the conductor)

`framework/conductor.ts` is the single runtime. Per target element (usually
`document.body`) it keeps ONE persistent **overlay** alive for the page lifetime:

- a **light** canvas (`mix-blend-mode: screen`) — black = no change, bright =
  casts coloured light onto the UI beneath, and
- an optional **shadow** canvas (`mix-blend-mode: multiply`) — white = no
  change, dark = a soft offset occlusion silhouette, so the effect reads as
  floating *above* the page and throwing shadow into it.

  See `overlay.ts` for the two-layer compositing model.

Each canvas is backed by a program-cached WebGL2 context (`engine/context.ts`):
a given shader **links once** for the page lifetime and every subsequent fire
reuses it. A single `requestAnimationFrame` loop drives every active effect; when
nothing is active the loop stops. The conductor also handles device-pixel-ratio +
resize, background-tab pausing, the **reduced-motion** fallback (draw one calm
frame, hold briefly), and is **SSR-safe** (off-DOM, `play()` resolves immediately
and `prepare()` returns `null` — every browser global is reached through
`framework/runtime.ts`).

Effects never create the overlay, the GL context, or the RAF loop. That is what
lets a new effect be a small file, and keeps the library tree-shakeable.

### 1.2 The registries + loader

- `framework/registry.ts` — `registerEffect(factory)` / `getEffect(name)`. An
  effect self-registers on import; if you never import it, it never lands in the
  bundle *or* the registry.
- `framework/mood-registry.ts` — the shared, effect-agnostic mood register
  (hue/lightness/chroma/energy per mood). `registerMood(name, spec)` lights a
  mood up across *all* effects at once.
- `framework/loader.ts` — `parseDope()` + `resolveDopeParams()`: parses a `.dope`
  document and evaluates its mapping grammar + OKLCH palette + per-mood baselines
  into the flat render-param bag the renderer consumes.
- `framework/programs.ts` — the render-program registry that lets the public
  `loadEffect()` bind an arbitrary host-authored `.dope` to a bundled shader.
- `framework/load-effect.ts` — `loadEffect()`: the public, no-code entry that
  loads/patches a `.dope` and returns a playable factory.

### 1.3 The feeling API

Callers express a **feeling**, not raw uniforms (`framework/effect.ts`,
`FeelingInput`):

```ts
interface FeelingInput {
  mood: string;     // a registered mood name (serene / celebratory / electric / …)
  intensity: number;// 0..1 arousal/valence: saturation, brightness, scale, overshoot
  whimsy: number;   // 0..1 stylization: photoreal (0) ↔ cel / hand-drawn "on twos" (1)
  seed: number;     // deterministic seed for the algorithmic colour + motion
}
```

Your effect's job is to map a feeling onto its own concrete params. The `.dope`
loader does that mapping for you from data; you only write code for the genuinely
code-shaped parts (the GLSL, and for hybrids the Canvas2D `draw()`).

### 1.4 The contract: `EffectFactory`

Every effect is an `EffectFactory` (`framework/effect.ts`):

```ts
interface EffectFactory<Params = unknown> {
  readonly name: string;                          // stable id, e.g. "solarbloom"
  resolve(feeling: FeelingInput, mood: ResolvedMood): Params; // feeling → params (pure)
  create(params: Params, ctx: EffectContext): EffectInstance; // params → drawable
  readonly castsShadow?: boolean;                 // default true
  readonly reducedMotion?: { holdMs?: number; peakMs?: number };
}
```

`create()` returns an `EffectInstance` — `{ durationMs, renderAt(elapsedMs),
dispose() }` — a pure function of time (same `elapsedMs` → same frame). You will
almost never write `EffectInstance` by hand: the two generic **runners** build it
for you from a small config.

---

## 2. The two kinds of effect

| | **Pure-shader** | **Canvas2D-hybrid** |
|---|---|---|
| Runner | `framework/pass-runner.ts` → `createPassInstance` | `framework/panel-runner.ts` → `createPanelInstance` |
| What draws each frame | one full-screen-triangle fragment shader | a Canvas2D `draw()` rasterized to a texture, *then* a fragment shader |
| Use when | the whole look is expressible analytically in GLSL (noise, SDFs, motes, gradients) | the look needs real vector/text layout the GPU can't easily do (hand-lettered words, complex paths) |
| Examples | Solarbloom, Calligraphic Verdict (inkstroke), Fail | Comic Impact |
| Aux inputs | optional baked-SDF icon or rasterized glyph textures | the per-frame panel texture (+ optional aux) |

Both runners share their plumbing via `framework/pass-common.ts` (scalar
auto-binding, palette/shadow uniforms, the program/VAO setup), so they behave
identically except for what they sample and one standard uniform (`uOrigin` vs
`uCenter`).

**Rule of thumb:** start with pure-shader. Only reach for the panel runner when
you genuinely need Canvas2D text/vector drawing — it re-uploads a full texture
every frame, so it is heavier.

---

## 3. The `.dope` schema, field by field

A `.dope` is a standalone JSON document. The loader consumes the keys below;
others (`meta`, `controls` UI hints) are for introspection/tooling. Use
`packages/effect-solarbloom/src/solarbloom.dope.json` (pure-shader) and
`packages/effect-comic/src/comic.dope.json` (hybrid) as live references.
`parseDope()` validates the magic (`fmt: "dopamine-effect"`), the
major version, the required keys, and the **standalone guard**.

### 3.1 Top-level

```jsonc
{
  "fmt": "dopamine-effect",       // magic — required
  "v": "1.0.0",                    // format semver (major must be ≤ 1)
  "id": "dopamine.success.solarbloom",
  "meta": { "name": "...", "description": "...", "tags": [] },
  "controls":  { /* §3.2 */ },
  "baselines": { /* §3.3 — per-mood numeric table */ },
  "palette":   { /* §3.4 — OKLCH golden-angle rules */ },
  "tempo":     { "durationMs": { /* §3.5 */ } },
  "geometry":  { /* §3.7 — optional outline → baked SDF */ },
  "content":   { /* optional, §3.8 */ },
  "typography":{ /* optional, §3.8 */ },
  "render":    { "params": { /* §3.6 */ }, "backends": { /* §3.9 */ }, "fallbackOrder": [] }
}
```

### 3.2 `controls` — the feeling API, introspectable

Declares the knobs a host UI can render. The loader reads `controls.mood.default`
for the default-mood fallback (§6.2); the rest is for hosts/tooling and for
`loadEffect` overrides (§6).

```jsonc
"controls": {
  "mood":      { "type": "enum", "default": "celebratory",
                 "options": ["serene","celebratory","electric"], "ui": "segmented" },
  "intensity": { "type": "scalar", "default": 0.7, "min": 0, "max": 1, "step": 0.01, "ui": "slider" },
  "whimsy":    { "type": "scalar", "default": 0.5, "min": 0, "max": 1, "step": 0.01, "ui": "slider" },
  "seed":      { "type": "int", "default": null, "nullable": true },
  "origin":    { "type": "point", "default": "center" },     // radial effects
  "target":    { "type": "selector", "default": "document.body" }
}
```

### 3.3 `baselines` — the per-mood numeric table

The tuned values for each mood your effect declares — the analogue of the
`MoodBaseline` tables that used to live in code. **The keys here are the moods
your effect supports.** A mapping expression's `{ "baseline": "X" }` node reads
`baselines[resolvedMood].X`.

```jsonc
"baselines": {
  "serene":      { "durationMs": 2600, "lightness": 0.84, "chroma": 0.09,
                   "hueCenter": 230, "hueRange": 120, "bloomRadius": 0.85, "moteCount": 22, /* … */ },
  "celebratory": { "durationMs": 1800, /* … */ },
  "electric":    { "durationMs": 1200, /* … */ }
}
```

### 3.4 `palette` — OKLCH golden-angle colour rules

The palette is **generated**, not listed, so "a unique palette every fire"
survives. Three linear-sRGB stops. Rules (all in `engine/color.ts → buildPalette`):

- the **base hue** is drawn from the seed PRNG, biased to the mood's
  `hueCenter ± hueRange/2`;
- successive stops step by the **golden angle** (137.50776°), scaled by
  `hueSpread`;
- `lightness`/`chroma` breathe across the three stops via `perStop` offsets;
- `chroma` itself is a mapping expression (so intensity can boost saturation).

```jsonc
"palette": {
  "model": "oklch", "space": "linear-srgb", "generator": "golden-angle",
  "goldenAngleDeg": 137.50776405003785, "stops": 3, "hueSpread": 0.55,
  "lightness": { "baseline": "lightness", "perStop": [0, 0.06, -0.05] },
  "chroma":    { "from": { "mul": [ {"baseline":"chroma"}, {"lerp":["intensity",0.7,1.5]} ] },
                 "perStop": [0, 0.02, -0.01] },
  "seed":      { "deterministic": true, "source": "controls.seed", "prng": "mulberry32" },
  "perMood": {  // colour register per mood (hueCenter/hueRange/lightness/chroma)
    "serene":      { "hueCenter": 230, "hueRange": 120, "lightness": 0.84, "chroma": 0.09 },
    "celebratory": { "hueCenter": 50,  "hueRange": 320, "lightness": 0.80, "chroma": 0.16 },
    "electric":    { "hueCenter": 35,  "hueRange": 150, "lightness": 0.78, "chroma": 0.23 }
  }
}
```

> **PRNG order is load-bearing.** `resolveDopeParams` consumes the seed PRNG in a
> fixed order: the base hue (inside `buildPalette`) **first**, then the per-fire
> scatter offset (`rng() * 1000`). Do not reorder — a pinned seed must reproduce
> byte-for-byte (the parity tests assert this, §7).

### 3.5 `tempo` — `durationMs`

Total effect length, as a mapping expression. Only `durationMs` is consumed by
the loader here; the *shape* of time (envelopes, draw windows, the "on twos"
grid) lives in `engine/tempo.ts` and is wired up in your effect's `frame()` hook
(§4.4).

```jsonc
"tempo": { "durationMs": { "from": { "round": {
  "mul": [ {"baseline":"durationMs"}, {"lerp":["intensity",1.1,0.9]} ] } } } }
```

### 3.6 `render.params` + the mapping grammar

`render.params` is a `name → spec` table. Each numeric param becomes a shader
uniform by the `u<Name>` auto-binding convention (§5.2). Each spec is:

```jsonc
"bloomRadius": {
  "type": "float",          // "float" | "int" (informational; round with a node)
  "from": <ExprNode>,        // the mapping expression (below)
  "clamp01": true,           // optional post-clamp to [0,1]
  "clampMax": "MAX_MOTES",   // optional: clamp to a named const (passed to the loader)
  "clampMin": "SOME_CONST"   // optional
}
```

> `style` is special: the loader always sets `style = whimsy` (the raw control),
> so a `style` entry in `render.params` is skipped. Reference whimsy as
> `{ "control": "whimsy" }` if you also need it under another name.

**The mapping grammar (`ExprNode` in `framework/loader.ts → evalExpr`).** A tiny,
non-Turing-complete expression tree (no loops, no user functions — safe to
evaluate from an untrusted file, trivial to port to Swift):

| Node | Meaning |
|---|---|
| `5` (bare number) | the literal `5` |
| `{ "const": 5 }` | the literal `5` |
| `{ "control": "intensity" }` | the control value, **clamped to [0,1]** |
| `{ "baseline": "bloomRadius" }` | `baselines[resolvedMood].bloomRadius` (throws if missing) |
| `{ "lerp": ["intensity", a, b] }` | `a + (b-a) * clamp01(control)` |
| `{ "mul": [x, y, …] }` | product (identity 1) |
| `{ "add": [x, y, …] }` | sum (identity 0) |
| `{ "sub": [x, y, …] }` | `x - y - …` |
| `{ "round": x }` | `Math.round(x)` |
| `{ "floor": x }` | `Math.floor(x)` |
| `{ "mix": [a, b, "whimsy"] }` | `a + (b-a) * clamp01(control)`, where `a`/`b` are themselves expressions |
| `{ "max": [x, y, …] }` | `Math.max(…)` |
| `{ "min": [x, y, …] }` | `Math.min(…)` |

Post-evaluation flags (`clamp01`, `clampMax`, `clampMin`) are applied last;
`clampMax`/`clampMin` look up a named constant from the `consts` the effect passes
to the loader (e.g. `MAX_MOTES`). `mix`/`max`/`min` are the extension nodes used
by the typography table — old nodes never change meaning (format §10).

### 3.7 `geometry.outlines` — the icon → baked-SDF seam

If your effect draws an icon "in light" (a tick, a cross, a logo), author it as
an SVG path; a **build step bakes it into an inline SDF** and the shader only
*samples* it. This is the geometry seam (`engine/sdf.ts`):

```jsonc
"geometry": {
  "kind": "radial",                       // "radial" | "directional" (a hint)
  "viewBox": [0, 0, 100, 100],
  "outlines": {
    "checkmark": {
      "role": "confirm-glyph",
      "svgPath": "M 5 55 L 38 88 L 95 12",  // authored — supports M/L/H/V/C/Q/Z
      "source": "baked-sdf",
      "sdf": { "size": 64, "range": 18, "viewBox": [0,0,100,100],
               "data": "data:application/octet-stream;base64,…" }  // produced by the baker
    }
  }
}
```

- **Authoring → baking.** You write the `svgPath`. `scripts/bake-sdf.mjs
  <file.dope.json>` (or `--all`) rasterizes every outline's path into the inline
  `sdf` blob, in place + idempotently. `scripts/pack-dope.mjs` does the same as
  part of producing a distributed standalone `.dope` (and can emit a
  dotLottie-style zip). Swapping the `svgPath` + re-baking changes the rendered
  icon **with no shader edit**.
- **Runtime.** The effect `decodeSdf(outline.sdf)` once at module load and the
  shader samples it (`uSdfTex`). If the `sdf` is absent the effect falls back
  (Solarbloom → a bundled font glyph → the analytic in-shader SDF), so the icon
  always renders.

### 3.8 `content` / `typography` (optional)

For the last code-shaped data — a word pool, glyph bands, lettering curves —
keep it declarative too. Comic uses both (`framework/content.ts`):

- `content.pool` — the per-fire SLAMMED token pool; picked by seed with
  `pickFromList(pool, seed)`.
- `content.glyphBands` (Solarbloom) — whimsy→(face,char) bands, picked with
  `pickBand(bands, whimsy)`.
- `typography` — `{ fallbackStack, perMood: { face, skew, … }, fields: { name:
  { from: <ExprNode>, clamp01?, round? } } }`. `resolveTypography()` evaluates the
  `fields` with the mapping grammar (the per-mood typographic baseline is visible
  to `{ "baseline": "skew" }` etc.) and assembles the `fontStack`.

### 3.9 `render.backends` + standalone rule

```jsonc
"render": {
  "params": { /* §3.6 */ },
  "backends": {
    "webgl2": {
      "stage": "fullscreen-triangle",
      "blend": "screen",                    // light layer; the shadow pass is multiply
      "shader": { "program": "solarbloom" } // a BUNDLED program key (§5)
    }
  },
  "fallbackOrder": ["webgl2"]
}
```

`render.backends.webgl2.shader.program` is the **bundled render-program key** —
the runtime ships the GLSL, the `.dope` carries data + the key. This is what lets
`loadEffect(anyDopeDoc)` bind a host-authored doc to your shader with no code.
A `.dope` may instead `$ref` inline GLSL, but the built-ins use program keys.

**Standalone rule.** A `.dope` must be self-contained: `parseDope()` rejects any
`http(s)://`, protocol-relative `//host`, or absolute-path string anywhere in the
document. Inline assets as `data:` blobs, or reference them by relative path
inside a `.dope` zip. Run `pack-dope` to produce the distributed artifact.

---

## 4. The runner config + per-frame hook

You hand the runner a config object. The genuinely code-shaped bits live there;
everything else is data-driven.

### 4.1 Standard uniforms the runner sets for you

Both runners set these automatically (`framework/pass-common.ts`,
`STANDARD_COMMON`):

| Uniform | Meaning |
|---|---|
| `uResolution` | canvas size, device px |
| `uOrigin` *(pass)* | anchor in gl coords (y-up), set only if `usesOrigin: true` |
| `uCenter` *(panel)* | canvas center, device px |
| `uLife` | normalized life 0..1 |
| `uTimeS` | elapsed seconds (the "on twos"-snapped clock for the pass runner) |
| `uStyle` | `style` (= whimsy) |
| `uC0` / `uC1` / `uC2` | the three palette stops |
| `uAmp` | the envelope amplitude returned by your `frame()` hook |
| `uShadow` | 0 = light pass, 1 = shadow pass |
| `uShadowOffset` / `uShadowSoft` / `uShadowStrength` | shadow-pass geometry (set on the shadow pass from `engine/shadow.ts`) |

### 4.2 The `u<Name>` auto-binding convention

Every **numeric** `render.params` entry auto-binds to `u<Name>` (e.g.
`bloomRadius → uBloomRadius`), except `durationMs` (tempo, never a uniform).
Override or skip via `bindings` in the config:

```ts
bindings: {
  inkSeed: "uSeed",   // bind under a different uniform name
  overshoot: null,    // null = NOT a uniform (it feeds the envelope instead)
}
```

### 4.3 The standard shader scaffold

Compose the shared GLSL "look" chunks (re-exported from `@dopamine/core`) rather
than copying functions. A pass shader looks like:

```ts
import { GLSL_CONSTANTS, GLSL_HASH, GLSL_FBM, GLSL_PALETTE_MIX,
         GLSL_SD_SEG, GLSL_TONEMAP_ACES, GLSL_DITHER } from "@dopamine/core";

export const VERTEX_SRC = /* glsl */ `#version 300 es
void main() {                                   // full-screen triangle, no buffers
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution; uniform float uLife, uTimeS, uStyle, uAmp;
uniform vec3 uC0, uC1, uC2;
uniform float uShadow; uniform vec2 uShadowOffset; uniform float uShadowSoft, uShadowStrength;
/* … your effect's own uniforms … */
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_PALETTE_MIX}
${GLSL_SD_SEG}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
void main() {
  // light pass: sum layers as light (canvas is black, composited via screen).
  // shadow pass (uShadow==1): output a dark offset silhouette of the bright forms.
  fragColor = vec4(/* … */);
}`;
```

Available chunks: `GLSL_CONSTANTS` (`TAU`), `GLSL_HASH`, `GLSL_FBM`,
`GLSL_DOMAIN_WARP`, `GLSL_PALETTE_MIX` (`paletteMix(t)` over uC0/1/2),
`GLSL_IRIDESCENT`, `GLSL_DISPERSION`, `GLSL_SD_SEG` (`sdSeg`),
`GLSL_TONEMAP_ACES`, `GLSL_DITHER` (`ditherAdd`), `GLSL_ROT2`, `GLSL_HALFTONE`
(`benday`), and `GLSL_PARTICLES` (in `look/particles.glsl.ts`). If you `#define`
a loop bound (e.g. `MAX_MOTES`), make the TS const that feeds the loader the
**single source of truth** and interpolate it into the GLSL — see
`effect-solarbloom/src/solarbloom-shader.ts`
(`export const MAX_MOTES = 80; … #define MAX_MOTES ${MAX_MOTES}`).

### 4.4 The `frame()` hook — the only genuinely time-varying code

The config's `frame(info, params)` computes the per-frame, effect-specific
uniforms (the envelope amplitude, draw/stamp progress, shake). It returns a map;
the well-known key `amp` becomes `uAmp` **and** feeds the shadow geometry, every
other key is its own uniform.

```ts
frame: ({ animMs, life }, params) => ({
  amp: envelope(life, params.overshoot),  // → uAmp + shadow strength
  uCheck: checkProgress(animMs),           // → uCheck
}),
```

The **generic** timing PRIMITIVES live in `@dopamine/core` and are imported from
there: `envelope` (held-breath attack + overshoot + decay), `easeOutCubic`/
`easeOutBack`, `clamp01`, and `NPR_TIME_STEP_MS`. Your effect's **bespoke**
timing — its own draw window / slam / stamp / lub-dub / strike envelope — lives in
*your package's* `<name>-tempo.ts`, built on top of those primitives (see e.g.
`effect-solarbloom/src/solarbloom-tempo.ts → checkProgress`,
`effect-comic/src/comic-tempo.ts → impactScale/impactPresence`,
`effect-fail/src/fail-tempo.ts → failEnvelope/stampProgress/shakeOffset`). The
pass runner snaps `animMs` toward a 12 Hz grid as `style` rises (the
**animate-on-twos** look); the panel runner uses the raw clock.

---

## 5. Step-by-step: add a NEW pure-shader effect

We'll add a fictional `sparkle` effect. It's a NEW PACKAGE,
`packages/effect-sparkle` — no core edits, no shared-file edits. The package is
just: `package.json`, `tsconfig.json`, and `src/` (the dope + shader + bespoke
tempo + factory) + a `test/`.

### 5.0 Scaffold the package

```
packages/effect-sparkle/
  package.json        # name @dopamine/effect-sparkle, keyword "dopamine-effect",
                      # dep @dopamine/core, build "tsc -p tsconfig.json",
                      # "sideEffects": ["./src/index.ts", "./dist/index.js"]
  tsconfig.json       # extends ../../tsconfig.base.json, outDir ./dist, rootDir ./src
  src/
    index.ts          # the factory — self-registers on import (§5.3)
    sparkle.dope.json # the data (§5.1)
    sparkle-shader.ts # the GLSL (§5.2)
    sparkle-tempo.ts  # the bespoke envelope (only if it needs one)
  test/
    sparkle.test.ts   # pin a seed, assert params/look (§7.5)
```

Copy an existing leaf package (`packages/effect-aurora` is the simplest
pure-shader one) and rename. `package.json`:

```jsonc
{
  "name": "@dopamine/effect-sparkle",
  "version": "0.1.0",
  "description": "Sparkle — a success effect for Dopamine.",
  "keywords": ["dopamine-effect"],
  "type": "module",
  "main": "./dist/index.js", "module": "./dist/index.js", "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist", "src"],
  "sideEffects": ["./src/index.ts", "./dist/index.js"],
  "scripts": { "build": "tsc -p tsconfig.json" },
  "dependencies": { "@dopamine/core": "0.1.0" }
}
```

After scaffolding, run `npm install` once so the workspace symlink is created.

### 5.1 `src/sparkle.dope.json`

A minimal doc (one mood, one knob mapped). Copy `solarbloom.dope.json` and trim:

```jsonc
{
  "fmt": "dopamine-effect", "v": "1.0.0", "id": "dopamine.success.sparkle",
  "meta": { "name": "Sparkle", "tags": ["success"] },
  "controls": {
    "mood": { "type": "enum", "default": "celebratory",
              "options": ["serene","celebratory","electric"], "ui": "segmented" },
    "intensity": { "type": "scalar", "default": 0.7, "min": 0, "max": 1, "step": 0.01, "ui": "slider" },
    "whimsy": { "type": "scalar", "default": 0.5, "min": 0, "max": 1, "step": 0.01, "ui": "slider" },
    "seed": { "type": "int", "default": null, "nullable": true }
  },
  "baselines": {
    "serene":      { "durationMs": 2200, "lightness": 0.84, "chroma": 0.09, "hueCenter": 230, "hueRange": 120, "spread": 0.5 },
    "celebratory": { "durationMs": 1600, "lightness": 0.80, "chroma": 0.16, "hueCenter": 50,  "hueRange": 320, "spread": 0.8 },
    "electric":    { "durationMs": 1100, "lightness": 0.78, "chroma": 0.23, "hueCenter": 35,  "hueRange": 150, "spread": 1.1 }
  },
  "palette": {
    "model": "oklch", "space": "linear-srgb", "generator": "golden-angle",
    "goldenAngleDeg": 137.50776405003785, "stops": 3, "hueSpread": 0.55,
    "lightness": { "baseline": "lightness", "perStop": [0, 0.06, -0.05] },
    "chroma": { "from": { "mul": [ {"baseline":"chroma"}, {"lerp":["intensity",0.7,1.5]} ] },
                "perStop": [0, 0.02, -0.01] },
    "seed": { "deterministic": true, "source": "controls.seed", "prng": "mulberry32" },
    "perMood": {
      "serene":      { "hueCenter": 230, "hueRange": 120, "lightness": 0.84, "chroma": 0.09 },
      "celebratory": { "hueCenter": 50,  "hueRange": 320, "lightness": 0.80, "chroma": 0.16 },
      "electric":    { "hueCenter": 35,  "hueRange": 150, "lightness": 0.78, "chroma": 0.23 }
    }
  },
  "tempo": { "durationMs": { "from": { "round": {
    "mul": [ {"baseline":"durationMs"}, {"lerp":["intensity",1.1,0.9]} ] } } } },
  "render": {
    "params": {
      "exposure": { "type": "float", "from": { "lerp": ["intensity", 0.8, 1.5] } },
      "spread":   { "type": "float", "from": { "mul": [ {"baseline":"spread"}, {"lerp":["intensity",0.9,1.2]} ] } },
      "overshoot":{ "type": "float", "from": { "lerp": ["intensity", 0.7, 1.3] } },
      "style":    { "type": "float", "from": { "control": "whimsy" } }
    },
    "backends": { "webgl2": { "stage": "fullscreen-triangle", "blend": "screen",
                              "shader": { "program": "sparkle" } } },
    "fallbackOrder": ["webgl2"]
  }
}
```

### 5.2 `src/sparkle-shader.ts`

The shader, composing the look chunks (§4.3). Read `uExposure`, `uSpread`,
`uAmp`, `uStyle`, `uC0..2`, and output light; on `uShadow==1` output a dark
silhouette. Import the `GLSL_*` chunks from `@dopamine/core`.

### 5.3 `src/index.ts` — the factory, config, registration

Everything is imported from `@dopamine/core`; the only local imports are this
package's own shader + (optional) bespoke `<name>-tempo.ts`.

```ts
import { SPARKLE_FRAGMENT_SRC, SPARKLE_VERTEX_SRC } from "./sparkle-shader.js";
import {
  envelope,
  registerEffect,
  registerProgram,
  parseDope,
  resolveDopeParams,
  createPassInstance,
  type EffectContext,
  type EffectFactory,
  type EffectInstance,
  type FeelingInput,
  type PassConfig,
  type PassParams,
} from "@dopamine/core";
import doc from "./sparkle.dope.json";

const DOPE = parseDope(doc as object);

interface SparkleParams extends PassParams {
  exposure: number; spread: number; overshoot: number; sparkleSeed: number;
}

const CONFIG: PassConfig = {
  vertex: SPARKLE_VERTEX_SRC,
  fragment: SPARKLE_FRAGMENT_SRC,
  uniforms: ["uExposure", "uSpread"],   // your own uniforms (standard ones are implicit)
  usesOrigin: true,                      // set uOrigin (anchored radial effect)
  bindings: { overshoot: null, sparkleSeed: null }, // not uniforms
  shadowHeightFrac: (p) => (p as SparkleParams).spread * 0.5,
  frame: ({ life }, p) => ({ amp: envelope(life, (p as SparkleParams).overshoot) }),
};

function createInstance(params: SparkleParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params, ctx);
}

export const sparkle: EffectFactory<SparkleParams> = {
  name: "sparkle",
  resolve: (feeling: FeelingInput) =>
    resolveDopeParams(DOPE, feeling, {}, "sparkleSeed") as unknown as SparkleParams,
  create: createInstance,
  reducedMotion: { peakMs: 240, holdMs: 360 },
};

// Optional but recommended: expose as a bundled program so loadEffect() can bind
// host-authored sparkle variants with no code.
registerProgram<SparkleParams>("sparkle", {
  create: createInstance, scatterKey: "sparkleSeed", consts: {},
  reducedMotion: { peakMs: 240, holdMs: 360 },
});

export default registerEffect(sparkle);
```

Notes: `resolveDopeParams(doc, feeling, consts, scatterKey)` — `consts` feeds
`clampMax`/`clampMin` lookups; `scatterKey` names the per-fire scatter offset
(`rng()*1000`). The `bindings: { …: null }` entries keep non-uniform params from
being auto-bound. The factory's own `package.json` `"sideEffects"` entry for
`src/index.ts` keeps the self-registration from being tree-shaken away.

### 5.4 Wire it into the build + (optionally) the umbrella

- **Root build.** Add `-w @dopamine/effect-sparkle` to the effects step of the
  root `package.json` `build` script (between core and the umbrella).
- **Demo (optional).** Add the package to `examples/demo/package.json` deps and a
  loader entry in `src/main.ts`; the demo's Vite alias
  `^@dopamine\/effect-(.*)$ → packages/effect-$1/src/index.ts` already resolves it
  to source (no new alias needed). The same alias is in `vitest.config.ts`.
- **Umbrella (optional, for the batteries set).** Add it to
  `packages/effects/package.json` deps and `import { sparkle } from
  "@dopamine/effect-sparkle"` in `packages/effects/src/index.ts`, referencing it
  in `BUILTINS` (which also feeds `builtinEffectNames`). Pure standalone effects
  can skip the umbrella entirely.

### 5.5 Fire it

A consumer installs `@dopamine/core` + your effect package and imports it (the
import self-registers):

```ts
import "@dopamine/effect-sparkle";          // self-registers
import { play } from "@dopamine/core";
await play("sparkle", { mood: "electric", intensity: 0.8 });
```

…or, if it's in the umbrella, `import "@dopamine/effects"` registers everything.

---

## 6. Step-by-step: add a NEW Canvas2D-hybrid effect

Same shape as §5, but use the **panel runner**. The differences:

### 6.1 The config is a `PanelConfig`

```ts
import { createPanelInstance, type PanelConfig, type PassParams } from "@dopamine/core";
import { impactPresence } from "./badge-tempo.js"; // this package's bespoke timing

const CONFIG: PanelConfig<BadgeParams & PassParams> = {
  vertex: BADGE_VERTEX_SRC,
  fragment: BADGE_FRAGMENT_SRC,
  panelSampler: "uPanel",                 // sampler for the uploaded panel (default "uPanel")
  uniforms: ["uPresence", "uSaturation"],
  bindings: { overshoot: null, seed: null },
  shadowHeightFrac: 0.5,
  // dpr-scaled / non-param uniforms computed per pass:
  passUniforms: (_canvas, params, dpr) => ({ uDotSize: params.dotSize * dpr }),
  // THE PANEL PROGRAM — your Canvas2D draw, called once per frame:
  draw: (pctx, w, h, params, info) => {
    pctx.clearRect(0, 0, w, h);
    pctx.save();
    // …draw your vector/text content with the 2D context…
    pctx.restore();
  },
  frame: ({ life }, _params) => {
    const presence = impactPresence(life);
    return { amp: presence, uPresence: presence };   // amp → uAmp + shadow
  },
};

function createInstance(params: BadgeParams, ctx: EffectContext) {
  return createPanelInstance(CONFIG, params as BadgeParams & PassParams, ctx);
}
```

The runner owns the offscreen canvas, resizing it to track the GL canvas, the
per-frame `draw()` → `texImage2D` upload into both light and shadow contexts
(FLIP_Y, non-premultiplied), and the two passes. Your shader samples `uPanel`
(the rasterized content) and adds the lit treatment (halftone, flash, etc.).

### 6.2 Everything else is the same

`.dope` (you can add `content` / `typography` for words/lettering), shader
scaffold (`GLSL_HALFTONE`/`GLSL_ROT2` are handy here), `registerEffect`,
`registerProgram` (with a `composeParams` hook if you compose non-numeric params
like Comic's word + typography). The Canvas2D `draw()` + embedded fonts live in
your package too (e.g. `comic-renderer.ts` + `comic-fonts.ts`). See
`packages/effect-comic/src/` (`index.ts` + `comic-shader.ts` + `comic-renderer.ts`
+ `comic-fonts.ts` + `comic-params.ts` + `comic-tempo.ts`) as the full reference.

---

## 7. Moods, palette, tempo, shadow, validation

### 7.1 Declaring your own moods + the default-mood fallback

Your `.dope` declares the moods it supports as the **keys of `baselines`** (and
the matching `palette.perMood` register). Each effect declares its OWN moods — the
success trio declares serene/celebratory/electric; the Fail effect declares
try-again/error/denied. There is no single global fallback mood.

When asked for a mood it doesn't declare, an effect degrades to its **own
default** (`framework/loader.ts → defaultMoodKey`): `controls.mood.default` if
that mood has a baseline, else the first key in `baselines`. The same key drives
both the baseline lookup and the palette register, so they always agree.

To make a mood available to *all* effects (so a custom brand mood lights up
everywhere), register it in the shared register:

```ts
import { registerMood } from "@dopamine/core";
registerMood("triumphant", { hueCenter: 280, hueRange: 160, lightness: 0.8, chroma: 0.22, energy: 0.9 });
```

An effect that has a tuned baseline for a mood uses it; an effect that doesn't can
derive one from the register's `energy` (the legacy oracle shows the pattern). The
Fail effect registers its moods this way at module load
(`packages/effect-fail/src/index.ts`).

### 7.2 Palette / colour

Covered in §3.4. To pin a brand palette without touching the effect, a host uses
`loadEffect(doc, { overrides: { palette: [oklch, oklch, oklch] } })` (or pins the
`seed`) — the base-hue PRNG draw still happens, so per-fire scatter is unchanged.

### 7.3 Tempo / envelopes / animate-on-twos

`tempo.durationMs` sets the length; the time *shape* is code (`engine/tempo.ts`)
wired through your `frame()` hook. The pass runner snaps the clock toward a 12 Hz
grid (`NPR_TIME_STEP_MS`) by `style` — the "animate on twos" look — so high-whimsy
fires read as posed, discrete beats. The panel runner uses the raw clock (panels
don't snap). The held-breath `envelope(life, overshoot)` is the canonical success
shape; `failEnvelope` is the curt negative counterpart.

### 7.4 Shadow

If `castsShadow !== false`, the runner draws a second **multiply** pass. You set
`shadowHeightFrac` (a constant or a function of params — the occluder "height" as
a fraction of min canvas dim) and the runner computes offset/softness/strength
from `engine/shadow.ts` using your frame's `amp`. In the shader, branch on
`uShadow`: on the shadow pass output a dark silhouette of the bright forms, offset
by `uShadowOffset`, softened by `uShadowSoft`, scaled by `uShadowStrength`. Opt
out with `castsShadow: false` on the factory if your effect casts no shadow.

### 7.5 Validate: shots + byte-parity

- **Visual spot-check.** `node scripts/shot.mjs [peakMs] [suffix] [effect]`
  builds the demo, renders one peak frame per mood under headless Chromium
  (SwiftShader), and writes PNGs to `e2e/output/`. The Chromium flags are baked
  into the script (`--use-gl=angle --use-angle=swiftshader
  --enable-unsafe-swiftshader --ignore-gpu-blocklist --enable-webgl`). Read the
  PNGs to confirm the look. (The demo seeds randomly per fire, so two runs differ
  in colour — that's the seed, not a regression.)
- **Byte-parity (the original built-ins).** Solarbloom / inkstroke / comic each
  ship a **frozen, test-only legacy oracle** inside their own package
  (`<name>-oracle.ts`), and a `test/parity.test.ts` asserts the `.dope`-driven
  loader output **and** the factory's `resolve` equal that oracle byte-for-byte
  across a mood × intensity × whimsy × seed grid (palette + numeric + content +
  typography). If you change one of those built-ins' `.dope` you must keep parity
  (or update the oracle deliberately). A brand-new effect has no oracle — you
  simply add a `test/<name>.test.ts` in your package that pins a seed and asserts
  the params/look you expect. **Never import an oracle from production code**; it
  exists only as the regression reference. `npm test` discovers tests across all
  packages (see `vitest.config.ts`, which aliases every `@dopamine/*` to source).

---

## 8. Checklist for a new effect

Everything is inside the new `packages/effect-<name>` package — **no core edits,
no shared-file edits**.

1. [ ] **Scaffold** `packages/effect-<name>/` — `package.json` (name
   `@dopamine/effect-<name>`, keyword `dopamine-effect`, dep `@dopamine/core`,
   build script, `"sideEffects": ["./src/index.ts", "./dist/index.js"]`),
   `tsconfig.json` (extends `../../tsconfig.base.json`), `src/`, `test/`. Run
   `npm install` once.
2. [ ] `src/<name>.dope.json` — controls, baselines (per declared mood), palette
   (perMood register), tempo.durationMs, render.params (mapping grammar),
   render.backends.webgl2.shader.program = `<name>`, fallbackOrder.
3. [ ] `src/<name>-shader.ts` — vertex (full-screen triangle) + fragment,
   composing the `GLSL_*` chunks imported from `@dopamine/core`; handle the
   `uShadow` pass; single-source any `#define` loop bound.
4. [ ] `src/<name>-tempo.ts` — your effect's bespoke envelope/draw window, built
   on the `@dopamine/core` primitives (skip if `envelope`/`easeOut*` suffice).
5. [ ] (geometry) author `geometry.outlines.*.svgPath` and run
   `node scripts/bake-sdf.mjs packages/effect-<name>/src/<name>.dope.json` to
   inline the SDF. (Embedded fonts: keep them in your package, e.g.
   `<name>-fonts.ts`.)
6. [ ] `src/index.ts` — `parseDope(doc)`, a `PassConfig`/`PanelConfig` (uniforms,
   bindings, shadowHeightFrac, frame, and for hybrids draw/passUniforms), `resolve`
   via `resolveDopeParams`, `create` via `createPass/PanelInstance`,
   `registerEffect`, optional `registerProgram`. Imports come from `@dopamine/core`.
7. [ ] **Wire the build**: add `-w @dopamine/effect-<name>` to the root
   `package.json` `build` script; optionally add to the `@dopamine/effects`
   umbrella + the demo (§5.4).
8. [ ] `test/<name>.test.ts` — pin a seed, assert params/look.
9. [ ] `npm test` (green) and `npm run build` (per-effect chunk appears).
10. [ ] `node scripts/shot.mjs 320 -<name> <name>` and read the PNGs.

### Common pitfalls

- **PRNG order.** Don't add `rng()` draws in your `resolve` outside the loader, or
  before the palette — it shifts the scatter and breaks reproducibility.
- **Forgetting `bindings: { x: null }`.** A numeric param that ISN'T a uniform
  (an envelope input, a scatter seed) will otherwise auto-bind to a `u<X>` your
  shader doesn't declare — harmless (skipped if absent) but misleading; mark it
  `null`.
- **`style` in `render.params`.** It's set automatically (= whimsy) and skipped if
  listed. Use `{ "control": "whimsy" }` for any other whimsy-derived param.
- **External refs.** Any `http(s)://`/absolute path fails `parseDope`. Inline as
  `data:` or use a `.dope` zip with relative paths; run `pack-dope`.
- **`uOrigin` vs `uCenter`.** Pass-runner effects opt into `uOrigin` with
  `usesOrigin: true` (anchored radial). Panel effects always get `uCenter`. A
  gesture that composes across the whole surface (inkstroke) needs neither.
- **Private GLSL copies.** Compose the `look/` chunks; don't paste `fbm`/`sdSeg`/
  `paletteMix`/`benday` into your shader — the library has one canonical copy each.
- **Forgetting the program registration.** If you want `loadEffect()` to bind
  host variants, `registerProgram(name, …)` in addition to `registerEffect`.

---

## See also

- [`effect-format.md`](./effect-format.md) — the `.dope` format spec + design
  rationale (multi-backend, Lottie lineage, the full migration history).
- `effect-format.schema.json` — JSON Schema the CI validates shipped docs against.
- Reference effect packages (each `packages/effect-<name>/src/index.ts`):
  `effect-solarbloom` (pass + baked SDF + glyph fallback + embedded check fonts),
  `effect-inkstroke` (pass, no origin), `effect-fail` (pass + own moods + SDF),
  `effect-comic` (panel + content + typography + embedded display fonts),
  `effect-aurora` (the simplest pure-shader package — a good copy-from template).

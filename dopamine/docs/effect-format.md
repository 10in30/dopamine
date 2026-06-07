# Dopamine Effect Format (`.dope`) — Design Doc

Status: DRAFT / RFC. Author: principal eng. Date: 2026-06-06.
Scope: a **declarative file format** that lets Dopamine effects be embedded and
customized in host projects **without code**, and that survives the move from the
web (WebGL2) to iOS (Metal) and other backends.

> **Looking to ADD an effect?** This doc is the format *spec + rationale*. For the
> practical, copy-pasteable how-to (write a `.dope`, a shader / `draw()`, register,
> code-split), read **[`authoring-effects.md`](./authoring-effects.md)** — it is
> the build instructions; this is the reference.

> A note on the brief: the owner wrote "Loggy." There is no animation format by
> that name. In context — "an extension of, or inspired by, the Bodymovin/Airbnb
> JSON animation format" — this is unambiguously **Lottie**. The rest of this doc
> reads it as Lottie, and §2 justifies that choice against the real alternatives.

---

## 0. TL;DR / recommendation

**Recommendation: an *inspired-by-Lottie* greenfield JSON schema, with a Lottie
compatibility seam — NOT a literal Lottie extension.**

Why, in three lines:

1. Dopamine is **parametric and generative** (a feeling → a deterministic
   resolve into render params → an analytic shader). Lottie is a **baked
   keyframe timeline** of vector layers. Forcing Dopamine's mood/intensity/whimsy
   curves and per-fire OKLCH palettes into Lottie's `layers/shapes/ks` model
   would be a lossy, fighting-the-tool exercise.
2. But Lottie's **primitives are excellent and battle-tested** — its bezier path
   encoding (`ks.p`/shape `ks` vertices `i`/`o`/`v`), its keyframe object
   (`{t, s, e, i, o, h}`) including **hold/step** keyframes (`h:1`), and its
   `dotLottie` zip packaging. We **reuse those primitives verbatim** so our
   outline paths and easing/step curves are Lottie-shaped, tooling-compatible,
   and convertible.
3. So: a Dopamine-native top-level document (`controls`, `palette`, `tempo`,
   `geometry`, `render`) whose **leaf data structures are Lottie-compatible**,
   plus an optional embedded/`$ref`'d real Lottie animation for hosts that want a
   pure-Lottie fallback. Best of both: a renderer-agnostic parametric core that
   still speaks Lottie at the edges.

---

## 1. Goals & non-goals

### Goals
- **No-code embedding & theming.** A host drops in a `.dope` file, optionally
  overrides controls (palette, ranges, icon path), and fires it.
- **Introspectable controls.** A host can render a UI for an effect (sliders,
  swatches, pickers) purely from the file — no per-effect code.
- **Renderer-agnostic.** One file, multiple backends (WebGL2 today; Metal, then
  Canvas2D/SVG fallbacks). Portable intent; backend-specific shader bodies are
  *referenced*, not the source of truth.
- **Deterministic + generative.** Preserve the "unique palette every fire" lever
  (seeded OKLCH golden-angle) while keeping pinned-seed reproducibility.
- **Faithful to the existing engine.** Everything in `resolveParams` /
  `resolveInkParams` / `color.ts` / `tempo.ts` must round-trip into the format
  and back out to the same `RenderParams` / `InkRenderParams`.
- **Versioned & validated** (JSON Schema), with a clear extensibility story for
  future effects (progress, error, attention) and a migration path off the
  hardcoded `resolve*Params`.

### Non-goals
- Not a general-purpose animation authoring format. Dopamine effects are short,
  one-shot, feeling-driven reward moments — not arbitrary timelines.
- Not a shader transpiler. We don't promise to cross-compile GLSL→MSL inside the
  loader; we promise a *binding contract* (uniform names + semantics) that each
  backend's hand-written/ported shader honors.

---

## 2. Format choice: Lottie vs the alternatives

| Option | Fit for parametric/generative | Vector paths | Step/hold curves | Multi-backend (Metal) | Tooling/ecosystem | Verdict |
|---|---|---|---|---|---|---|
| **Literal Lottie extension** | Poor — no concept of controls/mappings; would abuse `ef` (effects) or comments | Native, excellent | Native (`h:1` hold keyframes) | Lottie players exist (lottie-ios is UIKit/Core Animation, not our light-casting Metal shader) | Best-in-class | ❌ as the core; ✅ as a seam |
| **Inspired-by-Lottie greenfield (recommended)** | Native — `controls` + `mappings` are first-class | Reuse Lottie path encoding | Reuse Lottie keyframe `h:1` + add explicit `step` interp | Our binding contract is renderer-agnostic by design | We piggyback on Lottie primitives for converters | ✅ |
| **Rive `.riv`** | Good (state machines, runtime params) | Native | Native | Rive has its own renderer (Rive Renderer/Metal) but it's *their* pipeline, not our light-casting shader | Proprietary binary, needs Rive editor | ❌ — can't drive our fragment shaders; binary is opaque to host theming |
| **Raw SVG + SMIL** | Poor — declarative but no params/generative color, SMIL is deprecated-ish | Native (SVG path) | Limited (`calcMode="discrete"`) | None for shaders | Ubiquitous but weak animation | ❌ |
| **Theatre.js JSON** | Good for keyframed sequences/props | No native vector model | Yes | JS-only runtime | Niche | ❌ — JS-runtime-bound, not portable to Metal |
| **Pure greenfield (no Lottie)** | Native | We'd reinvent path encoding | We'd reinvent | Fine | Zero ecosystem leverage | ⚠️ — works, but throws away free converters/validators |

**Decision:** inspired-by-Lottie greenfield. We get a parametric core that maps
1:1 onto our engine, *and* we keep Lottie's proven leaf encodings so:
- outline glyphs can be authored in any Lottie/SVG tool and pasted in;
- easing & step curves use the keyframe object designers already know;
- a `.dope` can embed or `$ref` a real `.json`/`.lottie` for a degraded
  pure-Lottie fallback on hosts without our runtime.

---

## 2b. Self-contained, no external assets (hard rule)

A `.dope` is **standalone** — it must never point at the network or an absolute
filesystem path. The loader enforces this (`parseDope` walks the doc and throws
on any `http(s)://`, protocol-relative `//host`, or absolute-path value), so a
`.dope` is guaranteed portable and offline. Assets are carried one of two ways:

- **Single JSON** — everything inline: a bundled-program **key**
  (`render.backends.webgl2.shader = { "program": "solarbloom" }`, resolved to a
  shader the runtime ships), inline GLSL, or `data:` URIs for small binaries.
  This is what the three built-ins use today.
- **`.dope` zip** (dotLottie-style) — for binary assets (baked SDF textures,
  fonts) without base64 bloat: a zip whose entry is `effect.json` plus an
  `assets/` dir referenced by **relative** paths only. The loader reads the zip
  (tiny inflate) and resolves paths *inside* it; relative refs are allowed,
  remote/absolute are not.

### Authoring → packing → distribution, and what's done at BUILD time
Anything static is precomputed by a `pack-dope` build step so the runtime only
samples — never converts:

```
authored .dope (human-editable: SVG path strings, full GLSL, font sources)
        │  scripts/pack-dope  (build time)
        │   • outline paths  → baked SDF (texture or distance data)   ← key one
        │   • shaders        → minified / chunk-resolved
        │   • fonts          → subset + embedded
        │   • palette/curves → optional LUTs
        ▼
distributed .dope  (standalone: single JSON, or zip w/ relative assets)
```

Build-time **path→SDF** is the headline: host-swappable icon/letter outlines are
distance-field-baked when packed, so the runtime samples an SDF instead of doing
live path→SDF conversion. (Today the built-ins' check/stroke SDFs are analytic
in-shader; the pack step is the home for *arbitrary* swapped outlines — see the
deferred host-override seam.) The authored source stays in the repo for
round-tripping; the packed artifact carries the runtime-ready, self-contained
assets.

## 3. Top-level document structure

A `.dope` document is JSON (UTF-8). Top-level keys:

```jsonc
{
  "fmt": "dopamine-effect",     // magic string
  "v": "1.0.0",                  // semver of the format
  "id": "dopamine.success.verdict",
  "meta": { "name": "...", "author": "...", "description": "...", "tags": [] },

  "controls":  { /* §4 — the feeling API, introspectable, host-overridable */ },
  "palette":   { /* §6 — OKLCH golden-angle color rules */ },
  "tempo":     { /* §7 — envelope, confirm window, stepping grid */ },
  "geometry":  { /* §5 — outline paths + animation curves as paths */ },
  "render":    { /* §8 — param schema, uniform binding, backends */ },

  "compat":    { /* §9 — optional embedded/ref'd Lottie fallback */ },
  "extends":   "dopamine.success.base"  // optional inheritance (§10)
}
```

Mental model of the pipeline (mirrors the current engine exactly):

```
controls (mood, intensity, whimsy, seed)
   │  apply control mappings (curves/lerps)   ── §4 + §8.1
   ▼
resolved render params (palette, exposure, durations, knobs, style)
   │  palette rules                            ── §6  (color.ts)
   │  tempo (envelope, confirm, stepping)      ── §7  (tempo.ts)
   │  geometry (icon outline + easing/step)    ── §5
   ▼
uniform binding per backend                    ── §8.2 (renderer*.ts)
   ▼
WebGL2 | Metal | Canvas2D | SVG
```

This is the same shape as today: `ResolveInput → RenderParams → uniforms`. The
format just makes the *middle box* data instead of TypeScript.

---

## 4. Controls — the feeling API, made introspectable

The whole point of Dopamine is that callers pick a **feeling**, not raw knobs
(see `types.ts`). The format declares the knobs *and* how they map onto params,
so a host can both (a) render UI and (b) compute params with no Dopamine code.

```jsonc
"controls": {
  "mood": {
    "type": "enum",
    "label": "Mood",
    "default": "celebratory",
    "options": ["serene", "celebratory", "electric"],
    "ui": "segmented"
  },
  "intensity": {
    "type": "scalar", "label": "Intensity",
    "default": 0.7, "min": 0, "max": 1, "step": 0.01, "ui": "slider",
    "help": "Reward strength: saturation, brightness, bloom size, overshoot."
  },
  "whimsy": {
    "type": "scalar", "label": "Whimsy",
    "default": 0.5, "min": 0, "max": 1, "step": 0.01, "ui": "slider",
    "help": "Photoreal (0) ↔ cel / hand-drawn 'animate on twos' (1)."
  },
  "seed":   { "type": "int",   "label": "Seed", "default": null, "nullable": true,
              "help": "Null = unique per fire; pin for reproducible output." },
  "origin": { "type": "point", "label": "Origin", "default": "center",
              "appliesWhen": "geometry.kind == 'radial'" },
  "target": { "type": "selector", "label": "Target", "default": "document.body" }
}
```

Each control declares enough for a generic inspector: `type`, `label`, range,
`ui` hint, `help`, and an optional `appliesWhen` (so `origin` is hidden for the
directional Verdict, matching how `index.ts` ignores `origin` for ink). Hosts MAY
**clamp** ranges (§9) — e.g. lock `intensity` to `[0.3, 0.8]` to keep a brand
calm — by overriding `min`/`max`/`default` without touching the effect logic.

### 4.1 Control → param mappings

The mood **baselines** (`BASELINES` / `INK_BASELINES` in `mood.ts`) and the
**lerp ranges** become declarative tables. Two kinds of entries:

- `baseline[mood]`: a constant per mood (the `MoodBaseline` fields).
- `map`: a transform from a control onto a multiplier/curve.

```jsonc
"render": {
  "params": {
    "exposure": {
      "type": "float",
      "from": { "lerp": ["intensity", 0.75, 1.5] }   // == lerp(0.75,1.5,i)
    },
    "bloomRadius": {
      "type": "float",
      "from": { "mul": [ { "baseline": "bloomRadius" },
                         { "lerp": ["intensity", 0.8, 1.15] } ] }
    },
    "overshoot": {
      "type": "float",
      "from": { "mul": [ { "baseline": "overshoot" },
                         { "lerp": ["intensity", 0.7, 1.25] } ] }
    },
    "moteCount": {
      "type": "int", "clampMax": "MAX_MOTES",
      "from": { "round": { "mul": [ { "baseline": "moteCount" },
                                    { "lerp": ["intensity", 0.85, 1.25] } ] } }
    },
    "iridescence": {
      "type": "float", "clamp01": true,
      "from": { "mul": [ { "baseline": "iridescence" },
                         { "lerp": ["whimsy", 1.0, 0.12] } ] }
    },
    "style": { "type": "float", "from": { "control": "whimsy" } },
    "durationMs": {
      "type": "int",
      "from": { "round": { "mul": [ { "baseline": "durationMs" },
                                    { "lerp": ["intensity", 1.1, 0.9] } ] } }
    }
  }
}
```

**Mapping mini-grammar** (an expression tree; the loader is a tiny evaluator —
see §12):

| Node | Meaning | Engine equivalent |
|---|---|---|
| `{ "control": "intensity" }` | raw control value (clamped per its range) | `clamp01(intensity)` |
| `{ "baseline": "X" }` | `baseline[currentMood].X` | `BASELINES[mood].X` |
| `{ "lerp": [ctrl, a, b] }` | `a + (b-a)*clamp01(ctrl)` | `lerp(a,b,i)` |
| `{ "mul": [x, y, …] }` | product | `*` |
| `{ "add" / "sub": […] }` | sum / difference | `+ / -` |
| `{ "round": x }` / `{ "floor": x }` | rounding | `Math.round` |
| `{ "curve": [ctrl, "$ref:tempo.curves.foo"] }` | sample a bezier/step curve at `ctrl` | §5.2 |
| `{ "const": n }` | literal | literal |
| flags: `clamp01`, `clampMax`, `clampMin` | post-clamp | `clamp01`, `Math.min` |

This grammar is intentionally tiny and **non-Turing-complete** (no loops, no user
functions) so it is safe to evaluate from an untrusted file and trivial to port
to Swift. It captures every relationship in `resolveParams` /
`resolveInkParams` (see §11 for the full mapping).

---

## 5. Embedded PATH data

Two distinct uses of "path," both explicitly requested:

1. **Outline paths** — the *shape* of an icon/glyph (checkmark, comic burst,
   letterform). Spatial 2D geometry.
2. **Curves as paths** — easing beziers, the tempo envelope, and **step
   functions** ("animate on twos"). 1D-over-time interpolation data.

We reuse Lottie's encodings for both so they're tool-compatible.

### 5.1 Outline paths (icon & letter shapes)

Two interchangeable encodings, `kind: "svg"` or `kind: "lottie"`:

```jsonc
"geometry": {
  "kind": "directional",            // "radial" (bloom) | "directional" (stroke)
  "viewBox": [0, 0, 100, 100],      // normalized author space
  "outlines": {
    "checkmark": {
      // (a) SVG path string — easiest to author/paste:
      "svgPath": "M 5 55 L 38 88 L 95 12",
      // (b) OR Lottie shape vertices (cubic bezier; i/o are tangents
      //     relative to v, exactly like Lottie 'ks' shape data):
      "lottie": {
        "c": false,                 // closed?
        "v": [[5,55],[38,88],[95,12]],
        "i": [[0,0],[-10,-10],[0,0]],
        "o": [[0,0],[10,10],[0,0]]
      },
      "role": "confirm-glyph"       // semantic tag a renderer/host can key on
    }
  }
}
```

Why offer both: `svgPath` is what a designer copies out of Figma/Illustrator in
two seconds; the `lottie` form is what Bodymovin emits and is lossless for
tangents. The loader normalizes either into a list of cubic-bezier segments.

How the **current engine** uses this (IMPLEMENTED — the geometry seam is live):
Solarbloom's checkmark icon is an outline entry (`role: "confirm-glyph"`) whose
`svgPath` is **baked at build time into an inline SDF** (`scripts/bake-sdf.mjs` /
`scripts/pack-dope.mjs` → `engine/sdf.ts`) and stored under
`geometry.outlines.checkmark.sdf`. At runtime the effect `decodeSdf`s it once and
the shader only SAMPLES it (`uSdfTex` in `engine/shader.ts`). A host can **swap
the icon path** (checkmark → star → custom logo) by overriding
`geometry.outlines.checkmark.svgPath` and re-baking — no shader edits. If the
baked `sdf` is absent the effect falls back to a bundled font glyph, then to an
analytic in-shader SDF, so the confirm always renders. The Fail effect uses the
same seam for its ✗ cross. (The Verdict stroke remains analytic in
`engine/inkstroke-shader.ts` — it has no swappable outline yet.)

We also ship the explicitly-requested comic shapes as outline entries:
`starburst`, `onomatopoeia.pow`, `onomatopoeia.zap` (see the example file).

### 5.2 Animation curves as paths (easing, envelope, STEP functions)

All timing curves use **one** structure: a Lottie-compatible keyframe array,
optionally flagged as stepped. This single structure expresses smooth eases,
the held-breath envelope, AND the "animate on twos" step function.

```jsonc
"tempo": {
  "curves": {

    // (a) Easing bezier — Lottie keyframe object: i/o are the bezier handles,
    //     identical to Lottie's {t,s,e,i,o}. This is easeOutCubic from tempo.ts.
    "easeOutCubic": {
      "kind": "bezier",
      "keys": [
        { "t": 0, "s": [0], "o": { "x": [0.215], "y": [0.61] },
                            "i": { "x": [0.355], "y": [1] } },
        { "t": 1, "s": [1] }
      ]
    },

    // (b) The held-breath ENVELOPE (tempo.ts `envelope`): attack with overshoot
    //     then a long decay. Encoded as keyframes; the overshoot magnitude is a
    //     PARAM (driven by intensity), so the peak 's' references a control.
    "envelope": {
      "kind": "bezier",
      "domain": "life",                 // x is normalized life 0..1
      "keys": [
        { "t": 0.0,  "s": [0] },
        { "t": 0.18, "s": [{ "expr": "1 + 0.4*overshoot" }],   // easeOutBack peak
          "i": { "x": [0.34], "y": [1.4] }, "o": { "x": [0.5], "y": [1] } },
        { "t": 1.0,  "s": [0],
          "i": { "x": [0.4], "y": [0] }, "o": { "x": [0.2], "y": [0] } }
      ],
      "note": "Reference encoding. The analytic envelope() in tempo.ts remains the source of truth for backends that prefer it; this curve is the portable approximation + the authoring handle."
    },

    // (c) STEP FUNCTION — "animate on twos". This is the path-file-for-a-step-
    //     -function the brief asks for. h:1 == Lottie HOLD keyframe (no interp);
    //     the value jumps and holds until the next key. 12 steps/sec == 24fps on
    //     twos == NPR_TIME_STEP_MS (1000/12).
    "animateOnTwos": {
      "kind": "step",
      "domain": "timeSeconds",
      "gridHz": 12,                     // == 1000/NPR_TIME_STEP_MS
      "blendControl": "whimsy",         // style 0 = continuous, 1 = fully snapped
      // explicit step keys (a staircase) for tools that render the curve:
      "keys": [
        { "t": 0.0000, "s": [0.0000], "h": 1 },
        { "t": 0.0833, "s": [0.0833], "h": 1 },
        { "t": 0.1667, "s": [0.1667], "h": 1 }
        // … generated: t_k = k/12, s_k = t_k, hold. (Or use the generator below.)
      ],
      "generator": { "type": "uniform-staircase", "hz": 12 }
    }
  }
}
```

**Step-function semantics (the load-bearing detail).** The engine does NOT
hard-snap; it *blends* toward the staircase by `style` (== whimsy). From the
generic pass runner (`framework/pass-runner.ts`, using `NPR_TIME_STEP_MS` from
`engine/tempo.ts`):

```
stepped = floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS
animMs  = elapsedMs + (stepped - elapsedMs) * style
```

The format encodes this as: a `step` curve (`kind:"step"`, `h:1` hold keys on a
`gridHz` grid) plus a `blendControl: "whimsy"` that lerps between the raw clock
and the snapped clock. A backend reads `gridHz` and `blendControl` and reproduces
the two-line blend exactly. The explicit `keys` are there so a curve editor can
draw the staircase; the `generator` lets a loader synthesize them without listing
every step.

Encoding `h` matches Lottie's hold flag, so these step paths import/export to any
Lottie tool as discrete keyframes.

---

## 6. Color rules (OKLCH golden-angle)

This is `color.ts` made declarative. The palette is **generated**, not listed, so
the "unique every fire" novelty lever survives.

```jsonc
"palette": {
  "model": "oklch",
  "space": "linear-srgb",              // shader gets LINEAR; CSS gets gamma
  "generator": "golden-angle",
  "goldenAngleDeg": 137.50776405003785,
  "stops": 3,
  "hueStep": { "expr": "goldenAngleDeg * (0.35 + 0.65 * hueSpread)" },
  "hueSpread": 0.55,
  "baseHue": { "from": "rng", "center": { "baseline": "hueCenter" },
               "range": { "baseline": "hueRange" } },  // wrapHue(center+(rng-0.5)*range)
  "lightness": { "baseline": "lightness", "perStop": [0.0, 0.06, -0.05] },
  "chroma":    { "from": { "mul": [ { "baseline": "chroma" },
                                    { "lerp": ["intensity", 0.7, 1.5] } ] },
                 "perStop": [0.0, 0.02, -0.01] },

  "seed": {
    "deterministic": true,
    "source": "controls.seed",         // null → randomSeed() per fire
    "prng": "mulberry32",              // matches seed.ts exactly
    "note": "Palette base hue + per-fire scatter (moteSeed/inkSeed) draw from the SAME mulberry32(seed) stream, in the SAME order as mood.ts, so a pinned seed reproduces byte-for-byte."
  },

  "perMood": {                          // the color register columns of BASELINES
    "serene":      { "hueCenter": 230, "hueRange": 120, "lightness": 0.84, "chroma": 0.09 },
    "celebratory": { "hueCenter": 50,  "hueRange": 320, "lightness": 0.80, "chroma": 0.16 },
    "electric":    { "hueCenter": 35,  "hueRange": 150, "lightness": 0.78, "chroma": 0.23 }
  }
}
```

Rationale: OKLCH is perceptually uniform, so golden-angle hue walks are always
harmonious (the comment in `color.ts`). We keep the **conversion** (OKLab
matrices → linear sRGB, gamut clamp) as a fixed library routine, not file data —
it's math, not configuration. The file declares *intent* (model, generator,
seed stream, per-mood register); the backend owns the transcendental math.

**Deterministic vs random** is a single switch: a non-null `controls.seed`
reproduces; null draws a fresh seed per fire. Hosts that want a *fixed brand
palette* can either pin the seed or supply a `palette.override` (§9) listing
explicit OKLCH stops, bypassing the generator.

---

## 7. Timing / keyframes

`tempo.ts` made declarative. Reuses the Lottie keyframe model (§5.2) for the
curves; scalars for the windows.

```jsonc
"tempo": {
  "durationMs": { "from": { "round": { "mul": [ { "baseline": "durationMs" },
                                                { "lerp": ["intensity", 1.1, 0.9] } ] } } },
  "confirm": {
    "kind": "draw-window",
    "windowMs": { "perEffect": { "checkmark": 240, "stroke": 360 } }, // CHECK_DRAW_MS / STROKE_DRAW_MS
    "progress": { "curve": "$ref:tempo.curves.easeOutCubic" }         // checkProgress/strokeProgress
  },
  "envelope": { "curve": "$ref:tempo.curves.envelope",
                "overshoot": { "param": "overshoot" } },
  "stepping": { "curve": "$ref:tempo.curves.animateOnTwos" },         // §5.2
  "curves": { /* …§5.2… */ }
}
```

Key facts encoded: the **fast confirm** window is *independent of total
duration* (the glyph draws in ≤240/360 ms no matter how long the afterglow), the
**held-breath envelope** has a fast attack (18%) + overshoot + long decay, and
the **stepping grid** is 12 Hz blended by whimsy. This is exactly the two-layer
timing the README/`tempo.ts` describe.

---

## 8. Renderer binding & multi-backend

### 8.1 The contract

The portable contract is: **`controls` + mappings + palette + tempo + geometry
deterministically produce a flat bag of named, typed render params** (the
`RenderParams` / `InkRenderParams` interfaces). That bag is the renderer-agnostic
interface. Backends differ only in *how* they consume it.

### 8.2 Uniform mapping (the shader binding)

`render.backends[*].uniforms` maps param names → backend uniform names. In the
current runtime this mapping is **implicit by convention**: the generic runners
(`framework/pass-runner.ts` / `framework/panel-runner.ts`, sharing
`framework/pass-common.ts`) auto-bind each numeric param `x` to the uniform `uX`,
with a per-effect `bindings` map for the exceptions — so a built-in's `.dope`
references its shader by a bundled `program` KEY
(`render.backends.webgl2.shader = { "program": "solarbloom" }`) rather than an
explicit uniform table. An explicit `uniforms` table (below) is still the portable
form for a non-bundled or cross-backend doc:

```jsonc
"render": {
  "params": { /* §4.1 */ },
  "derived": {                          // time-varying values computed per frame
    "uAmp":   { "from": { "curve": ["life", "$ref:tempo.curves.envelope"] } },
    "uCheck": { "from": { "curve": ["confirmProgress", "$ref:tempo.curves.easeOutCubic"] } },
    "uLife":  { "from": "life" },
    "uTimeS": { "from": "animSeconds" } // post-stepping clock (§5.2)
  },
  "backends": {
    "webgl2": {
      "stage": "fullscreen-triangle",
      "blend": "screen",                // mix-blend-mode: screen overlay
      "shader": { "$ref": "shaders/solarbloom.frag.glsl" },  // source lives outside the doc
      "uniforms": {
        "exposure": "uExposure", "bloomRadius": "uBloomRadius",
        "turbulence": "uTurbulence", "moteSpeed": "uMoteSpeed",
        "moteCount": "uMoteCount", "moteSeed": "uMoteSeed",
        "iridescence": "uIridescence", "dispersion": "uDispersion",
        "style": "uStyle",
        "palette[0]": "uC0", "palette[1]": "uC1", "palette[2]": "uC2",
        "origin": "uOrigin", "resolution": "uResolution"
      },
      "caps": ["webgl2", "highp-float"]
    },
    "metal": {
      "stage": "fullscreen-triangle",
      "blend": "screen",
      "shader": { "$ref": "shaders/solarbloom.metal" },
      "uniforms": { /* same param names → an MTLBuffer struct field per uniform */ },
      "caps": ["metal2"]
    },
    "canvas2d": {                        // capability fallback
      "strategy": "raster-approx",
      "fallbackOf": "webgl2",
      "note": "No volumetric bloom; draws palette radial gradient + glyph outline + eased opacity envelope. Honors palette/tempo/geometry, drops shader-only knobs (turbulence, iridescence, dispersion)."
    },
    "svg": {
      "strategy": "outline-only",
      "note": "Animates the geometry.outlines glyph with the easing/step curves (stroke-dashoffset draw-on). Pure Lottie-ish degrade; no light casting."
    }
  },
  "fallbackOrder": ["metal", "webgl2", "canvas2d", "svg"]
}
```

### 8.3 What's portable vs backend-specific

| Concern | Portable (in file) | Backend-specific |
|---|---|---|
| Controls, mappings | ✅ fully | — |
| Palette intent (OKLCH, seed stream) | ✅ | OKLab→RGB math is a fixed lib per platform |
| Tempo curves (easing/envelope/step) | ✅ | sampling impl |
| Outline geometry | ✅ | how an SDF/path is built from it |
| Uniform *names + semantics* | ✅ (the binding table) | uniform *transport* (GL uniforms vs MTLBuffer struct) |
| **Shader source body** | ❌ referenced by `$ref` | hand-written/ported per backend (`.glsl`, `.metal`) |
| Capability fallback | ✅ declared (`fallbackOrder`, `strategy`) | implemented per backend |

**Shader source handling.** GLSL and MSL are NOT embedded as the canonical
source (cross-compiling is out of scope, §1 non-goals). Instead each backend
`$ref`s its own shader file inside the `.dope` zip (§9). The *contract* the
shaders must honor — uniform names, units (device pixels, gl-y-up origin),
blend mode — lives in the file and is validated. A host on a platform with no
matching shader walks `fallbackOrder` down to a raster/outline approximation.
This is exactly how the same params already drive two different shaders today
(Solarbloom vs Verdict share the mood/tempo/color model but ship distinct GLSL).

**The Metal story in one paragraph (matches the roadmap).** The iOS port reads
the *same* `.dope`: it evaluates `controls`+mappings to the identical param bag
(the mapping grammar is trivially portable to Swift — it's arithmetic), runs the
same OKLCH/golden-angle palette with `mulberry32(seed)` (so a pinned seed matches
web byte-for-byte), samples the same tempo curves, and binds the params into an
`MTLBuffer` whose struct fields are the `uniforms` map, against a hand-ported
`solarbloom.metal` full-screen pass composited with a screen-equivalent blend.
Nothing in the *file* changes between web and iOS except which `backends.*.shader`
is selected.

---

## 9. Host integration & packaging

### 9.1 Loading & overriding

```ts
import { loadEffect } from "@dopamine/core";

const fx = await loadEffect("/effects/verdict.dope", {
  overrides: {
    "controls.intensity.max": 0.8,            // clamp the range
    "controls.intensity.default": 0.6,
    "palette.override": [                      // themable: pin brand colors
      { L: 0.82, C: 0.12, h: 265 }, { L: 0.86, C: 0.10, h: 25 }, { L: 0.78, C: 0.18, h: 200 }
    ],
    "geometry.outlines.checkmark.svgPath": "M5 55 L40 88 L95 8"  // swap the icon
  }
});
await fx.fire({ mood: "electric", intensity: 0.7 });
```

Overrides are a **shallow JSON-pointer patch** applied to the parsed doc before
resolution. Three host customization tiers, all no-code from the host's POV:

1. **Theme** — `palette.override` (explicit OKLCH stops) or pin `seed`.
2. **Constrain** — clamp control `min`/`max`/`default` to keep effects on-brand.
3. **Reskin** — swap an `outlines` glyph; remap a control's `ui`/`label`.

The loader **re-validates** the merged doc against the schema and rejects
out-of-range overrides, so a host can't push the effect into an invalid state.

### 9.2 Packaging — `.dope` (a dotLottie-style zip)

A single `.dope` is either a bare `.json` or a **zip** (recommended for anything
with external shaders/assets), structured like dotLottie:

```
verdict.dope  (zip)
├── manifest.json          // { "fmt":"dopamine-effect", "version":"1.0.0",
│                          //   "effects":[{ "id":"...","path":"effects/verdict.json"}] }
├── effects/
│   └── verdict.json        // the document (§3)
├── shaders/
│   ├── solarbloom.frag.glsl
│   └── solarbloom.metal
├── geometry/
│   └── starburst.json      // large outlines split out, $ref'd from the doc
└── lottie/
    └── verdict.lottie      // optional pure-Lottie fallback (§9.3)
```

Zip (over a fat JSON) because shaders + glyph libraries get big, and it matches
dotLottie so existing tooling/CDNs treat it sanely. `$ref` resolution is relative
to the zip root (or http(s) for remote, with same-origin/allowlist rules).

### 9.3 Lottie compatibility / composition

- **Embed/`$ref` a real Lottie** under `compat.lottieFallback`: a host with only
  a Lottie player (no Dopamine runtime) plays a baked approximation. The
  `outlines` and `tempo.curves` already use Lottie-shaped data, so generating
  this fallback is mostly mechanical.
- **Reference Lottie sublayers**: `geometry.outlines.*.lottie` can be lifted
  straight from a Bodymovin export; conversely our outlines export back to Lottie
  shape layers.
- **Compose effects**: `extends` (§10) plus a future `compose` block (sequence /
  overlay multiple effect ids on a shared clock) — e.g. Verdict stroke + a small
  Solarbloom punctuation. Out of scope for v1 schema but reserved.

---

## 10. Versioning, validation & extensibility

- **Format version** `v` (semver). Loader policy: accept same major; warn on
  newer minor (ignore unknown keys → forward-compatible); reject newer major.
- **JSON Schema** at `docs/effect-format.schema.json` (Draft 2020-12). CI
  validates every shipped `.dope`. The schema covers the document, the control
  descriptors, the mapping mini-grammar (recursive `$defs/expr`), palette, tempo
  curves (Lottie keyframe + step), geometry, and backends.
- **Extensibility:**
  - New effects = new documents (e.g. `dopamine.progress.*`), reusing
    `controls`/`palette`/`tempo` blocks. `extends` lets a family share a base.
  - New params = additive keys under `render.params`; unknown params a backend
    doesn't bind are ignored (the uniform map is the gate).
  - `x-` prefixed keys are reserved for vendor extensions and never validated
    strictly.
  - The mapping grammar can grow nodes (e.g. `smoothstep`, `pow`) without a major
    bump as long as old nodes keep their meaning.

---

## 11. Migration plan (off hardcoded `resolve*Params`) — IMPLEMENTED

The format is designed so today's engine is the *reference implementation*. The
plan below is now built (`@dopamine/core`'s `framework/loader.ts` + each effect's
bundled `packages/effect-<name>/src/<name>.dope.json`):

> **Authoring note (package-per-effect).** Effects ship as separate
> `@dopamine/effect-<name>` packages on top of the slim `@dopamine/core` runtime;
> the byte-parity oracle for the original three lives in each package's
> `<name>-oracle.ts` + `test/parity.test.ts`. See
> [`authoring-effects.md`](./authoring-effects.md) for the scaffold flow.

**Phase 0 — encode. DONE.** `solarbloom.dope.json`, `inkstroke.dope.json` and
`comic.dope.json` reproduce `BASELINES`/`INK_BASELINES`/`COMIC_BASELINES` + the
lerp ranges + color/tempo exactly, in a `baselines` per-mood table + the
`render.params` mapping grammar.

**Phase 1 — parity test. DONE.** The loader (`resolveDopeParams`) evaluates the
mapping grammar + the OKLCH palette in the SAME rng order as the engine. A
vitest (`test/loader.test.ts`) asserts, across a `mood × intensity × whimsy ×
seed` grid, that loader-resolved params equal `resolveParams` /
`resolveInkParams` / `resolveComicParams` **byte-for-byte** (the correctness
anchor — exact equality, not epsilon).

**Phase 2 — flip the source of truth. DONE.** Each effect's `resolve()`
(`effects/*.ts`) now drives off its bundled `.dope` document through the loader.
Solarbloom + Verdict are fully data-driven; Comic is numeric+palette data-driven
with its typography + per-fire word composed in code (genuinely code-shaped).
The legacy `resolve*Params` remain in `mood.ts` as the parity reference.

**Phase 3 — open it up. DONE (web).** The public `loadEffect(doc | JSON | .dope
zip, { overrides })` (`framework/load-effect.ts`) returns a registered, playable
effect from an arbitrary `.dope`: it parses + (optionally) patches the doc
(clamp control ranges, pin a brand `palette`/`seed`, swap an outline `svgPath` —
re-baked to an SDF), re-validates the merged doc (magic/version + the standalone
guard), and binds it to the bundled render program its
`render.backends.webgl2.shader.program` key names (`framework/programs.ts`). The
content/typography tables (Comic's words + lettering, Solarbloom's glyph bands)
are also data-driven (`framework/content.ts`). Bodymovin import for `outlines`
remains the only deferred piece.

### 11.1 Concrete mapping — Solarbloom (`resolveParams`)

| `RenderParams` field | Source in `mood.ts` | Format encoding |
|---|---|---|
| `seed` | input/`randomSeed()` | `palette.seed.source` |
| `durationMs` | `round(base.durationMs * lerp(1.1,0.9,i))` | `tempo.durationMs` (§7) |
| `palette` | `buildPalette(rng, {L,C,hueCenter,hueRange,hueSpread})` | `palette` (§6) |
| `exposure` | `lerp(0.75,1.5,i)` | `render.params.exposure` |
| `bloomRadius` | `base.bloomRadius * lerp(0.8,1.15,i)` | `render.params.bloomRadius` |
| `moteCount` | `min(MAX_MOTES, round(base * lerp(0.85,1.25,i)))` | `params.moteCount` (`clampMax`) |
| `moteSpeed` | `base.moteSpeed` | `{ "baseline": "moteSpeed" }` |
| `turbulence` | `base.turbulence * lerp(0.85,1.2,i)` | `params.turbulence` |
| `overshoot` | `base.overshoot * lerp(0.7,1.25,i)` | `params.overshoot` |
| `iridescence` | `clamp01(base.iridescence * lerp(1.0,0.12,w))` | `params.iridescence` (`clamp01`) |
| `dispersion` | `clamp01(base.dispersion * lerp(1.0,0.45,w) * lerp(0.85,1.1,i))` | `params.dispersion` |
| `style` | `w` | `{ "control": "whimsy" }` |
| `moteSeed` | `rng() * 1000` | `palette.seed` scatter (same mulberry32 stream) |

### 11.2 Concrete mapping — Calligraphic Verdict (`resolveInkParams`)

| `InkRenderParams` field | Source | Format encoding |
|---|---|---|
| `durationMs` | `round(base.durationMs * lerp(1.1,0.9,i))` | `tempo.durationMs` |
| `palette` | `buildPalette(...)` (same generator, ink baselines) | `palette` w/ ink `perMood` |
| `exposure` | `lerp(0.8,1.55,i)` | `params.exposure` |
| `overshoot` | `base.overshoot * lerp(0.7,1.25,i)` | `params.overshoot` |
| `scale` | `base.scale * lerp(0.9,1.08,i)` | `params.scale` |
| `pressure` | `base.pressure * lerp(0.85,1.2,i)` | `params.pressure` |
| `wetness` | `clamp01(base.wetness * lerp(1.0,0.35,w))` | `params.wetness` (`clamp01`) |
| `bristle` | `clamp01(base.bristle * lerp(0.85,1.25,w) * lerp(0.9,1.1,i))` | `params.bristle` |
| `droplets` | `min(MAX_DROPS, round(base * lerp(0.7,1.3,i)))` | `params.droplets` (`clampMax`) |
| `style` | `w` | `{ "control": "whimsy" }` |
| `inkSeed` | `rng() * 1000` | `palette.seed` scatter |

Confirm window: `STROKE_DRAW_MS=360` → `tempo.confirm.windowMs.stroke`.
Stroke geometry `P0/P1/P2` → `geometry.outlines["signature-stroke"]` (quadratic;
stored as a 3-vertex Lottie path or `svgPath` `M…Q…`).

---

## 12. Loader sketch (proof the mapping is real — NOT a full parser)

```ts
// Pseudo-code. The mapping evaluator is ~30 lines; this is why the grammar
// is intentionally tiny + non-Turing-complete.

type Ctx = { mood: Mood; controls: Record<string, number>;
             baseline: Record<string, number>; rng: Rng;
             consts: { MAX_MOTES: number; MAX_DROPS: number } };

const clamp01 = (x:number) => x<0?0:x>1?1:x;
const lerp = (a:number,b:number,t:number) => a+(b-a)*clamp01(t);

function evalExpr(node: any, ctx: Ctx): number {
  if (typeof node === "number") return node;
  if ("const"    in node) return node.const;
  if ("control"  in node) return clamp01(ctx.controls[node.control]); // matches clamp01(i)
  if ("baseline" in node) return ctx.baseline[node.baseline];
  if ("lerp"     in node) { const [c,a,b]=node.lerp; return lerp(a,b, ctx.controls[c]); }
  if ("mul"      in node) return node.mul.reduce((p:number,n:any)=>p*evalExpr(n,ctx),1);
  if ("add"      in node) return node.add.reduce((p:number,n:any)=>p+evalExpr(n,ctx),0);
  if ("round"    in node) return Math.round(evalExpr(node.round, ctx));
  if ("floor"    in node) return Math.floor(evalExpr(node.floor, ctx));
  throw new Error("unknown expr node");
}

function resolveFromDoc(doc: Doc, input: ResolveInput): RenderParams {
  const seed = input.seed ?? randomSeed();
  const rng  = mulberry32(seed);                          // == seed.ts
  const baseline = doc.palette.perMood[input.mood];        // == BASELINES[mood]
  const ctx: Ctx = { mood: input.mood,
    controls: { intensity: input.intensity, whimsy: input.whimsy },
    baseline, rng, consts: { MAX_MOTES, MAX_DROPS } };

  const out: any = { seed, style: input.whimsy };
  for (const [name, spec] of Object.entries(doc.render.params)) {
    let v = evalExpr((spec as any).from, ctx);
    if ((spec as any).clamp01) v = clamp01(v);
    if ((spec as any).clampMax) v = Math.min(v, ctx.consts[(spec as any).clampMax]);
    out[name] = v;
  }
  // palette + scatter draw from the SAME rng stream, SAME order as mood.ts:
  out.palette  = buildPalette(rng, paletteParamsFrom(doc.palette, ctx));
  out.moteSeed = rng() * 1000;
  return out as RenderParams;
}
```

The crucial parity invariant: the `rng` calls happen in the *same order* as
`mood.ts` (baseHue inside `buildPalette` first, then the `* 1000` scatter), so a
pinned seed reproduces today's output exactly — including on the Metal port.

---

## 13. Open questions for the owner

1. **"Loggy" → Lottie** confirmed? (Assumed yes; whole doc hinges on it.)
2. **Shader source in-file or referenced?** I recommend referenced (`$ref` to
   `.glsl`/`.metal` in the zip). Do you ever want a single self-contained JSON
   with inlined shader strings (bigger, but one file)?
3. **Outline → SDF for the swappable icon.** Today the checkmark/stroke are baked
   analytic SDFs in GLSL. Letting hosts swap an arbitrary `svgPath` means the
   backend must build an SDF from a path at load (a runtime path→SDF step, or a
   precomputed SDF texture). How far do we want "swap any glyph" to go in v1 vs.
   "choose from a built-in glyph set"?
4. **Envelope: analytic vs sampled.** Keep `envelope()` analytic on each backend
   (exact, but duplicated code) or make the sampled curve authoritative
   (portable, but an approximation)? I leaned "analytic is source of truth, curve
   is the authoring/portable handle" — OK?
5. **Composition** (sequence/overlay multiple effects) — v1 or later? I deferred
   it.
6. **Security**: remote `$ref` for shaders/assets — allowlist only, or forbid
   non-bundled refs entirely for embedded use?
```

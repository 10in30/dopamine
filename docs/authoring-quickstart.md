# Quickstart: author a fully declarative Dopamine effect

The fastest path to a new effect, end to end. It covers the DOMINANT archetype —
a **fully declarative pure-shader effect** (like `ripple`, `aurora`, `inkstroke`,
`halo`, `fail`): you write ONE `.dope` data file and ONE GLSL shader, and the
toolchain generates everything Swift/Metal and Android/OpenGL ES need. No
platform code, no core edits, no shared-file edits.

Read this file alone for the common case. Go deeper only when you need to:
[`docs/README.md`](./README.md) routes every other task to the right doc
section. Reference effects to copy from: `effects/ripple` (simplest one-shot),
`effects/halo` (continuous/looping), `effects/fail` (SDF icon + per-pass
uniforms + custom moods).

## 0. What you are writing

| File | What it is |
|---|---|
| `effects/<name>/<name>.dope.json` | THE effect: feeling→params mapping, palette, timing, per-frame logic, uniform binding — all data, interpreted identically on web/Swift/Android |
| `effects/<name>/web/src/<name>-shader.ts` | GLSL ES 3.00, authored once; MSL + Kotlin variants are generated from it |
| `effects/<name>/web/src/index.ts` | a 3-line registration shim |
| `effects/<name>/web/test/<name>.test.ts` | pins a seed, asserts the resolved params |

A feeling (`mood`, `intensity` 0..1, `whimsy` 0..1, `seed`) resolves through the
`.dope` into a flat param bag; the shared runner sets standard uniforms +
auto-binds each numeric param `x` to uniform `uX`; your shader draws a LIGHT
pass (black = no change, bright = cast light) and, when `uShadow == 1`, a dark
offset silhouette.

## 1. Scaffold

```bash
cp -r effects/ripple effects/sparkle
cd effects/sparkle && mv ripple.dope.json sparkle.dope.json
# in web/: rename ripple-shader.ts → sparkle-shader.ts, fix package.json name
# (@dopaminefx/effect-sparkle), then from the repo root:
npm install                              # link the new workspace package
```

Wire two root entries: add `-w @dopaminefx/effect-sparkle` to the root
`package.json` `build` script, and (to ship it in the batteries-included
bundle) add the package to `packages/effects` deps + re-exports.

## 2. The `.dope` document

Every block below is REQUIRED for the fully declarative path (this skeleton
parses and derives a complete pass config as-is). Grammar reference:
`docs/effect-format.md` §4.1 (mapping), §7.1 (per-frame expressions).

```jsonc
{
  "fmt": "dopamine-effect", "v": "1.0.0", "id": "dopamine.success.sparkle",
  "slug": "sparkle", "kind": "overlay",
  "meta": { "name": "Sparkle", "description": "…", "tags": ["success"] },

  "controls": {
    "mood": { "type": "enum", "default": "celebratory",
              "options": ["serene", "celebratory", "electric"], "ui": "segmented" },
    "intensity": { "type": "scalar", "default": 0.7, "min": 0, "max": 1, "step": 0.01, "ui": "slider" },
    "whimsy": { "type": "scalar", "default": 0.5, "min": 0, "max": 1, "step": 0.01, "ui": "slider" },
    "seed": { "type": "int", "default": null, "nullable": true }
  },

  // One numeric row per mood you declare. durationMs + your shader's knobs +
  // the palette register fields (hueCenter/hueRange/lightness/chroma).
  "baselines": {
    "serene":      { "durationMs": 2200, "lightness": 0.84, "chroma": 0.09, "hueCenter": 230, "hueRange": 120, "spread": 0.5 },
    "celebratory": { "durationMs": 1600, "lightness": 0.80, "chroma": 0.16, "hueCenter": 50,  "hueRange": 320, "spread": 0.8 },
    "electric":    { "durationMs": 1100, "lightness": 0.78, "chroma": 0.23, "hueCenter": 35,  "hueRange": 150, "spread": 1.1 }
  },

  // OKLCH golden-angle palette → the uC0/uC1/uC2 stops. Copy verbatim except
  // perMood (mirror your baselines' register fields).
  "palette": {
    "model": "oklch", "space": "linear-srgb", "generator": "golden-angle",
    "goldenAngleDeg": 137.50776405003785, "stops": 3, "hueSpread": 0.55,
    "lightness": { "baseline": "lightness", "perStop": [0, 0.06, -0.05] },
    "chroma": { "from": { "mul": [{ "baseline": "chroma" }, { "lerp": ["intensity", 0.7, 1.5] }] },
                "perStop": [0, 0.02, -0.01] },
    "seed": { "deterministic": true, "source": "controls.seed", "prng": "mulberry32" },
    "perMood": {
      "serene":      { "hueCenter": 230, "hueRange": 120, "lightness": 0.84, "chroma": 0.09 },
      "celebratory": { "hueCenter": 50,  "hueRange": 320, "lightness": 0.80, "chroma": 0.16 },
      "electric":    { "hueCenter": 35,  "hueRange": 150, "lightness": 0.78, "chroma": 0.23 }
    }
  },

  "tempo": {
    "durationMs": { "from": { "round": { "mul": [{ "baseline": "durationMs" }, { "lerp": ["intensity", 1.1, 0.9] }] } } },
    // Per-frame logic as data: amp feeds uAmp + the shadow geometry. One-shot
    // reward = envelope(life); a CONTINUOUS effect instead declares tempo.loop
    // and a periodic amp of {input:"phase"} — see effects/halo + format §7.2.
    "frame": {
      "amp": { "envelope": [{ "input": "life" }, { "param": "overshoot" }] },
      "extras": {}
    },
    "reducedMotion": { "peakMs": 280, "holdMs": 380 }
  },

  "render": {
    // Feeling → shader knobs. Each numeric param auto-binds to u<Name>.
    "params": {
      "exposure":  { "type": "float", "from": { "lerp": ["intensity", 0.8, 1.5] } },
      "spread":    { "type": "float", "from": { "mul": [{ "baseline": "spread" }, { "lerp": ["intensity", 0.9, 1.2] }] } },
      "overshoot": { "type": "float", "from": { "lerp": ["intensity", 0.7, 1.3] } },
      "style":     { "type": "float", "from": { "control": "whimsy" } }
    },
    // Shadow occluder height (fraction of min canvas dim): number or params-only expr.
    "shadowHeightFrac": 0.5,
    "consts": {},                          // loop caps your clampMax/clampMin reference
    "config": { "usesOrigin": true },      // true ⇒ shader reads uOrigin (anchored radial)
    "backends": { "webgl2": { "stage": "fullscreen-triangle", "blend": "screen",
                              "shader": { "program": "sparkle" } } },
    "fallbackOrder": ["webgl2"]
  },

  // The cross-platform uniform-binding contract (ships in the portable doc).
  "binding": {
    "excludeParams": ["style", "overshoot", "durationMs"],  // resolved params that are NOT shader uniforms
    "scatterKey": "sparkleSeed",   // the per-fire seed-keyed scatter param (always present)
    "scatterWeb": "uSeed",         // omit if the shader doesn't read the scatter
    "extras": [],                  // per-frame/per-pass extras (tempo.frame.extras / render.pass names)
    "samplers": []                 // texture samplers (see fail for the SDF `outline`/`on` source)
  },

  // Toolchain config (stripped from the shipped portable copy).
  "x-build": {
    "shader": { "web": "web/src/sparkle-shader.ts", "vertexExport": "SPARKLE_VERTEX_SRC",
                "fragmentExport": "SPARKLE_FRAGMENT_SRC", "generateMSL": true },
    "swift":   { "module": "DopamineEffectSparkle", "platforms": ["iOS(.v15)", "macOS(.v12)"],
                 "core": { "mode": "path", "package": "Dopamine", "product": "DopamineCore", "path": "swift" } },
    "web":     { "package": "@dopaminefx/effect-sparkle", "sources": "web" },
    "android": { "module": "dopamine-effect-sparkle", "namespace": "ai.dopamine.effect.sparkle" }
  }
}
```

No `swift/` or `android/` folder: with `x-build.shader` + `tempo.frame` +
`render.shadowHeightFrac` + `binding.scatterKey` present, the toolchain
generates the platform factories, shader variants and uniform glue
(`tools/dopamine/src/factory.mjs` refuses with a pointer if a section is missing).

## 3. The shader (`web/src/sparkle-shader.ts`)

GLSL ES 3.00, in the **transpilable subset** (the same source becomes MSL +
Kotlin — `tools/dopamine/src/shader.mjs` THROWS on anything it can't translate,
so the build tells you immediately). Compose the shared look chunks; never
paste your own `fbm`/`paletteMix` copies.

```ts
import { GLSL_CONSTANTS, GLSL_HASH, GLSL_FBM, GLSL_PALETTE_MIX,
         GLSL_TONEMAP_ACES, GLSL_DITHER } from "@dopaminefx/core";

export const SPARKLE_VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const SPARKLE_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2  uResolution;   // device px
uniform vec2  uOrigin;       // anchor, gl coords (y up) — because usesOrigin
uniform float uLife;         // 0..1
uniform float uTimeS;        // seconds (whimsy-snapped "on twos")
uniform float uAmp;          // tempo.frame.amp
uniform float uStyle;        // whimsy: 0 photoreal → 1 cel
uniform float uExposure, uSpread, uSeed;        // your render.params, by name
uniform float uShadow;       // 0 light pass, 1 shadow pass
uniform vec2  uShadowOffset; uniform float uShadowSoft, uShadowStrength;
uniform vec3  uC0, uC1, uC2; // palette stops
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_PALETTE_MIX}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
void main() {
  // …light: sum layers, tonemapACES, ditherAdd; on uShadow > 0.5 output the
  // dark offset silhouette instead. Crib the structure from ripple's shader.
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);
}`;
```

Standard uniforms the runner always provides: `uResolution`, `uTarget`
(targeted element box, device px), `uLife`, `uTimeS`, `uLoopS`/`uPhase`
(periodic clocks, only meaningful with `tempo.loop`), `uStyle`, `uAmp`,
`uC0..2`, `uShadow` + the three shadow-geometry uniforms, and `uOrigin` when
`usesOrigin`. Declare only what you read.

## 4. The factory shim (`web/src/index.ts`)

```ts
import { SPARKLE_FRAGMENT_SRC, SPARKLE_VERTEX_SRC } from "./sparkle-shader.js";
import { parseDope, registerDopeEffect } from "@dopaminefx/core";
import doc from "./sparkle.dope.json";   // the toolchain-synced portable copy

export const sparkle = registerDopeEffect(parseDope(doc as object), {
  vertex: SPARKLE_VERTEX_SRC,
  fragment: SPARKLE_FRAGMENT_SRC,
});
export default sparkle;
```

## 5. The loop: build → test → look at it

```bash
node tools/dopamine/src/cli.mjs build    # sync the portable .dope into web/src/,
                                         # generate dist/ packages + MSL/Kotlin;
                                         # FAILS LOUDLY on shader-subset or .dope errors
npm test                                 # vitest; add web/test/sparkle.test.ts that
                                         # pins a seed and asserts resolved params
npm run dev                              # interactive demo (add your effect to
                                         # examples/demo/src/main.ts EFFECT_LOADERS)
node scripts/shot.mjs 320 -sparkle sparkle   # headless PNG frames — LOOK at them
node tools/dopamine/src/cli.mjs build --check  # CI's staleness gate, run last
```

A seed pins everything: the same `mood × intensity × whimsy × seed` must
resolve to identical numbers on every platform (the loader consumes the PRNG in
a fixed order — never draw extra randomness outside it).

## 6. Pitfalls (the short list)

- `style` is set automatically from whimsy; `durationMs` is tempo, never a
  uniform — list non-uniform numeric params in `binding.excludeParams`.
- The shipped `web/src/<name>.dope.json` is a generated copy — edit only the
  canonical `effects/<name>/<name>.dope.json` and re-run the build.
- External URLs / absolute paths anywhere in the `.dope` fail `parseDope`
  (documents must be self-contained).
- Keep every `mul`/`add` operand order deliberate — expression evaluation order
  is the cross-platform float-parity contract.

## Beyond this quickstart

| You want | Go to |
|---|---|
| a CONTINUOUS / looping effect | `effect-format.md` §7.2 + `effects/halo` |
| an SDF icon (✗, ✓) + per-pass uniforms | `effect-format.md` §8.2 + `effects/fail` |
| your own moods (not the success trio) | `authoring-effects.md` §7.1 + `effects/fail/web/src/index.ts` |
| a Canvas2D-hybrid (sprite panel, lettering) | `authoring-effects.md` §6 + `effects/comic` |
| code-shaped timing / hooks (escape hatches) | `authoring-effects.md` §4 |
| the full field-by-field schema + rationale | `effect-format.md` + `effect-format.schema.json` |

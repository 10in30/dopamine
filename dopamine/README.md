# Dopamine ✨

A library of **gorgeous, next-generation visual effects** — algorithmic color
(unique every time), motion informed by the natural world, hardware-accelerated,
and usable as a component that sits in your page *and* casts real light onto the
UI beneath it. You pick a **mood**, an **intensity**, and an amount of
**whimsy** — not raw parameters.

> **Components (success):** three interchangeable "successful completion" effects
> that share the same `mood` / `intensity` / `whimsy` API and light-casting
> overlay, but speak different visual languages:
> - **`Solarbloom`** — a centered radial volumetric bloom (light radiating from
>   a point). `celebrate()` / `prepareSolarbloom()`.
> - **`Calligraphic Verdict`** — a single confident ink/light *signature stroke*
>   that writes itself across the frame (a downward dip + upward flick: an
>   abstracted check / approving flourish). Directional, asymmetric composition,
>   not concentric. Pressure-modulated brush width, wet-ink bleed, dry-brush
>   bristle, a racing wet tip, flung droplets, and a "signed" underline of light.
>   At `whimsy` 1 it flattens into a flat cel / neon-cyberpunk slash with a
>   glowing rim and animate-on-twos motion. `celebrateInk()` /
>   `prepareInkstroke()`.
> - **`Comic Impact`** — a Golden/Silver-Age comic-book **success shout**: a
>   hand-lettered **affirmation** (picked per-fire from YES!/DONE!/NICE!/OKAY!/
>   WIN!/GREAT!/WOO! — or a big bold **✓ checkmark** — variety = novelty)
>   **slams in** over a jagged starburst with a hard, fast impact + recoil, bold
>   ink outlines, **Ben-Day / halftone dot** shading and **radiating action
>   lines**. A hybrid: the word/checkmark + burst + ink are drawn in an offscreen
>   Canvas2D, the halftone, action lines, flash and styling are a WebGL2 fragment
>   shader. The **lettering varies by mood and whimsy**: mood picks a bundled SIL
>   OFL display face + character (electric → Anton, condensed/hard-italic;
>   celebratory → Bangers, classic exuberant comic; serene → Luckiest Guy,
>   rounded/calmer) and `whimsy` is the **NOIR ↔ POP-ART** axis — `whimsy` 0 =
>   moody chiaroscuro, near-monochrome, clean single-pass inked caps, subtle fine
>   halftone; `whimsy` 1 = saturated screaming Ben-Day dots, fat inflated balloon
>   letters with multi-layer ink + 3D extrude/drop and bouncy per-letter
>   rotation/baseline jitter, snappy animate-on-twos motion. The faces ship
>   bundled (base64 woff2, loaded via `FontFace`) so the effect never depends on a
>   host font. `celebrateComic()` / `prepareComic()`.
>
> Web first; iOS / Android / macOS to follow.

## Why it actually feels good (not just flashy)

The design is grounded in published research:

| Principle | Research | What we do |
|---|---|---|
| Fire within ~100 ms; confirm by ~250 ms | dopamine reward-prediction error timing | checkmark draws in ≤240 ms, effect starts on the trigger frame |
| Quick anticipatory swell → peak (delay shrinks reward) | RPE / temporal discounting | fast attack + held-breath overshoot envelope, no slow builds |
| Saturated + bright + warm = arousal **and** positive valence | Wilms & Oberfeld 2018 | `intensity` drives saturation/brightness; warmer hues for hotter moods |
| Unpredictable reward beats predictable; novelty resists habituation | variable-reward psychology | **unique OKLCH golden-angle palette every fire** |
| Linear motion feels wrong; physical motion calms | NN/g, motion design | spring envelope + buoyant, curling mote paths |

## Usage

Framework-agnostic core:

```ts
import { celebrate } from "@dopamine/core";

await celebrate({ mood: "celebratory", intensity: 0.8, whimsy: 0.6 });
```

Or declaratively, anywhere:

```html
<dopamine-success mood="electric" intensity="0.9"></dopamine-success>
<script type="module">
  import "@dopamine/core";
  document.querySelector("dopamine-success").play();
</script>
```

React:

```tsx
import { DopamineSuccess, useDopamine } from "@dopamine/react";

<DopamineSuccess trigger={orderId} mood="celebratory" intensity={0.8} />;
// or imperatively:
const celebrate = useDopamine();
<button onClick={() => celebrate({ mood: "electric" })}>Done</button>;
```

### API

`celebrate(options)` / `<dopamine-success>` attributes:

| Option | Default | Meaning |
|---|---|---|
| `mood` | `"celebratory"` | `serene` · `celebratory` · `electric` |
| `intensity` | `0.7` | 0..1 — saturation, brightness, bloom size, overshoot |
| `whimsy` | `0.5` | 0..1 — photoreal ↔ non-photoreal (cel / hand-drawn "animate on twos") stylization |
| `seed` | random | pin for reproducible output |
| `origin` | center | viewport-pixel anchor of the bloom |
| `target` | `document.body` | element the overlay covers (light + shadow are cast on what's beneath) |

### Layout — lit content should fill the viewport

Every effect mounts a **full-viewport overlay** — a `screen`-blend light layer and
a `multiply`-blend shadow layer — that casts light and shadow onto whatever sits
beneath it. For the effect to read its best, **the content you want lit should
fill the viewport.** Large empty margins give the light and shadow nothing to
fall on and read as dead space at the edges of the frame.

Two ways to honor this:

- **Full-page effects:** let your page content extend to the edges (avoid a
  narrow centered column with wide empty gutters). The bundled demo does this —
  its scene runs to the edges of the frame.
- **Scoped effects:** pass `target: someElement` so the overlay is bounded to
  that element. The effect then lights *that* element edge-to-edge instead of the
  whole page — ideal for celebrating a card, panel, or modal in place.

## Develop

```bash
npm install
npm test       # unit tests for the color / tempo / mood engine
npm run dev     # interactive demo (mood/intensity/whimsy controls)
npm run build   # build core, react, demo
npm run record  # headless: record solarbloom.webm + .mp4 across all three moods
```

## How it works

- **`@dopamine/core`** — vanilla TS + WebGL2. A single full-screen fragment
  shader (`engine/shader.ts`) renders the bloom, the drifting light motes, and
  the checkmark, all summed as light. The overlay canvas uses
  `mix-blend-mode: screen`, so bright pixels lighten the page → real cast light.
- **Color** (`engine/color.ts`): OKLCH golden-angle palettes → linear sRGB.
- **Tempo** (`engine/tempo.ts`): two-layer timing (fast confirm + lingering,
  non-blocking afterglow), plus an impact/recoil envelope for the comic slam.
- **Mood** (`engine/mood.ts`): maps the three knobs onto shader uniforms.

### Architecture: a thin runtime + pluggable effects

`@dopamine/core` is a small **backbone** with the three effects plugged into it:

- **Conductor** (`framework/conductor.ts`) — owns ONE persistent overlay
  (light `screen` + shadow `multiply` canvas) and ONE program-cached WebGL2
  context per layer, per target. Shaders **link once per page**, not once per
  fire (the old path leaked the per-fire contexts browsers cap at ~16). A single
  RAF loop hosts concurrent fires (additive light / `MIN` shadow), caps DPR,
  pauses on hidden tabs, and honours `prefers-reduced-motion` (one calm held
  frame). Everything is SSR-safe — `celebrate()` off-DOM is a no-op.
- **Effect registry** (`framework/registry.ts`) + **mood registry**
  (`framework/mood-registry.ts`) — effects and moods register by name; moods are
  effect-agnostic, so a new mood lights up every effect.
- **Effects** (`effects/*.ts`) — each is an `EffectFactory` that `resolve`s a
  feeling → params and `create`s a per-frame `renderAt`. `celebrate*` are thin
  wrappers over the generic `play(effect, opts)` / `prepare(effect, opts)`.

**Add a mood** (lights up all three effects, no per-effect code):

```ts
import { registerMood, celebrate } from "@dopamine/core";
registerMood("triumphant", { hueCenter: 280, hueRange: 160,
                             lightness: 0.8, chroma: 0.22, energy: 0.9 });
await celebrate({ mood: "triumphant" });
```

**Add an effect** — implement `EffectFactory` and `registerEffect(...)`; then
`play("my-effect", { mood, intensity, whimsy })`. See `effects/solarbloom.ts`.

### Data-driven effects — the `.dope` format

An effect's mood → params mapping can live in a declarative **`.dope`** JSON
document (`docs/effect-format.md`) instead of code. The loader
(`framework/loader.ts`) evaluates a tiny mapping grammar (`lerp`/`mul`/`baseline`
/`control`/`round`/`clamp…`) + the OKLCH golden-angle palette into the same
render params the shader consumes — with the PRNG consumed in the same order, so
output is byte-identical to the code path (proven by `loader.test.ts`).
Solarbloom + Verdict are **fully** data-driven (`effects/*.dope.json` drive them
through the loader → registry → conductor); Comic is data-driven for its numeric
panel + palette, with its typography + per-fire word composed in code. Shader
bodies stay referenced GLSL — the format references them; it is not a transpiler.

## Roadmap

- More components (progress, error, attention) and animated icons.
- **iOS (SwiftUI + Metal)**, then Android & macOS — porting the same
  color/tempo/mood model. iOS build + simulator recording will run on a macOS
  GitHub Actions runner.

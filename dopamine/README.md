# Dopamine ✨

A library of **gorgeous, next-generation visual effects** — algorithmic color
(unique every time), motion informed by the natural world, hardware-accelerated,
and usable as a component that sits in your page *and* casts real light onto the
UI beneath it. You pick a **mood**, an **intensity**, and an amount of
**whimsy** — not raw parameters.

> **Components (success):** two interchangeable "successful completion" effects
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

**Ethics:** these are the same levers used by addictive design. Dopamine ties
rewards to *genuine accomplishment*, fires once per real completion, and never
manufactures uncertainty to farm engagement. Delight, not compulsion.

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
| `whimsy` | `0.5` | 0..1 — hue spread + motion turbulence |
| `seed` | random | pin for reproducible output |
| `origin` | center | viewport-pixel anchor of the bloom |
| `target` | `document.body` | element the overlay covers (light is cast on what's beneath) |

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
  non-blocking afterglow).
- **Mood** (`engine/mood.ts`): maps the three knobs onto shader uniforms.

## Roadmap

- Shadows (a `multiply` companion layer) in addition to cast light.
- More components (progress, error, attention) and animated icons.
- **iOS (SwiftUI + Metal)**, then Android & macOS — porting the same
  color/tempo/mood model. iOS build + simulator recording will run on a macOS
  GitHub Actions runner.

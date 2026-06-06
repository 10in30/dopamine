# Cross-Pollination Plan — improving each effect with lessons from the others

Status: PLAN / RFC. Date: 2026-06-06.

## Context
Dopamine now has three "successful completion" effects, built largely in
parallel, each sharing the `mood`/`intensity`/`whimsy` API, OKLCH algorithmic
color, the tempo envelope, the light-casting `screen` overlay, and (for two of
three) the new shadow layer:

- **Solarbloom** (`engine/shader.ts` + `renderer.ts`) — a centered radial
  volumetric bloom; light radiating from a point.
- **Calligraphic Verdict** (`engine/inkstroke-shader.ts` + `inkstroke-renderer.ts`)
  — a directional ink/light **gesture** that writes itself across the frame.
- **Comic Impact** (`engine/comic-shader.ts` + `comic-renderer.ts`) — a hybrid
  Canvas2D+WebGL2 comic-panel **hit** with lettering, halftone, action lines.

Because they grew separately, each evolved a distinct capability the other two
lack. This plan (a) inventories those capabilities, (b) identifies the
highest-leverage move — extracting the best ones into **shared modules** — and
(c) gives a concrete, prioritized backlog to improve each effect by borrowing
from the other two. Guiding rule: **borrow capabilities, not looks** — every
change must sharpen an effect's own metaphor, never blur the three together.

## Capability inventory

| Capability | Solarbloom | Verdict | Comic |
|---|:--:|:--:|:--:|
| Volumetric FBM + domain warp | ✅ | edge-only bleed | — |
| Chromatic dispersion / spectral split (`uDispersion`) | ✅ | — | — |
| Iridescent thin-film (IQ cosine palette) | ✅ | — | — |
| God-ray / light shafts | ✅ | — | — |
| GPU particles w/ depth tiers, motion-blur streaks, twinkle | ✅ motes | ⚠️ droplets (ballistic, no streaks) | — |
| ACES tonemap + ordered dither (anti-banding) | ✅ | — | — |
| Directional **gesture** / swept-Bézier path | — | ✅ | — |
| Pressure / dynamics profile (`uPressure`) | — | ✅ | impact only |
| Wet-ink bleed + dry-brush bristle (`uWetness`/`uBristle`) | — | ✅ | — |
| "Writes itself" reveal — fast pen `uDraw` + racing tip | partial (checkmark) | ✅ | — |
| Ballistic spray physics (`uDroplets`, gravity) | — | ✅ | — |
| **Typography / lettering** (word, font, shrink-to-fit) | — | — | ✅ |
| Semantic content (per-fire word/token, seeded) | — | — | ✅ |
| Ben-Day **halftone** screen (`uHalftone`/`uDotSize`) | — | — | ✅ |
| Radiating **action lines** (`uActionLines`) | — | — | ✅ |
| Hard **impact + recoil** timing (`impactScale`/`impactPresence`/`IMPACT_MS`) | — | — | ✅ |
| Bold ink outline / contour (`uInkBoost`) | — | cel only | ✅ |
| **Shadow casting** (`shadow.ts` + multiply layer) | ✅ | ✅ | ❌ (TODO) |
| Cel / neon / animate-on-twos (`uStyle`) | ✅ | ✅ | ✅ |

## The big lever: extract shared capability modules
Most rows above are reimplemented per effect (or absent). The highest-leverage
move — and the natural content of the **backbone refactor** + the `.dopa`
**file format** — is to lift the best implementation of each into a shared,
composable module the effects draw from:

1. **`look/` GLSL chunk library** — `fbm`/`domainWarp`, `dispersion`,
   `iridescent` (IQ cosine), `tonemapACES`+`dither`, `halftone`, `paletteMix`.
   Today these live (and drift) inside `shader.ts`; Verdict/Comic should compose
   the *same* functions, not reinvent them.
2. **Unified particle module** — fold Solarbloom motes + Verdict droplets +
   future comic debris into one parametric GPU particle system (emit shape,
   ballistic/curl motion, depth tiers, streaks, twinkle, lifetime).
3. **Typography/glyph module** — generalize Comic's Canvas2D panel + font +
   checkmark/icon path so *any* effect can render a word or swap an icon. (The
   running comic-typography agent is already enriching this; extract afterward.)
   Maps directly to the format's `geometry.outlines`.
4. **Gesture/reveal primitive** — Verdict's swept-Bézier brush + `uDraw` pen
   progress + racing tip as a reusable "draw a path in light" used for
   checkmarks, words, and underlines.
5. **Envelope library** — add Comic's impact/recoil (`impactScale`,
   `impactPresence`) alongside the held-breath spring in `tempo.ts`, selectable
   per effect. Maps to the format's `tempo.curves`.
6. **Shadow** — already shared (`shadow.ts`); finish Comic adoption.

These map 1:1 onto the file format's `geometry` / `tempo.curves` / `render.params`
vocabulary and onto the backbone's effect/registry — so this plan is also the
concrete spec for both of those efforts.

## Per-effect backlog

### Solarbloom ← Verdict, Comic
- **From Verdict:** an *anticipatory directional in-rush* — light streaks
  converging along a vector before the bloom (reuse the mote streak system) so
  the burst has approach, not just expansion. Adopt the `uDraw` pen + racing tip
  so the checkmark draws with a bright leading head. A few ballistic light-sparks
  flung at peak (droplet physics).
- **From Comic:** optional **success word / richer icon** rendered *in light*
  (shared typography + outline-path swap) — e.g. "DONE" forming inside the
  bloom; a selectable **impact attack** for a punchier electric mood; optional
  **halftone** texture at the high-whimsy (cel) end for a printed look.

### Verdict ← Solarbloom, Comic
- **From Solarbloom:** **volumetric interior** (FBM domain-warp *inside* the
  stroke, not just edge bleed); **dispersion + iridescence on the wet edge**
  (oil-on-water sheen — gorgeous on the wet/serene end); **depth-layered droplets
  with motion-blur streaks + twinkle**; **ACES tonemap + dither** for cleaner
  gradients; **god-ray shafts** along the stroke.
- **From Comic:** let the signature **write a real success word** in a
  script/hand face (shared typography) — a literally *signed* "Yes/Done", not
  only an abstract flourish; **bold ink-outline** option + **impact recoil** on
  the terminal flick; **halftone** at the cel end.

### Comic ← Solarbloom, Verdict
- **From Solarbloom:** replace the flat `uFlash` with a real **volumetric bloom +
  god-rays** behind the burst (luminous slam); **chromatic dispersion** on letter
  edges (cyberpunk) + **iridescent foil** on the lettering; **mote/debris sparks**
  flying off impact (streaked particles); **ACES** finish. **Adopt the shared
  shadow** (Comic casts none yet — the word + starburst should drop a shadow;
  ~thread `overlay.shadow` + a cheap occlusion branch, like the other two).
- **From Verdict:** a **gestural entrance** — draw/sweep the starburst & word
  strokes in (`uDraw` reveal) or slam them along a directional path rather than
  scaling in place; **ballistic ink/debris droplets** off the impact;
  **wet-ink edge** quality on the contours at the noir end.

## Sequencing & priority
- **P0 — cheap, isolated, high impact:** Comic shadow adoption; ACES+dither into
  Verdict & Comic; dispersion/iridescence onto Verdict's wet edge.
- **P1 — shared extraction (do with the backbone refactor):** `look/` GLSL chunk
  library; unified particle module; impact envelope into `tempo.ts`.
- **P2 — bigger features:** shared typography/glyph module (Solarbloom word,
  Verdict signature); gesture/reveal primitive; directional entrances.

Each step is gated on the guiding rule: does it strengthen this effect's identity
(radial light / written gesture / printed hit), or dilute it? If it blurs the
three together, don't.

## Verification
Per change: single-frame stills across the 3 moods × {whimsy 0, 1} (read them),
plus a 60fps offline render (`scripts/render-*.mjs`) for motion; unit tests for
any new pure logic; `npm test` + `npm run build` green; Solarbloom/Verdict/Comic
all still distinct in a side-by-side.

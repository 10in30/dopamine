# @dopaminefx/effect-checkmate

## 0.3.0

### Minor Changes

- Retune the `intensity` control across every effect.

  Intensity now drives only the effect's **size** and **element count** — never its
  speed/playback tempo, which derives solely from mood:

  - **Size**: glyph effects (solarbloom, heartburst, comic) scale their glyph over a
    40%→100% range with the authored size as the max; checkmate's icon follows the
    same 40% floor. Non-glyph footprints scale toward the low end (e.g. confetti's
    `spread` is linear, `launchSpeed` floors at 40%).
  - **Count**: element counts (confetti pieces, solarbloom motes, heartburst hearts,
    comic spikes/lines, inkstroke droplets, aurora rays, dots, ripple rings,
    lightning forks, checkmate rays) floor at a small minimum for any non-zero
    intensity and reach the per-mood maximum at full intensity.
  - **Speed/timing**: `durationMs` and all motion-rate params (sway, chase, spin,
    flutter, ripple/wave speed, turbulence) no longer depend on intensity.

  Hosts own the hard off-switch: intensity 0 should not fire the effect at all.

## 0.2.0

### Minor Changes

- [#44](https://github.com/10in30/dopamine/pull/44) [`1136011`](https://github.com/10in30/dopamine/commit/11360112d2cc58c393057a4805aa7bd8e5d3076e) Thanks [@joshuamckenty](https://github.com/joshuamckenty)! - Add **checkmate** — a pride-rainbow chess-queen success effect (a chess queen pops in with an overshoot bounce amid an expanding rainbow swoosh, a spinning pride sunburst, and twinkling sparkle bling; high whimsy posterizes the rainbow into the 6-stripe pride flag). The new `@dopaminefx/effect-checkmate` package is published and registered in the batteries-included `@dopaminefx/effects` umbrella.

  Also unify every effect registry — the umbrella, the demo picker, the README gallery, the reel/media capture, and the Swift + Android demo registries — behind ONE folder-discovered effect list (`scripts/lib/effects.mjs` + `scripts/gen-registries.mjs`), so a new effect lights up everywhere from its `effects/<name>/` folder and no registry can drift.

### Patch Changes

- Updated dependencies [[`e24310d`](https://github.com/10in30/dopamine/commit/e24310d1b227434ff31cedd3db03063000baf06b)]:
  - @dopaminefx/core@0.2.0

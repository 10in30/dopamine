# @dopaminefx/effect-heartburst

## 0.2.0

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

## 0.1.1

### Patch Changes

- Updated dependencies [[`e24310d`](https://github.com/10in30/dopamine/commit/e24310d1b227434ff31cedd3db03063000baf06b)]:
  - @dopaminefx/core@0.2.0

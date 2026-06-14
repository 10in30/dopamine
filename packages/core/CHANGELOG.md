# @dopaminefx/core

## 0.2.0

### Minor Changes

- [#39](https://github.com/10in30/dopamine/pull/39) [`e24310d`](https://github.com/10in30/dopamine/commit/e24310d1b227434ff31cedd3db03063000baf06b) Thanks [@joshuamckenty](https://github.com/joshuamckenty)! - Add a `backdrop` option for compositing effects on light (and arbitrary-colour) surfaces.

  The light layer composites with `mix-blend-mode: screen`, which is rich on a dark UI but mathematically invisible on white — so effects looked cropped/absent on light backgrounds. Pass `backdrop` (any CSS colour string, e.g. `"#ffffff"`, `"rgb(20 24 37)"`) on `play`/`prepare` and the runtime switches the light layer to premultiplied source-over light, which stays visible on any surface. A saturation + presence boost ramps with the surface's luminance so soft glows read as colour instead of washing out, and the multiply shadow strengthens as the surface lightens. Omitting `backdrop` is unchanged (the classic dark/`screen` path), so existing behaviour is byte-identical.

---
"@dopaminefx/core": minor
---

Add a `backdrop` option for compositing effects on light (and arbitrary-colour) surfaces.

The light layer composites with `mix-blend-mode: screen`, which is rich on a dark UI but mathematically invisible on white — so effects looked cropped/absent on light backgrounds. Pass `backdrop` (any CSS colour string, e.g. `"#ffffff"`, `"rgb(20 24 37)"`) on `play`/`prepare` and the runtime switches the light layer to premultiplied source-over light, which stays visible on any surface. A saturation + presence boost ramps with the surface's luminance so soft glows read as colour instead of washing out, and the multiply shadow strengthens as the surface lightens. Omitting `backdrop` is unchanged (the classic dark/`screen` path), so existing behaviour is byte-identical.

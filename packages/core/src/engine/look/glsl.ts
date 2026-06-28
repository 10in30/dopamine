/**
 * Shared GLSL "look" chunk library.
 *
 * The three effects grew in parallel and each re-implemented (and drifted) the
 * same building blocks inside its own shader: value-noise + fbm + domain warp,
 * the palette mix, the segment SDF, the ACES tonemap, the IQ-cosine iridescence,
 * the Ben-Day halftone and the ordered dither. Per the cross-pollination plan,
 * those are lifted here into ONE canonical copy each, so every shader composes
 * the SAME function instead of a private fork. Effects assemble their fragment
 * source by concatenating the chunks they need ahead of their own `main()`.
 *
 * Each chunk is a self-contained GLSL snippet (no `#version`/`precision`/IO —
 * those stay in the per-effect shader). The text below is byte-identical to the
 * canonical implementations the effects already shipped, so adopting the library
 * does not change any effect's look; it only removes the duplication + drift.
 *
 * NOTE: This is a GLSL *chunk* library (string includes), not a transpiler — it
 * maps onto the `.dope` format's referenced shader bodies (the format references
 * GLSL; it does not generate it).
 */

/** TAU + a couple of constants every effect uses. */
export const GLSL_CONSTANTS = /* glsl */ `
#define TAU 6.28318530718
`;

/**
 * Hash helpers (Dave Hoskins style) — `hash11` (1→1) and `hash21` (1→2). Used
 * by the noise field, the particles, and the per-frame dither.
 */
export const GLSL_HASH = /* glsl */ `
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 hash21(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`;

/**
 * Value noise + 4-octave fbm with a per-octave rotation (kills axis-aligned
 * artifacts). Requires GLSL_HASH. This is the volumetric texture source for the
 * bloom interior and the wet-ink edge wobble.
 */
export const GLSL_FBM = /* glsl */ `
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash11(dot(i, vec2(1.0, 57.0)));
  float b = hash11(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = hash11(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = hash11(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = rot * p * 2.03; a *= 0.5; }
  return s;
}
`;

/**
 * Two-level domain warp: warp the sample point by an fbm-derived offset, then
 * sample fbm again — the smoke-like living interior of a real bloom. Returns the
 * warped fbm value at `p`; `t` is time, `amount` the warp strength. Requires
 * GLSL_FBM.
 */
export const GLSL_DOMAIN_WARP = /* glsl */ `
float domainWarp(vec2 p, float t, float amount){
  vec2 warp = vec2(fbm(p + t * 0.18), fbm(p.yx - t * 0.12)) - 0.5;
  return fbm(p + warp * 1.2 * amount + t * 0.25);
}
`;

/** 3-stop palette mix (inner→mid→outer). Effects declare uC0/uC1/uC2 uniforms. */
export const GLSL_PALETTE_MIX = /* glsl */ `
vec3 paletteMix(float t){
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uC0, uC1, t * 2.0) : mix(uC1, uC2, (t - 0.5) * 2.0);
}
`;

/**
 * Inigo Quilez cosine palette — a smooth spectral sweep used for thin-film
 * iridescence (oil-on-water sheen): cycles through complementary hues, NOT the
 * mood palette, so it reads as an iridescent film over the mark.
 */
export const GLSL_IRIDESCENT = /* glsl */ `
vec3 iridescent(float t){
  return 0.55 + 0.45 * cos(TAU * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)));
}
`;

/**
 * Spectral dispersion amount at a refractive edge — grows toward the rim and
 * with amplitude, gated by a 0..1 strength. `dn` is normalized radius/edge
 * proximity (1 == edge); used to sample a profile at channel-shifted positions.
 */
export const GLSL_DISPERSION = /* glsl */ `
float dispersionAmount(float strength, float dn, float amp){
  return strength * (0.06 + 0.12 * smoothstep(0.2, 1.1, dn)) * (0.7 + 0.5 * amp);
}
`;

/** Capsule/segment SDF (the safe variant — guards zero-length segments). */
export const GLSL_SD_SEG = /* glsl */ `
float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
  return length(pa - ba * h);
}
`;

/**
 * ACES filmic tonemap (Narkowicz) — richer highlight rolloff than `x/(1+x)`,
 * keeps highlights from going chalky while preserving saturated mid-lights.
 */
export const GLSL_TONEMAP_ACES = /* glsl */ `
vec3 tonemapACES(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
`;

/**
 * Ordered/triangular-hash dither, ~1/255, to break the smooth-gradient banding
 * the screen blend reveals on the page beneath. `frag` device px, `t` seconds,
 * `fade` 0..1 (1 = full dither; effects fade it out toward the cel/pop end where
 * hard bands are intended). Requires GLSL_HASH.
 */
export const GLSL_DITHER = /* glsl */ `
vec3 ditherAdd(vec3 col, vec2 frag, float t, float fade){
  float dz = hash11(dot(frag, vec2(12.989, 78.233)) + t) - 0.5;
  return col + (dz / 255.0) * fade;
}
`;

/**
 * Ben-Day halftone coverage: 1 inside a dot, 0 outside, antialiased. Dot RADIUS
 * grows with tone `v`; the screen is rotated by `ang` (classic per-channel
 * screen angle). Requires the matrix helper below.
 */
export const GLSL_ROT2 = /* glsl */ `
mat2 rot2(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
`;

export const GLSL_HALFTONE = /* glsl */ `
float benday(vec2 frag, float cell, float v, float ang){
  vec2 p = rot2(ang) * frag / cell;
  vec2 g = fract(p) - 0.5;
  float d = length(g);
  float r = 0.52 * sqrt(clamp(v, 0.0, 1.0));
  float aa = 0.7 / cell + fwidth(d);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}
`;

/**
 * PREMULTIPLIED LIGHT OUT — the portable compositing emit.
 *
 * The default web overlay leans on CSS `mix-blend-mode: screen` to cast the
 * effect's light onto the page, which is rich on a dark UI but mathematically
 * invisible on white (`screen(x, 1) == 1`). The native stacks (iOS/Android) have
 * no per-surface screen blend, so they instead emit PREMULTIPLIED light — `rgb`
 * unchanged, `alpha = its own brightness` — and let the OS composite it
 * source-over: dark regions go transparent (the host shows through), bright
 * light reads as cast colour, and crucially it stays visible on ANY backdrop,
 * white included. This is byte-identical to Android's `Look.kt` `dopLightOut`.
 *
 * The web runtime reuses this for its "backdrop"-aware compositing path: when a
 * caller passes a known surface colour, the light pass swaps its opaque
 * `vec4(col, 1.0)` emit for `dopLightOut(col)` and composites source-over
 * (`mix-blend-mode: normal`) instead of screen — see `pass-common.ts`'s
 * `compositeLightFragment`.
 */
export const GLSL_LIGHT_OUT = /* glsl */ `
vec4 dopLightOut(vec3 col){
  col = max(col, 0.0);
  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  return vec4(col, a);
}
`;

/**
 * BACKDROP-BOOSTED premultiplied light out.
 *
 * Plain `dopLightOut` (above) composites source-over, which is vivid on a dark
 * surface but MUDDY on a light one: a soft glow is a broad field of low-value
 * colour, and source-over paints that whole field as a semi-opaque wash that
 * mixes with the light page into a dull brown/grey smear. The fix is NOT to make
 * the wash cover MORE (that's what muddied it) — it's to keep only the STRONG
 * light and make the colour that survives read as vivid hue:
 *   - SATURATION boost — pull the colour away from its own luma so what shows is
 *     a clean chromatic hue, not a greyed pastel, and
 *   - PRESENCE GAMMA — raise alpha to a power > 1 so the broad dim halo falls
 *     away toward transparent (the page stays clean) while bright cores (alpha
 *     ≈ 1) are untouched. This is the inverse of the old presence *lift*, which
 *     inflated the dim halo and was the source of the muddiness.
 *
 * Both ramp with `backdropExpr` — a GLSL float expression for the backdrop
 * relative luminance, 0 (black) .. 1 (white). At 0 this is byte-FOR-byte
 * equivalent to plain `dopLightOut` (`sat = 1`, `gamma = 1`), so a dark backdrop —
 * or no backdrop — is unchanged. The web path bakes the luminance in as a
 * literal (`dopLightOutGLSL("0.81")`); the native stacks pass a uniform
 * (`dopLightOutGLSL("uBackdropLum")`), so the LOOK matches across platforms from
 * one math definition.
 */
export const DOP_LIGHT_SAT_GAIN = 1.1;
export const DOP_LIGHT_ALPHA_GAMMA = 1.6;

/**
 * DIRECT-MARK light out — for effects that draw a legible GLYPH / INK (a
 * checkmark, a lettered word + outline) on top of a glow.
 *
 * The glow is emitted as light (the usual model: vivid on dark, and on a light
 * backdrop boosted exactly like `dopLightOut`). But a GLYPH encoded as light
 * VANISHES on a light surface — bright-white-on-white, or "ink as the absence of
 * light" which on a light page is just the page. So the mark gets its OWN path:
 *   - DARK backdrop (`uBackdropLum <= 0`): byte-identical to the plain opaque
 *     emit `vec4(glow, 1.0)` — the mark stays fused into `glow` as light, exactly
 *     as before. Dark mode is UNTOUCHED.
 *   - LIGHT backdrop: composite the mark as a DIRECT, source-over colour over the
 *     (boosted) glow — `markInk` at coverage `markA` — so a dark ink reads as a
 *     solid, legible mark on the light page (its alpha is driven by coverage, not
 *     by the colour's brightness, which is what `dopLightOut` cannot do).
 *
 * The effect supplies `markInk` (the backdrop-appropriate ink colour) and `markA`
 * (the glyph/ink coverage 0..1). `uBackdropLum` is the standard uniform (web:
 * set by the runners; native: `u.backdropLum`). The glow boost mirrors
 * `dopLightOutGLSL` from the SAME gain consts, so the two can't drift.
 */
export const GLSL_MARK_OUT = /* glsl */ `
vec4 dopMarkOut(vec3 glow, vec3 markInk, float markA){
  glow = max(glow, 0.0);
  float bk = clamp(uBackdropLum, 0.0, 1.0);
  // DARK: premultiplied light (alpha = brightness) — matches the native overlay's
  // source-over convention. On web the dark canvas is opaque (alpha ignored), so
  // the RGB is byte-identical to the old \`vec4(glow, 1.0)\`; the alpha only matters
  // on the native self-contained overlay, which composites premultiplied.
  if (bk <= 0.0) return vec4(glow, clamp(max(max(glow.r, glow.g), glow.b), 0.0, 1.0));
  float luma = dot(glow, vec3(0.2126, 0.7152, 0.0722));
  vec3 gcol = max(mix(vec3(luma), glow, 1.0 + bk * ${DOP_LIGHT_SAT_GAIN.toFixed(3)}), 0.0);
  float ga = clamp(max(max(gcol.r, gcol.g), gcol.b), 0.0, 1.0);
  ga = pow(ga, 1.0 + bk * ${DOP_LIGHT_ALPHA_GAMMA.toFixed(3)});
  float mA = clamp(markA, 0.0, 1.0) * bk;
  vec3 outRgb = mix(gcol, max(markInk, 0.0), mA);
  float outA = mix(ga, 1.0, mA);
  return vec4(outRgb, outA);
}
`;

export function dopLightOutGLSL(backdropExpr: string): string {
  return /* glsl */ `
vec4 dopLightOut(vec3 col){
  col = max(col, 0.0);
  float backdrop = clamp(${backdropExpr}, 0.0, 1.0);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(luma), col, 1.0 + backdrop * ${DOP_LIGHT_SAT_GAIN.toFixed(3)}), 0.0);
  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  a = pow(a, 1.0 + backdrop * ${DOP_LIGHT_ALPHA_GAMMA.toFixed(3)});
  return vec4(col, a);
}
`;
}

// Shared GLSL "look" chunk library — port of `engine/look/glsl.ts` +
// `look/particles.glsl.ts`.
//
// GENERALIZATION WIN over the swift/Metal port: Android's OpenGL ES 3.0 uses
// GLSL ES 3.00 — the SAME shading language as WebGL2 — so these chunks are the
// web's byte-identical GLSL, and they live ONCE here in the portable core (the
// Metal port had to hand-port them to MSL and COPY `DopamineLook.metal` into
// every effect package). Each effect's shader composes the chunks it needs ahead
// of its own `main()`, exactly like the web (`shader = "#version 300 es … " +
// GLSL_HASH + …`).
//
// Each chunk is self-contained (no `#version`/`precision`/IO — those stay in the
// per-effect shader). The text is byte-identical to the web canonical chunks, so
// adopting the library does not change any effect's look.

package ai.dopamine.core

/** The standard full-screen-triangle vertex shader (no VBO — uses gl_VertexID). */
const val GLSL_FULLSCREEN_VERTEX: String = """#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}"""

/** TAU + a couple of constants every effect uses. */
const val GLSL_CONSTANTS: String = """
#define TAU 6.28318530718
"""

/** Hash helpers (Dave Hoskins style) — `hash11` (1→1) and `hash21` (1→2). */
const val GLSL_HASH: String = """
float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 hash21(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
"""

/** Value noise + 4-octave fbm with a per-octave rotation. Requires GLSL_HASH. */
const val GLSL_FBM: String = """
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
"""

/** Two-level domain warp (the smoke-like living interior). Requires GLSL_FBM. */
const val GLSL_DOMAIN_WARP: String = """
float domainWarp(vec2 p, float t, float amount){
  vec2 warp = vec2(fbm(p + t * 0.18), fbm(p.yx - t * 0.12)) - 0.5;
  return fbm(p + warp * 1.2 * amount + t * 0.25);
}
"""

/** 3-stop palette mix (inner→mid→outer). Effects declare uC0/uC1/uC2 uniforms. */
const val GLSL_PALETTE_MIX: String = """
vec3 paletteMix(float t){
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uC0, uC1, t * 2.0) : mix(uC1, uC2, (t - 0.5) * 2.0);
}
"""

/** Inigo Quilez cosine palette — a smooth spectral sweep for thin-film iridescence. */
const val GLSL_IRIDESCENT: String = """
vec3 iridescent(float t){
  return 0.55 + 0.45 * cos(TAU * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)));
}
"""

/** Spectral dispersion amount at a refractive edge. */
const val GLSL_DISPERSION: String = """
float dispersionAmount(float strength, float dn, float amp){
  return strength * (0.06 + 0.12 * smoothstep(0.2, 1.1, dn)) * (0.7 + 0.5 * amp);
}
"""

/** Capsule/segment SDF (the safe variant — guards zero-length segments). */
const val GLSL_SD_SEG: String = """
float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
  return length(pa - ba * h);
}
"""

/** ACES filmic tonemap (Narkowicz). */
const val GLSL_TONEMAP_ACES: String = """
vec3 tonemapACES(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
"""

/** Ordered/triangular-hash dither, ~1/255. Requires GLSL_HASH. */
const val GLSL_DITHER: String = """
vec3 ditherAdd(vec3 col, vec2 frag, float t, float fade){
  float dz = hash11(dot(frag, vec2(12.989, 78.233)) + t) - 0.5;
  return col + (dz / 255.0) * fade;
}
"""

/** 2x2 rotation matrix helper (for the halftone screen). */
const val GLSL_ROT2: String = """
mat2 rot2(float a){ float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
"""

/** Ben-Day halftone coverage. Requires GLSL_ROT2. */
const val GLSL_HALFTONE: String = """
float benday(vec2 frag, float cell, float v, float ang){
  vec2 p = rot2(ang) * frag / cell;
  vec2 g = fract(p) - 0.5;
  float d = length(g);
  float r = 0.52 * sqrt(clamp(v, 0.0, 1.0));
  float aa = 0.7 / cell + fwidth(d);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}
"""

/** Shared GPU-particle primitives (mote/droplet sprite, ballistic arc, fade). */
const val GLSL_PARTICLES: String = """
float particleSprite(float d, float size){
  float s = size / (d + size * 0.5);
  return s * s;
}
vec2 ballisticPos(vec2 origin, vec2 dir, float speed, float gravity, float t){
  return origin + dir * speed * t - vec2(0.0, 1.0) * gravity * t * t;
}
float particleFade(float t, float tailPow){
  return (1.0 - pow(t, tailPow)) * smoothstep(0.0, 0.08, t);
}
"""

/**
 * ANDROID OVERLAY OUTPUT CONVENTION (the one platform divergence from web).
 *
 * The web composites the light canvas over the page with CSS `mix-blend-mode:
 * screen`. Android (like Core Animation on iOS — see swift's MetalOverlayHost)
 * has no per-surface screen-blend against arbitrary view content, so the
 * `DopamineView` overlay is SELF-CONTAINED: a translucent surface, cleared to
 * transparent, additively accumulating PREMULTIPLIED light. So a shader's final
 * pixel must be premultiplied with alpha = its own brightness — dark regions go
 * transparent (the host shows through) and bright light reads as cast light.
 *
 * Solarbloom's web shader already emits exactly this (`vec4(col, maxChannel)`).
 * For effects whose web shader emits `vec4(col, 1.0)` (opaque, relying on the CSS
 * screen blend), the Android shader ends with `fragColor = dopLightOut(col);`
 * instead — the ONLY change from the web GLSL. The RGB look stays byte-identical.
 */
// `uBackdropLum` (0 dark .. 1 white) is the backdrop relative luminance the
// overlay composites against; GlPassRunner sets it by name from the public
// backdrop option (0 by default ⇒ no boost ⇒ the dark look is unchanged). On a
// light surface the BOOST keeps soft glows reading as colour: saturate the light
// away from its own luma + lift faint alphas so the colour covers more (darkening
// the page toward it). This MIRRORS the web `dopLightOutGLSL`
// (packages/core/src/engine/look/glsl.ts; SAT gain 0.6, LIFT gain 0.8) and the
// Metal light-out tail, so the LOOK matches across platforms.
const val GLSL_LIGHT_OUT: String = """
uniform float uBackdropLum;
vec4 dopLightOut(vec3 col){
  col = max(col, 0.0);
  float bk = clamp(uBackdropLum, 0.0, 1.0);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(luma), col, 1.0 + bk * 0.6), 0.0);
  float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
  a = clamp(a * (1.0 + bk * 0.8), 0.0, 1.0);
  return vec4(col, a);
}
"""

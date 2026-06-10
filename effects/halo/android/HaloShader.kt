// GLSL ES 3.00 source for Halo — the web `halo-shader.ts` reused VERBATIM
// (Android OpenGL ES 3.0 speaks the same GLSL ES 3.00 as WebGL2). The shared
// "look" chunks come from `dopamine-core` (one canonical copy). The ONLY change
// from the web body is the final LIGHT-pass emit: `dopLightOut(col)`
// (premultiplied alpha = brightness) instead of the web's `vec4(max(col,0.0),
// 1.0)`, because the Android overlay is self-contained (no CSS screen-blend
// against the page — see Look.kt). The RGB look is byte-identical to web; the
// `uShadow` branch is left unchanged for contract parity (the single-surface host
// renders light only).
//
// One full-screen pass renders the calm "loading" halo, all summed as light: a
// soft luminous RING that gently breathes + rotates, a wide dim ambient GLOW under
// it, and a brighter highlight ARC sweeping around it (the loading cue). A filmic
// ACES-ish tonemap + ordered dither finish the frame; a cel branch (whimsy) hard-
// flattens the ring + sweep.
//
// CONTINUOUS / LOOPING: every periodic function is keyed off uTimeS with period =
// uPeriod (1.5 s), and the `.dope` makes durationMs (6000) an integer multiple of
// the period — so the loop is SEAMLESS (the frame at t==durationMs equals t==0 at
// every whimsy; the on-twos snap is itself periodic). uAmp is a STEADY periodic
// breathe gate (NOT envelope(life)) — see Halo.kt / HaloTempo.kt.

package ai.dopamine.effect.halo

import ai.dopamine.core.GLSL_CONSTANTS
import ai.dopamine.core.GLSL_DITHER
import ai.dopamine.core.GLSL_FBM
import ai.dopamine.core.GLSL_FULLSCREEN_VERTEX
import ai.dopamine.core.GLSL_HASH
import ai.dopamine.core.GLSL_LIGHT_OUT
import ai.dopamine.core.GLSL_PALETTE_MIX
import ai.dopamine.core.GLSL_ROT2
import ai.dopamine.core.GLSL_TONEMAP_ACES

// Halo's frag reads `gl_FragCoord`, so the standard fullscreen vertex (which also
// exposes `vUv`, unused here) is fine — its `gl_Position` is identical to the web
// halo vertex, matching the web. (Same situation as Ripple.)
val HALO_VERTEX_SRC: String = GLSL_FULLSCREEN_VERTEX

val HALO_FRAGMENT_SRC: String = """#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;    // device pixels
uniform vec2  uOrigin;        // ring centre, gl coords (y up)
uniform float uAmp;           // STEADY periodic breathe gate (~0.85..1.0), not an envelope
uniform float uLife;          // whole-effect progress 0..1 (UNUSED for motion — see header)
uniform float uTimeS;         // elapsed seconds (snapped "on twos" by style) — drives ALL motion
uniform float uExposure;
uniform float uRingRadius;    // base ring radius as a fraction of min viewport dim
uniform float uRingWidth;     // ring thickness as a fraction of min viewport dim
uniform float uBreathe;       // 0..1 breathe depth (radius/brightness sine swing)
uniform float uSweepArc;      // 0..1 angular half-width of the traveling highlight arc (× PI)
uniform float uSweepTurns;    // integer turns the sweep winds per loop period (keeps it periodic)
uniform float uGlow;          // 0..1 ambient under-glow brightness
uniform float uPeriod;        // loop period in seconds (1.5) — the base of every periodic fn
uniform float uStyle;         // 0..1 photoreal soft glow -> cel/flat banded ring (whimsy)
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette (away from light)
uniform float uShadowSoft;    // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // ring core color
uniform vec3  uC1;            // mid
uniform vec3  uC2;            // sweep accent

${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_PALETTE_MIX}
${GLSL_ROT2}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_LIGHT_OUT}

// The breathing ring's live radius. A slow sine of period uPeriod swings the
// radius by ±uBreathe·ringWidth around the base — the gentle in/out "breath".
// Periodic in uTimeS, so it returns to its t=0 value after each period.
float liveRadius(){
  float ph = TAU * uTimeS / max(uPeriod, 1e-3);
  return uRingRadius + sin(ph) * uBreathe * uRingWidth * 1.6;
}

// Coverage 0..1 of the soft annulus at normalized radius rn (= r / minDim).
// A gaussian falloff across the ring wall gives the photoreal soft-glow look.
float ringCoverage(float rn, float radius, float halfW){
  float d = abs(rn - radius);
  return exp(-(d * d) / (2.0 * halfW * halfW + 1e-6));
}

// The whole halo's emitted light at a fragment (shared by the light pass; the
// shadow pass reuses ringCoverage for its silhouette).
vec3 haloLight(vec2 frag, float minDim){
  vec2 rel = (frag - uOrigin) / minDim;       // normalized, origin-centred
  float rn = length(rel);
  // Slowly ROTATE the angular reference frame (one full turn per period) so the
  // hue drift + texture creep ride around the loop. Periodic in uTimeS.
  float rot = TAU * uTimeS / max(uPeriod, 1e-3);
  vec2 rdir = rot2(rot) * rel;
  float ang = atan(rdir.y, rdir.x);            // -PI..PI in the rotating frame
  float angN = ang / TAU + 0.5;                // 0..1 around the ring

  float radius = liveRadius();
  float halfW = max(uRingWidth, 1e-3);

  // The breathe also gently modulates overall brightness (brighter on the inhale).
  float breatheB = 1.0 + sin(TAU * uTimeS / max(uPeriod, 1e-3)) * uBreathe * 0.5;
  float gain = uAmp * uExposure * breatheB;

  // Colour register: hue drifts AROUND the ring (OKLCH C0->C1->C2 over a full
  // turn, mirrored back) + a faint fbm break so it never looks like a flat gradient.
  float tcol = abs(fract(angN + uTimeS * 0.03) * 2.0 - 1.0);
  tcol = clamp(tcol + (fbm(rdir * 6.0 + uTimeS * 0.05) - 0.5) * 0.12, 0.0, 1.0);
  vec3 ringCol = paletteMix(tcol);

  vec3 col = vec3(0.0);

  // ---- 1. RING: the soft luminous annulus. ----
  float cov = ringCoverage(rn, radius, halfW);
  col += ringCol * cov * gain;

  // ---- 2. GLOW: a wide, dim ambient halo under the ring. ----
  float glow = exp(-(rn * rn) / (2.0 * (radius * 0.85) * (radius * 0.85) + 1e-4));
  col += ringCol * glow * uGlow * gain * 0.28;

  // ---- 3. SWEEP: a brighter highlight arc winding around the ring (loading). ----
  // The arc HEAD travels at a constant angular speed of uSweepTurns turns per
  // period (an INTEGER -> seamless). ad is the angular distance ahead of the
  // head (0 at the head, growing around the ring); a comet taper makes the head
  // bright with a trail fading behind it. Confined to the ring wall by cov.
  float head = fract(uTimeS / max(uPeriod, 1e-3) * uSweepTurns);     // 0..1 head position
  float ad = fract(angN - head + 1.0);                               // 0..1 ahead-of-head distance
  float arcHalf = max(uSweepArc, 0.02);
  float sweepMask = exp(-ad / (arcHalf * 0.9 + 1e-3)) * cov;          // comet head + trail
  vec3 sweepCol = mix(uC2, vec3(1.0), 0.4);
  col += sweepCol * sweepMask * gain * 1.15;

  return col;
}

// ---------------------------------------------------------------------------
// SHADOW silhouette — the ring is a thin floating loop, so it casts a faint soft
// occlusion of its annulus. We sample the ring coverage at the offset shadow
// point and darken in proportion, kept subtle (a thin loop throws little shadow).
float haloOcclusion(vec2 frag, float minDim){
  vec2 rel = (frag - uOrigin) / minDim;
  float rn = length(rel);
  float cov = ringCoverage(rn, liveRadius(), max(uRingWidth, 1e-3));
  return clamp(cov * uAmp, 0.0, 1.0);
}

vec4 haloShadowColor(vec2 frag, float minDim){
  vec2 sp = frag - uShadowOffset;
  float soft = uShadowSoft;
  float occ = haloOcclusion(sp, minDim);
  occ += haloOcclusion(sp + vec2( soft, 0.0), minDim);
  occ += haloOcclusion(sp + vec2(-soft, 0.0), minDim);
  occ += haloOcclusion(sp + vec2(0.0,  soft), minDim);
  occ += haloOcclusion(sp + vec2(0.0, -soft), minDim);
  occ /= 5.0;
  // A thin loop throws little shadow, so cap the darkening well below full.
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength * 0.45;
  vec3 tint = mix(vec3(1.0), 0.6 + 0.4 * normalize(uC0 + 1e-3), 0.2);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);

  if (uShadow > 0.5) {
    fragColor = haloShadowColor(frag, minDim);
    return;
  }

  vec3 col = haloLight(frag, minDim);

  // ---- Tone + finishing ----
  col = tonemapACES(col * 0.95);

  // ---- Non-photoreal pass: cel / flat banded ring (whimsy). ----
  // Toward the cel end the soft glow becomes a hard flat BAND and the sweep snaps
  // into a posterized arc. The pass-runner already steps the clock "on twos"
  // (periodic, so the loop seam survives); here we flatten the tone.
  if (uStyle > 0.001) {
    vec2 rel = (frag - uOrigin) / minDim;
    float rn = length(rel);
    float radius = liveRadius();
    float halfW = max(uRingWidth, 1e-3);
    float cov = ringCoverage(rn, radius, halfW);
    // Rotating angle for the cel hue + cel sweep (matches haloLight's frame).
    float rot = TAU * uTimeS / max(uPeriod, 1e-3);
    vec2 rdir = rot2(rot) * rel;
    float angN = atan(rdir.y, rdir.x) / TAU + 0.5;
    float tcol = abs(fract(angN + uTimeS * 0.03) * 2.0 - 1.0);
    vec3 ringCol = paletteMix(clamp(tcol, 0.0, 1.0));
    float breatheB = 1.0 + sin(TAU * uTimeS / max(uPeriod, 1e-3)) * uBreathe * 0.5;
    float gain = uAmp * uExposure * breatheB;
    // Hard flat band where the coverage is strong.
    float band = smoothstep(0.35, 0.55, cov);
    // Posterized sweep arc.
    float head = fract(uTimeS / max(uPeriod, 1e-3) * uSweepTurns);
    float ad = fract(angN - head + 1.0);
    float arcHalf = max(uSweepArc, 0.02);
    float celSweep = step(ad, arcHalf) * band;
    vec3 cel = clamp(ringCol * 1.25, 0.0, 1.2) * band
             + mix(uC2, vec3(1.0), 0.5) * celSweep * 0.9;
    cel *= gain;
    col = mix(col, cel, uStyle);
  }

  // Ordered dither (~1/255) to kill banding the screen blend reveals; faded out
  // toward the cel end where hard bands are intended.
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);

  // ANDROID self-contained overlay: emit premultiplied light (alpha = brightness)
  // instead of the web's opaque `vec4(max(col,0.0), 1.0)`. See Look.kt.
  fragColor = dopLightOut(col);
}"""

/**
 * GLSL ES 3.00 source for **Halo** — Dopamine's calm ambient "loading" indicator.
 *
 * Governing metaphor: a soft luminous RING of light, centred on the action point
 * (`uOrigin`), gently BREATHES (its radius + brightness ease in a slow sine) and
 * ROTATES, while a brighter highlight ARC sweeps around it — the "loading" read.
 * Electric / serene OKLCH hues from the seeded palette.
 *
 * This is Dopamine's FIRST CONTINUOUS effect. The other nine are one-shot reward
 * MOMENTS driven by `amp = envelope(life)` (a 0→peak→0 fade that would NOT loop).
 * Halo instead rides the first-class `tempo.loop` contract:
 *   - The `.dope` declares `tempo.loop.periodMs = 1500`; the runner derives the
 *     standard periodic clocks from it each frame — `uPhase` (normalized loop
 *     phase in [0, 1)) and `uLoopS` (seconds within the loop) — off the SAME
 *     "animate on twos"-snapped clock as `uTimeS`. The parser validates the seam
 *     invariants (the period tiles the on-twos grid; `durationMs` 6000 = 4 whole
 *     periods), so the frame at `t == durationMs` equals `t == 0` at EVERY whimsy.
 *   - ALL animation here is a periodic function of `uPhase`: `sin(TAU·uPhase)`
 *     for the breathe, `TAU·uPhase` for the rotation, a sweep that winds an
 *     INTEGER number of turns per period, a sinusoidal hue sway, and a CLOSED
 *     CIRCLE through fbm noise space for the texture break. Nothing reads a
 *     monotonic clock (`uLife`/`uTimeS`), so every period boundary — not just the
 *     re-fire — is seamless.
 *   - `frame()` returns a STEADY periodic `amp = 0.85 + 0.15·sin(TAU·phase)`
 *     (never `envelope(life)`), so there is no one-shot fade to break the seam.
 *   - The conductor re-arms the effect at `durationMs` instead of tearing down;
 *     the host stops it via the play handle.
 *
 * Layers, summed as light (canvas is black, `mix-blend-mode: screen`, so black ==
 * no change, bright == cast light onto the page beneath):
 *   1. RING — a soft annulus at `ringRadius` (breathing in/out), its thickness set
 *      by `ringWidth`; the hue drifts gently around the ring (OKLCH C0→C1→C2) and
 *      rotates slowly, so it reads as a living loop, not a static stroke.
 *   2. GLOW — a wide, dim radial halo under the ring (the ambient "presence").
 *   3. SWEEP — a brighter highlight ARC riding around the ring at constant angular
 *      speed (`sweepTurns` turns per period), tapered to a comet-like trail. This
 *      is the "loading" cue; it is periodic so the loop stays seamless.
 *
 * whimsy == uStyle:
 *   0 = photoreal soft glow — smooth gaussian ring + a continuous, feathered sweep.
 *   1 = cel / flat — the ring becomes a hard flat band and the sweep snaps into a
 *       posterized arc. (The pass-runner already steps the clock "on twos"; that
 *       snap is periodic — `tempo.loop` guarantees it — so the LOOP stays seamless
 *       on the cel end too.)
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_FBM,
  GLSL_HASH,
  GLSL_PALETTE_MIX,
  GLSL_ROT2,
  GLSL_TONEMAP_ACES,
} from "@dopaminefx/core";

export const HALO_VERTEX_SRC = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  // Single full-screen triangle from gl_VertexID — no vertex buffers needed.
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const HALO_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;    // device pixels
uniform vec2  uOrigin;        // ring centre, gl coords (y up)
uniform float uAmp;           // STEADY periodic breathe gate (~0.85..1.0), not an envelope
uniform float uPhase;         // normalized loop phase [0,1) (tempo.loop) — drives ALL motion
uniform float uLoopS;         // seconds within the current loop (the dither's temporal seed)
uniform float uExposure;
uniform float uRingRadius;    // base ring radius as a fraction of min viewport dim
uniform float uRingWidth;     // ring thickness as a fraction of min viewport dim
uniform float uBreathe;       // 0..1 breathe depth (radius/brightness sine swing)
uniform float uSweepArc;      // 0..1 angular half-width of the traveling highlight arc (× PI)
uniform float uSweepTurns;    // integer turns the sweep winds per loop period (keeps it periodic)
uniform float uGlow;          // 0..1 ambient under-glow brightness
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

// The breathing ring's live radius. One slow sine per loop period swings the
// radius by ±uBreathe·ringWidth around the base — the gentle in/out "breath".
// Periodic in uPhase, so it returns to its t=0 value at every seam.
float liveRadius(){
  float ph = TAU * uPhase;
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
  // hue drift + texture creep ride around the loop. Periodic in uPhase.
  float rot = TAU * uPhase;
  vec2 rdir = rot2(rot) * rel;
  float ang = atan(rdir.y, rdir.x);            // -PI..PI in the rotating frame
  float angN = ang / TAU + 0.5;                // 0..1 around the ring

  float radius = liveRadius();
  float halfW = max(uRingWidth, 1e-3);

  // The breathe also gently modulates overall brightness (brighter on the inhale).
  float breatheB = 1.0 + sin(TAU * uPhase) * uBreathe * 0.5;
  float gain = uAmp * uExposure * breatheB;

  // Colour register: hue drifts AROUND the ring (OKLCH C0->C1->C2 over a full
  // turn, mirrored back). The drift SWAYS sinusoidally with the loop phase and
  // the fbm break walks a CLOSED CIRCLE through noise space — both periodic, so
  // the colour field is identical at every loop seam (a monotonic time offset
  // here would creep and pop at the boundary).
  float tcol = abs(fract(angN + sin(TAU * uPhase) * 0.045) * 2.0 - 1.0);
  tcol = clamp(tcol + (fbm(rdir * 6.0 + vec2(cos(TAU * uPhase), sin(TAU * uPhase)) * 0.075) - 0.5) * 0.12, 0.0, 1.0);
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
  float head = fract(uPhase * uSweepTurns);                          // 0..1 head position
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
  // (periodic — tempo.loop tiles the grid — so the loop seam survives); here we
  // flatten the tone.
  if (uStyle > 0.001) {
    vec2 rel = (frag - uOrigin) / minDim;
    float rn = length(rel);
    float radius = liveRadius();
    float halfW = max(uRingWidth, 1e-3);
    float cov = ringCoverage(rn, radius, halfW);
    // Rotating angle for the cel hue + cel sweep (matches haloLight's frame).
    float rot = TAU * uPhase;
    vec2 rdir = rot2(rot) * rel;
    float angN = atan(rdir.y, rdir.x) / TAU + 0.5;
    float tcol = abs(fract(angN + sin(TAU * uPhase) * 0.045) * 2.0 - 1.0);
    vec3 ringCol = paletteMix(clamp(tcol, 0.0, 1.0));
    float breatheB = 1.0 + sin(TAU * uPhase) * uBreathe * 0.5;
    float gain = uAmp * uExposure * breatheB;
    // Hard flat band where the coverage is strong.
    float band = smoothstep(0.35, 0.55, cov);
    // Posterized sweep arc.
    float head = fract(uPhase * uSweepTurns);
    float ad = fract(angN - head + 1.0);
    float arcHalf = max(uSweepArc, 0.02);
    float celSweep = step(ad, arcHalf) * band;
    vec3 cel = clamp(ringCol * 1.25, 0.0, 1.2) * band
             + mix(uC2, vec3(1.0), 0.5) * celSweep * 0.9;
    cel *= gain;
    col = mix(col, cel, uStyle);
  }

  // Ordered dither (~1/255) to kill banding the screen blend reveals; faded out
  // toward the cel end where hard bands are intended. Seeded by the LOOP clock,
  // so even the dither field repeats exactly at the seam.
  col = ditherAdd(col, frag, uLoopS, 1.0 - uStyle);

  fragColor = vec4(max(col, 0.0), 1.0);
}`;

/**
 * GLSL ES 3.00 source for **Ripple** — Dopamine's tactile "droplet in a still
 * pool" acknowledge effect.
 *
 * Governing metaphor: a single drop strikes a calm water surface at the action
 * point (`uOrigin`). Concentric WAVES expand outward, and each travelling
 * wavefront REFRACTS bright caustic light that dances across the UI as the ring
 * passes; behind the front, the surface settles back to still. It reads as
 * water + light: physical, tactile, anchored.
 *
 * This is a deliberate DIVERGENCE from Solarbloom's volumetric radial bloom.
 * Solarbloom is a soft glowing CORE that fills outward and lingers; Ripple has
 * NO bright core — its light lives entirely on thin, moving RING crests and the
 * caustic sparkle they refract. The motion is a set of discrete expanding
 * annuli, not a swelling blob.
 *
 * Layers, summed as light (canvas is black, `mix-blend-mode: screen`, so black
 * == no change, bright == cast light onto the page beneath):
 *   1. WAVEFIELD — a sum of `uRings` radially-travelling cosine waves whose
 *      phase = k*r - w*t, launched in a quick stagger from the origin. The
 *      surface height + its radial gradient (slope) drive everything else.
 *   2. CAUSTICS — the wave SLOPE bends light: bright filaments form where the
 *      curved surface focuses light (|slope| high, near crests), animated as the
 *      rings travel. This is the dancing light the brief describes.
 *   3. CREST GLINT — a thin specular highlight riding the leading crest of each
 *      ring (the wet "shine" of the moving wavefront).
 *   4. SETTLE — the whole field is gated by a radial wavefront envelope so light
 *      only appears where a ring currently is, then the pool goes still.
 *
 * Reward timing: uAmp (held-breath envelope) gates global brightness — a quick
 * expanding swell then a gentle settle. Pure function of uTimeS (frame-perfect,
 * cheap under SwiftShader: analytic waves + noise, single pass).
 *
 * whimsy == uStyle:
 *   0 = photoreal smooth refraction — soft caustics, continuous crests, smooth
 *       OKLCH colour drift across the rings.
 *   1 = stylized: hard concentric CEL rings (posterized crest bands), posterized
 *       caustics (chunky light cells), and the motion snaps "on twos" (the
 *       pass-runner already steps the clock; we also quantize the wave phase so
 *       the rings advance in discrete, posed jumps).
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_FBM,
  GLSL_HASH,
  GLSL_PALETTE_MIX,
  GLSL_TONEMAP_ACES,
} from "@dopamine/core";

/**
 * Max concurrent expanding rings. Single source of truth for the loop cap: it is
 * BOTH the GLSL `#define MAX_RINGS` (interpolated below) and the integer-clamp
 * const the `.dope` mapping references (passed to the loader as `MAX_RINGS`).
 */
export const MAX_RINGS = 7;

export const RIPPLE_VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  // Single full-screen triangle from gl_VertexID — no vertex buffers needed.
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const RIPPLE_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;    // device pixels
uniform vec2  uOrigin;        // drop point, gl coords (y up)
uniform float uAmp;           // envelope amplitude (peaks > 1)
uniform float uLife;          // whole-effect progress 0..1
uniform float uTimeS;         // elapsed seconds (snapped "on twos" by style)
uniform float uExposure;
uniform float uAmplitude;     // wave height (intensity)
uniform float uRings;         // number of concentric wavefronts launched
uniform float uWavelength;    // crest spacing as a fraction of min viewport dim
uniform float uSpeed;         // wave propagation speed (fraction of minDim / s)
uniform float uCaustic;       // 0..1 caustic-light brightness (intensity)
uniform float uSeed;          // per-fire hash offset
uniform float uStyle;         // 0..1 photoreal smooth refraction -> cel rings (whimsy)
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette (away from light)
uniform float uShadowSoft;    // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // crest core color
uniform vec3  uC1;            // mid
uniform vec3  uC2;            // caustic accent

#define MAX_RINGS ${MAX_RINGS}
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_PALETTE_MIX}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}

// A travelling ring's launch time as a fraction of life. The drop strikes at
// t=0 and successive rings (the secondary swells of a real impact) follow in a
// stagger wide enough that, at any instant, the rings sit at clearly DIFFERENT
// radii — a family of distinct sizes rippling out, not bunched near-duplicates.
float ringLaunch(int i){
  return float(i) * 0.12;
}

// The wave surface as a function of normalized radius rn (= r / minDim) and the
// life clock. Returns height in h; the radial SLOPE (dHeight/dr) in slope;
// and a 0..1 wavefront ENVELOPE in front (1 where a ring currently is, 0 in
// the still water ahead/behind). Shared by the light pass and the shadow so the
// cast occlusion tracks exactly the troughs that are drawn.
//
// Each ring is a radially-expanding wave packet: a cosine carrier (phase =
// k*r - w*t) under a gaussian envelope that travels outward at uSpeed and
// spreads/decays as 1/sqrt(r) (energy conservation on an expanding circle).
void waveField(float rn, out float h, out float slope, out float front){
  h = 0.0; slope = 0.0; front = 0.0;
  float k = TAU / max(uWavelength, 0.001);        // angular wavenumber (per rn)
  float w = k * uSpeed;                            // angular frequency
  int rings = int(clamp(uRings, 0.0, float(MAX_RINGS)) + 0.5);
  for (int i = 0; i < MAX_RINGS; i++) {
    if (i >= rings) break;
    float t0 = ringLaunch(i);
    float age = uLife - t0;                         // 0..(1-t0)
    if (age <= 0.0) continue;
    // Front radius travels outward; the packet starts tight and SWELLS markedly as
    // the ring expands, so each ring visibly changes size as it travels out (and an
    // older ring is both farther AND fatter than a younger one).
    float front_r = uSpeed * age;                   // expected crest of this ring
    float width = uWavelength * (1.0 + 2.6 * age);  // packet half-extent (grows as it expands)
    float d = rn - front_r;                         // signed distance to the front
    float pkt = exp(-(d * d) / (2.0 * width * width));
    if (pkt < 0.002) continue;
    // Amplitude fades CONTINUOUSLY as the ring ages/expands (not just a late cutoff),
    // so each crest dims steadily as it grows — on top of the 1/sqrt(r) spreading.
    float decay = pow(max(1.0 - age, 0.0), 1.3);
    // 1/sqrt(r) spreading (clamped near the origin so the drop isn't a spike).
    float spread = 1.0 / sqrt(max(rn, uWavelength * 0.5));
    // On the cel end, quantize the carrier phase so the rings advance "on twos"
    // (discrete posed crests) instead of sliding smoothly.
    float phase = k * rn - w * uLife;
    float qstep = TAU * 0.5;
    float qphase = floor(phase / qstep) * qstep;
    phase = mix(phase, qphase, uStyle * 0.85);
    float amp = uAmplitude * pkt * decay * spread;
    h += amp * cos(phase);
    // d(h)/d(rn): carrier derivative dominates (the steep part that bends light).
    slope += -amp * k * sin(phase);
    front = max(front, pkt * decay);
  }
}

// ---------------------------------------------------------------------------
// SHADOW silhouette — the wave TROUGHS cast a faint soft occlusion (a real
// rippled surface dimples the light it sits in). We sample the wave height at
// the offset shadow point and darken where the surface dips below rest (h < 0),
// gated by the wavefront envelope so still water casts nothing. Kept subtle.
float rippleOcclusion(vec2 frag){
  float minDim = min(uResolution.x, uResolution.y);
  float rn = length(frag - uOrigin) / minDim;
  float h, slope, front;
  waveField(rn, h, slope, front);
  float trough = max(-h, 0.0);                      // depth below rest
  return clamp(trough * 2.2 * front * uAmp, 0.0, 1.0);
}

vec4 rippleShadowColor(vec2 frag){
  vec2 sp = frag - uShadowOffset;
  float soft = uShadowSoft;
  float occ = rippleOcclusion(sp);
  occ += rippleOcclusion(sp + vec2( soft, 0.0));
  occ += rippleOcclusion(sp + vec2(-soft, 0.0));
  occ += rippleOcclusion(sp + vec2(0.0,  soft));
  occ += rippleOcclusion(sp + vec2(0.0, -soft));
  occ /= 5.0;
  // Troughs are a faint dimple, so cap the darkening well below full strength.
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength * 0.5;
  vec3 tint = mix(vec3(1.0), 0.6 + 0.4 * normalize(uC0 + 1e-3), 0.2);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);

  if (uShadow > 0.5) {
    fragColor = rippleShadowColor(frag);
    return;
  }

  vec3 col = vec3(0.0);
  vec2 rel = frag - uOrigin;
  float r = length(rel);
  float rn = r / minDim;                            // normalized radius
  vec2 rdir = rel / max(r, 1e-3);                   // outward unit (toward rim)

  // ---- The wave surface at this fragment. ----
  float h, slope, front;
  waveField(rn, h, slope, front);

  float gain = uAmp * uExposure;

  // Colour register: hue drifts gently OUTWARD across the rings (OKLCH palette
  // C0->C1->C2), so each expanding crest reads as a slightly different light —
  // unique per fire (the palette is seeded). A touch of slow temporal drift +
  // tiny fbm break keeps it alive without going rainbow.
  float tcol = clamp(rn / (uWavelength * float(MAX_RINGS) * 0.9), 0.0, 1.0);
  tcol = fract(tcol + uTimeS * 0.04 + fbm(rel / minDim * 5.0 + uSeed) * 0.06);
  vec3 ringCol = paletteMix(tcol);

  // ---- 1. CRESTS: the bright wet ridge of each travelling wavefront. ----
  // Light lives on the positive crests (h > 0), masked to where a ring is.
  float crest = smoothstep(0.0, uAmplitude * 0.5, h) * front;
  col += ringCol * crest * gain * 0.9;

  // ---- 2. CAUSTICS: the wave SLOPE refracts/focuses light. A curved surface
  // bends parallel light into bright filaments; |slope| peaks on the steep
  // flanks between crest and trough, so the caustic web sits BETWEEN the rings
  // and dances as they travel. Sharpened to thin, bright lines. ----
  float foc = abs(slope);
  float caustic = pow(clamp(foc / (uAmplitude * 1.2 + 1e-3), 0.0, 1.0), 1.8);
  // A little noise breaks the caustic into a living, glittering web.
  float glit = 0.6 + 0.6 * fbm(rel / minDim * 22.0 - uTimeS * 0.5 + uSeed);
  caustic *= glit * front;
  // The accent hue carries the caustic light (a brighter, whiter highlight on top).
  col += mix(uC2, vec3(1.0), 0.35) * caustic * uCaustic * gain * 1.3;

  // ---- 3. CREST GLINT: a thin specular line riding each leading crest. ----
  float glint = smoothstep(0.85, 1.0, front) * smoothstep(uAmplitude * 0.55, uAmplitude * 0.9, h);
  col += vec3(1.0) * glint * gain * 0.5 * (0.5 + 0.5 * uCaustic);

  // ---- Tone + finishing ----
  col = tonemapACES(col * 0.95);

  // ---- Non-photoreal pass: cel rings + posterized caustics (whimsy). ----
  // Toward the cel end the smooth refraction becomes hard concentric BANDS: the
  // crest mask is thresholded into a flat ring, and the caustic web is posterized
  // into chunky light cells. The phase quantization in waveField already steps
  // the rings "on twos"; here we flatten their tone.
  if (uStyle > 0.001) {
    // Hard ring: a flat band where the crest is strong, with a brighter inner core.
    float band = smoothstep(0.18, 0.30, crest);
    float core = smoothstep(0.45, 0.60, crest);
    vec3 celRing = clamp(ringCol * 1.3, 0.0, 1.2) * band
                 + clamp(uC0 * 1.6 + 0.1, 0.0, 1.3) * core;
    // Posterize the caustic light into 2 chunky levels (Ben-Day-ish cells),
    // and keep only the BRIGHT cells (drop the dim wash so the cel read stays
    // clean white-on-dark rings instead of a muddy mid-tone field).
    float caus = clamp(caustic * uCaustic, 0.0, 1.0);
    float causQ = step(0.5, caus) * 0.6 + step(0.8, caus) * 0.4;
    vec3 celCaustic = mix(uC2, vec3(1.0), 0.5) * causQ;
    vec3 cel = (celRing + celCaustic) * gain;
    col = mix(col, cel, uStyle);
  }

  // Ordered dither (~1/255) to kill banding the screen blend reveals; faded out
  // toward the cel end where hard bands are intended.
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);

  fragColor = vec4(max(col, 0.0), 1.0);
}`;

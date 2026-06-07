/**
 * GLSL ES 3.00 source for Confetti.
 *
 * One full-screen pass renders a burst of paper confetti as light (the canvas is
 * black, composited with `mix-blend-mode: screen`, so black == no change and
 * bright == cast colour onto the page beneath). Each of MAX_PIECES pieces:
 *   1. LAUNCHES upward from `uOrigin` in a cone (a sharp pop at t≈0), then
 *   2. TUMBLES DOWN under gravity — the signature physical, fluttering fall. The
 *      shared `ballisticPos` (launch dir * speed * t − gravity * t²) gives the
 *      up-then-down arc; on top of it we add an air-drag FLUTTER: a sideways sway
 *      whose amplitude grows as the piece slows + falls (paper catching air), and
 *   3. SPINS — each rectangle/petal rotates on its own axis, so it flashes wide
 *      then edge-on (a brightness flicker as it presents face vs edge to "light").
 * Pieces settle near the bottom and fade out over their life. A faint downward
 * shadow silhouette is cast on the multiply pass.
 *
 * Deliberately distinct from Solarbloom's motes (which drift UPWARD on buoyant
 * curls): confetti is gravity-bound, sways, spins, and is shaped paper, not soft
 * photons. Reuses the shared particle helpers (ballisticPos + particleFade) so the
 * arc + lifetime curve stay canonical; the emit cone, flutter, spin + paper shape
 * are confetti's own identity.
 *
 * Single fragment pass: analytic per-piece math is cheap + identical frame-to-
 * frame (pure function of uTimeS), which keeps it fast under software WebGL.
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_HASH,
  GLSL_PALETTE_MIX,
  GLSL_ROT2,
  GLSL_TONEMAP_ACES,
} from "./look/glsl.js";
import { GLSL_PARTICLES } from "./look/particles.glsl.js";

/**
 * Max confetti pieces. Single source of truth: BOTH the GLSL `#define MAX_PIECES`
 * (interpolated below) and the integer-clamp const the `.dope` mapping references
 * (passed to the loader as `MAX_PIECES`). Counts above this won't render (the
 * shader loop is bounded by the define).
 */
export const MAX_PIECES = 120;

export const CONFETTI_VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  // Single full-screen triangle from gl_VertexID — no vertex buffers needed.
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const CONFETTI_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;    // device pixels
uniform vec2  uOrigin;        // launch origin, gl coords (y up)
uniform float uAmp;           // envelope amplitude (peaks > 1) — overall brightness
uniform float uLife;          // total normalized progress 0..1
uniform float uTimeS;         // elapsed seconds (snapped "on twos" with style)
uniform float uExposure;
uniform float uPieceCount;
uniform float uSpread;        // launch cone half-width (0..~1)
uniform float uLaunchSpeed;   // launch speed scale
uniform float uGravity;       // downward pull scale
uniform float uFlutter;       // air-drag sideways sway strength
uniform float uPieceSize;     // piece size scale
uniform float uSpin;          // rotation speed scale
uniform float uPieceSeed;     // per-fire scatter offset
uniform float uStyle;         // 0..1 photoreal paper -> flat cel shapes
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette
uniform float uShadowSoft;    // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;

#define MAX_PIECES ${MAX_PIECES}
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_PALETTE_MIX}
${GLSL_ROT2}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_PARTICLES}

// Per-piece deterministic motion + pose. Given piece index i and the live frag
// sample p (device px), returns the piece's current centre and writes its half-
// extents, rotation, face-flash factor + spawn-staggered life. All a pure
// function of uTimeS so a fixed-timestep capture reproduces the frame.
struct Piece {
  vec2 pos;     // current centre, device px
  vec2 halfSize;// half width/height of the paper rect, device px (face-scaled)
  float rot;    // current rotation (radians)
  float face;   // 0..1 how face-on the piece is (drives brightness flicker)
  float life;   // normalized particle life 0..1 (after spawn stagger)
  float hue;    // palette param 0..1
  float petal;  // 0..1 rectangle -> rounded petal blend
};

Piece pieceAt(int i, float minDim) {
  Piece pc;
  float fi = float(i);
  vec2 h  = hash21(fi * 12.13 + uPieceSeed);
  vec2 h2 = hash21(fi * 7.37 + uPieceSeed + 2.7);
  float h3 = hash11(fi * 3.91 + uPieceSeed + 9.1);

  // Spawn stagger: most pieces fire in the first ~12% (a sharp burst), a few
  // trail. life is renormalized so each piece runs its full arc within uLife.
  float delay = h2.x * 0.12;
  pc.life = clamp((uLife - delay) / (1.0 - delay), 0.0, 1.0);

  // Launch direction: a mostly-UP cone, fanned left/right by spread. Screen y is
  // up here, so the launch dir has a strong +y and a spread-scaled x.
  float fan = (h.x - 0.5) * 2.0;                 // -1..1
  vec2 dir = normalize(vec2(fan * (0.35 + uSpread), 1.0));
  float speed = (0.85 + h.y * 0.6) * uLaunchSpeed * minDim * 1.15;
  float gravity = (0.9 + h3 * 0.4) * uGravity * minDim * 1.5;

  // Ballistic arc (shared helper): up, then DOWN under gravity. This is the
  // signature — pieces rise off the launch then tumble back down past the origin.
  vec2 base = ballisticPos(uOrigin, dir, speed, gravity, pc.life);

  // Air-drag FLUTTER: paper doesn't fall straight — it sways side to side, and
  // the sway grows as the piece slows + descends (more air resistance felt).
  // A per-piece phase + frequency keeps every piece swaying independently.
  float swayPhase = h.x * TAU + h2.y * 3.0;
  float swayFreq  = 3.0 + h2.x * 4.0;
  float fallT = smoothstep(0.12, 0.7, pc.life);  // ramps in as it starts to fall
  float swayAmp = uFlutter * minDim * 0.06 * (0.4 + fallT);
  float sway = sin(pc.life * swayFreq + swayPhase) * swayAmp
             + sin(pc.life * swayFreq * 0.37 + swayPhase * 1.7) * swayAmp * 0.4;
  // Sway is perpendicular to the launch dir (mostly horizontal).
  pc.pos = base + vec2(1.0, 0.0) * sway;

  // SPIN: the piece tumbles. Rotation accumulates over its life; flutter also
  // modulates it (paper flips faster while sliding through air). The face-flash
  // is the |cos| of the spin: wide (bright) when face-on, dim edge-on.
  float spinRate = (3.0 + h3 * 6.0) * uSpin;
  pc.rot = pc.life * spinRate * TAU + swayPhase;
  float flip = abs(cos(pc.rot * 0.5 + sway * 0.02));
  pc.face = mix(0.18, 1.0, flip);

  // Paper shape: small rectangles, a few squarer, a few elongated streamers.
  float aspect = mix(0.5, 1.6, h2.y);
  float s = minDim * 0.011 * uPieceSize * (0.7 + h.y * 0.7);
  pc.halfSize = vec2(s * aspect, s) * mix(1.0, pc.face, 0.65); // foreshorten by face
  pc.hue = fract(h2.y * 0.9 + h3 * 0.31);
  pc.petal = step(0.78, h3);                                // ~22% petals
  return pc;
}

// Coverage of one paper piece at frag p. Rotate p into the piece's local frame
// then test a rounded box (rect) or a soft ellipse (petal). Returns 0..1.
float pieceCoverage(Piece pc, vec2 p) {
  vec2 q = rot2(-pc.rot) * (p - pc.pos);
  vec2 he = max(pc.halfSize, vec2(0.5));
  if (pc.petal > 0.5) {
    // Rounded petal: normalized radial falloff.
    vec2 e = q / he;
    float r = length(e);
    return 1.0 - smoothstep(0.7, 1.05, r);
  }
  // Rounded rectangle (soft edges so it antialiases + reads as paper, not pixels).
  vec2 d = abs(q) - he;
  float outside = length(max(d, 0.0));
  float inside = min(max(d.x, d.y), 0.0);
  float sd = outside + inside;
  float edge = max(min(he.x, he.y) * 0.35, 1.0);
  return 1.0 - smoothstep(-edge, edge, sd);
}

// ---------------------------------------------------------------------------
// SHADOW silhouette — a cheap occlusion field of the falling pieces for the
// multiply pass. We only need where paper is "solid enough" to block light; no
// face-flash or palette, just mass. Cheaper than the light pass.
// ---------------------------------------------------------------------------
float confettiOcclusion(vec2 p, float minDim) {
  float occ = 0.0;
  for (int i = 0; i < MAX_PIECES; i++) {
    if (float(i) >= uPieceCount) break;
    Piece pc = pieceAt(i, minDim);
    if (pc.life <= 0.0 || pc.life >= 1.0) continue;
    float cov = pieceCoverage(pc, p);
    float fade = particleFade(pc.life, 1.4);
    occ += cov * fade * 0.6;
  }
  return clamp(occ * uAmp, 0.0, 1.0);
}

vec4 shadowColor(vec2 frag, float minDim) {
  vec2 sp = frag - uShadowOffset;
  float occ = confettiOcclusion(sp, minDim);
  // 4-tap cross blur for a soft penumbra (pieces are small; a light blur is enough).
  float soft = uShadowSoft;
  occ += confettiOcclusion(sp + vec2( soft, 0.0), minDim);
  occ += confettiOcclusion(sp + vec2(-soft, 0.0), minDim);
  occ += confettiOcclusion(sp + vec2(0.0,  soft), minDim);
  occ += confettiOcclusion(sp + vec2(0.0, -soft), minDim);
  occ /= 5.0;
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength;
  vec3 tint = mix(vec3(1.0), 0.6 + 0.4 * normalize(uC0 + 1e-3), 0.2);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float minDim = min(uResolution.x, uResolution.y);

  if (uShadow > 0.5) {
    fragColor = shadowColor(frag, minDim);
    return;
  }

  vec3 col = vec3(0.0);
  float gain = uAmp * uExposure;

  for (int i = 0; i < MAX_PIECES; i++) {
    if (float(i) >= uPieceCount) break;
    Piece pc = pieceAt(i, minDim);
    if (pc.life <= 0.0 || pc.life >= 1.0) continue;

    float cov = pieceCoverage(pc, frag);
    if (cov <= 0.0) continue;

    float fade = particleFade(pc.life, 1.4);
    vec3 base = paletteMix(pc.hue);

    // PHOTOREAL (style 0): soft paper shading. The face-flash darkens/brightens
    // the piece as it spins (face-on = lit, edge-on = dim), plus a soft inner
    // gradient so it reads as a curved sheet, not a flat sticker. A faint
    // specular catch at the brightest face angles sells the glossy paper.
    float shade = mix(0.45, 1.15, pc.face);
    vec3 paper = base * shade;
    float spec = smoothstep(0.85, 1.0, pc.face) * 0.5;
    paper += vec3(1.0) * spec * cov;

    // CEL (style 1): flat, posterized shapes with a hard rim — animate-on-twos
    // (the clock is already snapped by style in the runner). Two-tone face/edge.
    vec3 cel = base * mix(0.55, 1.1, step(0.5, pc.face));
    // Hard bright rim on the leading edge of the shape.
    float rim = smoothstep(0.0, 0.25, cov) * (1.0 - smoothstep(0.55, 0.9, cov));
    cel = mix(cel, base + 0.35, rim * 0.5);

    vec3 lit = mix(paper, cel, uStyle);
    col += lit * cov * fade * gain * 1.35;
  }

  // Filmic tonemap (graceful highlight rolloff at dense electric bursts).
  col = tonemapACES(col * 0.85);

  // Cel posterize at the whimsy end: punch saturation + quantize into hard bands.
  if (uStyle > 0.001) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 neon = clamp(l + (col - l) * 1.5, 0.0, 1.0);
    vec3 styled = mix(col, neon, 0.65);
    float bands = mix(40.0, 5.0, uStyle);
    styled = floor(styled * bands + 0.5) / bands;
    col = mix(col, styled, uStyle);
  }

  // Ordered dither (shared ditherAdd) to break screen-blend banding; faded out
  // toward the cel end where hard bands are the intended look.
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);

  fragColor = vec4(col, 1.0);
}`;

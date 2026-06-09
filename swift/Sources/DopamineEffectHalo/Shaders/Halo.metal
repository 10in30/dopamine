// Halo — MSL fragment shader, ported from `halo-shader.ts` (GLSL ES 3.00).
// macOS/iOS only (compiled into the effect's metallib by the Swift build on an
// Apple toolchain; on Linux it is an inert resource).
//
// Governing metaphor: a soft luminous RING of light, centred on u.origin, gently
// BREATHES (radius/brightness ease in a slow sine) and ROTATES, while a brighter
// highlight ARC sweeps around it — the calm "loading" read. Dopamine's first
// CONTINUOUS effect: ALL motion is driven by PERIODIC functions of u.timeS
// (period = u.period = 1.5 s), and the `.dope` makes durationMs (6000) an integer
// multiple of the period — so the loop is SEAMLESS (the frame at t==durationMs
// equals t==0 at every whimsy; the on-twos snap is itself periodic). There is no
// `envelope(life)` fade: u.amp is a STEADY periodic breathe gate (see Halo.swift).
//
// One full-screen pass renders, all summed as light (presented through the
// `screen`-blended light layer; the shadow pass through a `multiply` layer):
//   1. RING  — a soft breathing annulus at u.ringRadius, hue drifting around it.
//   2. GLOW  — a wide, dim ambient halo under the ring.
//   3. SWEEP — a brighter comet arc winding around the ring (u.sweepTurns turns
//              per period — an INTEGER, so it stays periodic / seamless).
// finished with a filmic (ACES) tonemap, an optional cel-ring pass, + a dither.
//
// The shared building blocks come from DopamineLook.metal (one canonical copy).
//
// UNIFORM STRUCT — the GLSL→MSL binding seam. WebGL sets `u*` one-by-one; Metal
// reads ONE struct. The `HaloUniforms` struct is GENERATED from the `.dope` by
// scripts/gen-uniforms.mjs (into HaloUniforms.metal) — the SAME source that emits
// the Swift packer, so the two layouts cannot drift.

#include <metal_stdlib>
#include "DopamineLook.metal"
#include "HaloUniforms.metal"   // @generated — struct HaloUniforms
using namespace metal;

// Full-screen triangle from vertex_id (no vertex buffers).
struct VSOut { float4 position [[position]]; };
vertex VSOut halo_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

// 2x2 rotation (MSL float2x2 takes COLUMNS; GLSL mat2(c,-s,s,c) is column-major
// too, so the columns are (c, s) and (-s, c)). Matches the web rot2().
inline float2x2 halo_rot2(float a) {
    float s = sin(a), c = cos(a);
    return float2x2(float2(c, s), float2(-s, c));
}

// The breathing ring's live radius (periodic in u.timeS — returns to its t=0
// value after each period).
inline float liveRadius(constant HaloUniforms &u) {
    float ph = TAU * u.timeS / max(u.period, 1e-3);
    return u.ringRadius + sin(ph) * u.breathe * u.ringWidth * 1.6;
}

// Coverage 0..1 of the soft annulus at normalized radius rn (= r / minDim).
inline float ringCoverage(float rn, float radius, float halfW) {
    float d = abs(rn - radius);
    return exp(-(d * d) / (2.0 * halfW * halfW + 1e-6));
}

// The whole halo's emitted light at a fragment (shared by the light pass).
inline float3 haloLight(float2 frag, float minDim, constant HaloUniforms &u) {
    float2 rel = (frag - u.origin) / minDim;       // normalized, origin-centred
    float rn = length(rel);
    // Slowly ROTATE the angular reference frame (one full turn per period).
    float rot = TAU * u.timeS / max(u.period, 1e-3);
    float2 rdir = halo_rot2(rot) * rel;
    float ang = atan2(rdir.y, rdir.x);             // -PI..PI in the rotating frame
    float angN = ang / TAU + 0.5;                  // 0..1 around the ring

    float radius = liveRadius(u);
    float halfW = max(u.ringWidth, 1e-3);

    float breatheB = 1.0 + sin(TAU * u.timeS / max(u.period, 1e-3)) * u.breathe * 0.5;
    float gain = u.amp * u.exposure * breatheB;

    float tcol = abs(fract(angN + u.timeS * 0.03) * 2.0 - 1.0);
    tcol = clamp(tcol + (dop_fbm(rdir * 6.0 + u.timeS * 0.05) - 0.5) * 0.12, 0.0, 1.0);
    float3 ringCol = dop_paletteMix(tcol, u.c0, u.c1, u.c2);

    float3 col = float3(0.0);

    // ---- 1. RING: the soft luminous annulus. ----
    float cov = ringCoverage(rn, radius, halfW);
    col += ringCol * cov * gain;

    // ---- 2. GLOW: a wide, dim ambient halo under the ring. ----
    float glow = exp(-(rn * rn) / (2.0 * (radius * 0.85) * (radius * 0.85) + 1e-4));
    col += ringCol * glow * u.glow * gain * 0.28;

    // ---- 3. SWEEP: a brighter comet arc winding around the ring (loading). ----
    float head = fract(u.timeS / max(u.period, 1e-3) * u.sweepTurns);  // 0..1 head position
    float ad = fract(angN - head + 1.0);                               // 0..1 ahead-of-head distance
    float arcHalf = max(u.sweepArc, 0.02);
    float sweepMask = exp(-ad / (arcHalf * 0.9 + 1e-3)) * cov;          // comet head + trail
    float3 sweepCol = mix(u.c2, float3(1.0), 0.4);
    col += sweepCol * sweepMask * gain * 1.15;

    return col;
}

// ---------------------------------------------------------------------------
// SHADOW silhouette — a thin floating loop casts a faint soft occlusion of its
// annulus. Sample the ring coverage at the offset shadow point and darken in
// proportion, kept subtle.
inline float haloOcclusion(float2 frag, float minDim, constant HaloUniforms &u) {
    float2 rel = (frag - u.origin) / minDim;
    float rn = length(rel);
    float cov = ringCoverage(rn, liveRadius(u), max(u.ringWidth, 1e-3));
    return clamp(cov * u.amp, 0.0, 1.0);
}

inline float4 haloShadowColor(float2 frag, float minDim, constant HaloUniforms &u) {
    float2 sp = frag - u.shadowOffset;
    float soft = u.shadowSoft;
    float occ = haloOcclusion(sp, minDim, u);
    occ += haloOcclusion(sp + float2( soft, 0.0), minDim, u);
    occ += haloOcclusion(sp + float2(-soft, 0.0), minDim, u);
    occ += haloOcclusion(sp + float2(0.0,  soft), minDim, u);
    occ += haloOcclusion(sp + float2(0.0, -soft), minDim, u);
    occ /= 5.0;
    float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength * 0.45;
    float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.2);
    float3 mul = mix(float3(1.0), tint, dark);
    return float4(mul, 1.0);
}

fragment float4 halo_fragment(
    VSOut in [[stage_in]],
    constant HaloUniforms &u [[buffer(0)]]
) {
    // Metal's [[position]] is TOP-left origin (y down); the ported GLSL math and
    // u.origin are bottom-left (y up). Flip y once here so the whole shader works
    // in the y-up space it was written for.
    float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
    float minDim = min(u.resolution.x, u.resolution.y);

    if (u.shadow > 0.5) {
        return haloShadowColor(frag, minDim, u);
    }

    float3 col = haloLight(frag, minDim, u);

    // ---- Tone + finishing ----
    col = dop_tonemapACES(col * 0.95);

    // ---- Non-photoreal pass: cel / flat banded ring (whimsy). ----
    if (u.style > 0.001) {
        float2 rel = (frag - u.origin) / minDim;
        float rn = length(rel);
        float radius = liveRadius(u);
        float halfW = max(u.ringWidth, 1e-3);
        float cov = ringCoverage(rn, radius, halfW);
        float rot = TAU * u.timeS / max(u.period, 1e-3);
        float2 rdir = halo_rot2(rot) * rel;
        float angN = atan2(rdir.y, rdir.x) / TAU + 0.5;
        float tcol = abs(fract(angN + u.timeS * 0.03) * 2.0 - 1.0);
        float3 ringCol = dop_paletteMix(clamp(tcol, 0.0, 1.0), u.c0, u.c1, u.c2);
        float breatheB = 1.0 + sin(TAU * u.timeS / max(u.period, 1e-3)) * u.breathe * 0.5;
        float gain = u.amp * u.exposure * breatheB;
        float band = smoothstep(0.35, 0.55, cov);
        float head = fract(u.timeS / max(u.period, 1e-3) * u.sweepTurns);
        float ad = fract(angN - head + 1.0);
        float arcHalf = max(u.sweepArc, 0.02);
        float celSweep = step(ad, arcHalf) * band;
        float3 cel = clamp(ringCol * 1.25, 0.0, 1.2) * band
                   + mix(u.c2, float3(1.0), 0.5) * celSweep * 0.9;
        cel *= gain;
        col = mix(col, cel, u.style);
    }

    // Ordered dither (~1/255); faded out toward the cel end.
    col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);

    col = max(col, 0.0);
    // PREMULTIPLIED-alpha output: alpha = the light's own brightness. Dark regions
    // become transparent so the UI beneath shows through, and bright ring/sweep
    // light reads as cast light over it (same convention as Ripple/Solarbloom; the
    // web returns alpha=1 because its `mix-blend-mode: screen` composites differently).
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    return float4(col, outA);
}

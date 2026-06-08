// Solarbloom — MSL fragment shader, ported from `solarbloom-shader.ts`
// (GLSL ES 3.00). macOS/iOS only (compiled into the effect's metallib by the
// Swift build on an Apple toolchain; on Linux it is an inert resource).
//
// One full-screen pass renders, all summed as light (presented through the
// `screen`-blended light layer; the shadow pass through a `multiply` layer):
//   1. a domain-warped FBM bloom with light shafts + spectral split + iridescence
//   2. drifting light "motes" with motion-blur streaks + twinkle
//   3. a checkmark drawn in light (baked-SDF / glyph-texture / analytic fallback)
// finished with a filmic (ACES) tonemap + an ordered dither.
//
// The shared building blocks come from DopamineLook.metal (one canonical copy).
//
// UNIFORM STRUCT — the GLSL→MSL binding seam. WebGL sets `u*` one-by-one; Metal
// reads ONE struct. The `SolarbloomUniforms` struct is now GENERATED from the
// `.dope` by scripts/gen-uniforms.mjs (into SolarbloomUniforms.metal) — the SAME
// source that emits the Swift packer, so the two layouts cannot drift. See
// report (b): this struct is exactly the "datafiable" binding the port surfaced.

#include <metal_stdlib>
#include "DopamineLook.metal"
#include "SolarbloomUniforms.metal"   // @generated — struct SolarbloomUniforms
using namespace metal;

#define MAX_MOTES 80

// Full-screen triangle from vertex_id (no vertex buffers).
struct VSOut { float4 position [[position]]; };
vertex VSOut solarbloom_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

// Radial bloom intensity at normalized radius dn (1.0 == edge).
inline float bloomProfile(float dn) {
    float core = exp(-dn * dn * 2.4) * 0.92;
    float halo = exp(-dn * 1.3) * 0.5;
    return core + halo;
}

inline float2 glyphUV(float2 frag, constant SolarbloomUniforms &u) {
    return (frag - u.origin) / (2.0 * u.checkBox) + 0.5;
}
inline float glyphDrawAxis(float2 uv) {
    return clamp((uv.x * 0.86 + uv.y * 0.14), 0.0, 1.0);
}

// Glyph coverage from the font-glyph texture, gated by the diagonal draw wipe.
inline float glyphCoverage(float2 frag, constant SolarbloomUniforms &u,
                           texture2d<float> checkTex, sampler texSampler,
                           thread float &axisHere) {
    float2 uv = glyphUV(frag, u);
    axisHere = glyphDrawAxis(uv);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    float a = checkTex.sample(texSampler, uv).a;
    float frontier = u.check * 1.12;
    float wipe = smoothstep(frontier, frontier - 0.07, axisHere);
    return a * wipe;
}

// Baked-SDF coverage (the geometry seam): the icon shape comes from the .dope
// svgPath, baked → sdfTex; we sample distance and gate by the same wipe.
inline float sdfCoverage(float2 frag, constant SolarbloomUniforms &u,
                         texture2d<float> sdfTex, sampler texSampler,
                         thread float &axisHere, thread float &distPx) {
    float2 uv = glyphUV(frag, u);
    axisHere = glyphDrawAxis(uv);
    distPx = 1e9;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    float nd = sdfTex.sample(texSampler, uv).r;
    distPx = nd * u.sdfRangePx;
    float frontier = u.check * 1.12;
    float wipe = smoothstep(frontier, frontier - 0.07, axisHere);
    return wipe;
}

// Shadow occlusion field (cheap silhouette of bloom + motes + checkmark).
inline float solarOcclusion(float2 p, constant SolarbloomUniforms &u,
                            texture2d<float> sdfTex, texture2d<float> checkTex, sampler s) {
    float minDim = min(u.resolution.x, u.resolution.y);
    float r = u.bloomRadius * minDim;
    float2 rel = p - u.origin;
    float d = length(rel);
    float dn = d / r;
    float occ = exp(-dn * dn * 2.0) * 0.9 + exp(-dn * 1.4) * 0.18;

    for (int i = 0; i < MAX_MOTES; i++) {
        if (float(i) >= u.moteCount) break;
        float2 h = dop_hash21(float(i) * 13.17 + u.moteSeed);
        float2 h2 = dop_hash21(float(i) * 7.91 + u.moteSeed + 1.3);
        float a0 = h.x * TAU;
        float spd = 0.5 + h.y;
        float delay = dop_hash11(float(i) * 7.7 + u.moteSeed) * 0.15;
        float life = clamp((u.life - delay) / (1.0 - delay), 0.0, 1.0);
        if (life <= 0.0) continue;
        float nearTier = step(0.66, h2.x);
        float depth = mix(0.7, 1.4, nearTier);
        float2 dir = float2(cos(a0), sin(a0));
        float travel = life * spd * u.moteSpeed * r * 1.3 * depth;
        float2 buoy = float2(0.0, life * life * r * 0.5);
        float2 pos = u.origin + dir * travel + buoy;
        float size = minDim * 0.006 * (0.6 + h.x * 0.8) * depth;
        float dd = length(p - pos);
        float dotv = size / (dd + size * 0.6); dotv *= dotv;
        float fade = (1.0 - pow(life, 1.3)) * smoothstep(0.0, 0.08, life);
        occ += dotv * fade * 0.5;
    }

    float cr = minDim * 0.11;
    float sw = cr * 0.12;
    if (u.sdfOn > 0.5) {
        float axisHere; float distPx;
        float wipe = sdfCoverage(p, u, sdfTex, s, axisHere, distPx);
        occ += (1.0 - smoothstep(u.sdfStrokePx * 0.6, u.sdfStrokePx * 1.4, distPx)) * wipe * 0.8;
    } else if (u.checkTexOn > 0.5) {
        float axisHere;
        float cov = glyphCoverage(p, u, checkTex, s, axisHere);
        occ += cov * 0.8;
    } else {
        float2 A = u.origin + cr * float2(-0.9, 0.15);
        float2 B = u.origin + cr * float2(-0.25, -0.55);
        float2 C = u.origin + cr * float2(1.0, 0.78);
        float l1 = length(B - A), l2 = length(C - B);
        float total = l1 + l2;
        float drawn = u.check * total;
        float vis1 = clamp(drawn, 0.0, l1);
        float2 tip = A + (B - A) * (vis1 / l1);
        float dseg = dop_sdSeg(p, A, tip);
        if (drawn > l1) {
            float d2 = clamp(drawn - l1, 0.0, l2);
            float2 tip2 = B + (C - B) * (d2 / l2);
            dseg = min(dseg, dop_sdSeg(p, B, tip2));
        }
        occ += (1.0 - smoothstep(sw * 0.6, sw * 1.4, dseg)) * 0.8;
    }
    return clamp(occ * u.amp, 0.0, 1.0);
}

inline float4 shadowColor(float2 frag, constant SolarbloomUniforms &u,
                         texture2d<float> sdfTex, texture2d<float> checkTex, sampler s) {
    float2 sp = frag - u.shadowOffset;
    float occ = solarOcclusion(sp, u, sdfTex, checkTex, s);
    float soft = u.shadowSoft;
    occ += solarOcclusion(sp + float2( soft, 0.0), u, sdfTex, checkTex, s);
    occ += solarOcclusion(sp + float2(-soft, 0.0), u, sdfTex, checkTex, s);
    occ += solarOcclusion(sp + float2(0.0,  soft), u, sdfTex, checkTex, s);
    occ += solarOcclusion(sp + float2(0.0, -soft), u, sdfTex, checkTex, s);
    float s2 = soft * 0.7071;
    occ += solarOcclusion(sp + float2( s2,  s2), u, sdfTex, checkTex, s);
    occ += solarOcclusion(sp + float2(-s2,  s2), u, sdfTex, checkTex, s);
    occ += solarOcclusion(sp + float2( s2, -s2), u, sdfTex, checkTex, s);
    occ += solarOcclusion(sp + float2(-s2, -s2), u, sdfTex, checkTex, s);
    occ /= 9.0;
    float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength;
    float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.25);
    float3 mul = mix(float3(1.0), tint, dark);
    return float4(mul, 1.0);
}

fragment float4 solarbloom_fragment(
    VSOut in [[stage_in]],
    constant SolarbloomUniforms &u [[buffer(0)]],
    texture2d<float> checkTex [[texture(0)]],
    texture2d<float> sdfTex [[texture(1)]],
    sampler texSampler [[sampler(0)]]
) {
    // Metal's [[position]] is TOP-left origin (y down); the ported GLSL math and
    // u.origin are bottom-left (y up). Flip y once here so the whole shader works
    // in the y-up space it was written for (otherwise the checkmark + buoyant
    // motes render upside down).
    float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
    float minDim = min(u.resolution.x, u.resolution.y);
    float r = u.bloomRadius * minDim;
    float3 col = float3(0.0);

    if (u.shadow > 0.5) {
        return shadowColor(frag, u, sdfTex, checkTex, texSampler);
    }

    float2 rel = frag - u.origin;
    float ang = atan2(rel.y, rel.x);
    float d = length(rel);

    // ---- Volumetric bloom ----
    float2 sp = float2(ang * 1.6, d / r * 2.2) + u.moteSeed;
    float fbmTex = dop_domainWarp(sp, u.timeS, u.turbulence);
    float dn = d / r * (1.0 + 0.18 * (fbmTex - 0.5) * u.turbulence);

    float disp = dop_dispersionAmount(u.dispersion, dn, u.amp);
    float pr = bloomProfile(dn * (1.0 - disp));
    float pg = bloomProfile(dn);
    float pb = bloomProfile(dn * (1.0 + disp));
    float3 spectral = float3(pr, pg, pb);

    float3 bloomTint = dop_paletteMix(dn * 0.9, u.c0, u.c1, u.c2);
    float shafts = dop_fbm(float2(ang * 5.0 + u.timeS * 0.2, d / r * 1.5));
    shafts = pow(smoothstep(0.4, 0.95, shafts), 2.0);
    float shaftFall = exp(-dn * 1.3) * smoothstep(0.05, 0.5, dn);
    float bloomGain = u.amp * u.exposure;
    col += bloomTint * spectral * bloomGain;
    col += bloomTint * shafts * shaftFall * 0.3 * bloomGain * (0.5 + 0.5 * u.turbulence);

    float shell = exp(-pow((dn - 0.6) * 3.0, 2.0));
    float irPhase = ang * 0.5 + fbmTex * 1.5 + u.timeS * 0.4;
    float3 irid = dop_iridescent(fract(irPhase));
    float irMask = shell * u.iridescence * pg;
    col = mix(col, col * (0.4 + 1.6 * irid), irMask * 0.5);
    col += irid * irMask * 0.18 * bloomGain;

    // ---- Drifting light motes ----
    for (int i = 0; i < MAX_MOTES; i++) {
        if (float(i) >= u.moteCount) break;
        float2 h = dop_hash21(float(i) * 13.17 + u.moteSeed);
        float2 h2 = dop_hash21(float(i) * 7.91 + u.moteSeed + 1.3);
        float a0 = h.x * TAU;
        float spd = 0.5 + h.y;
        float delay = dop_hash11(float(i) * 7.7 + u.moteSeed) * 0.15;
        float life = clamp((u.life - delay) / (1.0 - delay), 0.0, 1.0);
        if (life <= 0.0) continue;

        float nearTier = step(0.66, h2.x);
        float depth = mix(0.7, 1.4, nearTier);

        float2 dir = float2(cos(a0), sin(a0));
        float travel = life * spd * u.moteSpeed * r * 1.3 * depth;
        float2 buoy = float2(0.0, life * life * r * 0.5);
        float t1 = a0 * 3.0 + life * TAU * spd;
        float2 curl = float2(sin(t1), cos(t1 * 0.8 + a0)) * u.turbulence * r * 0.3 * life;
        float2 pos = u.origin + dir * travel + buoy + curl;

        float2 vel = dir * spd * u.moteSpeed * 1.3 * depth
                   + float2(0.0, 2.0 * life * 0.5)
                   + float2(cos(t1), -sin(t1 * 0.8 + a0)) * u.turbulence * 0.3;
        float2 vdir = normalize(vel + 1e-4);
        float2 q = frag - pos;
        float streak = clamp(length(vel) * 0.12, 0.0, 0.65) * smoothstep(0.0, 0.25, life);
        float along = dot(q, vdir);
        float across = dot(q, float2(-vdir.y, vdir.x));
        float dist = length(float2(along * (1.0 - streak), across));

        float size = minDim * 0.006 * (0.6 + h.x * 0.8) * depth;
        float spark = dop_particleSprite(dist, size);
        if (u.style > 0.001) {
            float crisp = smoothstep(size * 1.5, 0.0, dist);
            float2 star = abs(q);
            float spikes = exp(-star.x / (size * 0.45)) * exp(-star.y * star.y / (size * size * 0.5))
                         + exp(-star.y / (size * 0.45)) * exp(-star.x * star.x / (size * size * 0.5));
            spark = mix(spark, crisp + spikes * 0.6, u.style * 0.9);
        }
        float twinkle = 0.75 + 0.25 * sin(u.timeS * (6.0 + h2.y * 10.0) + h.x * TAU);
        float fade = (1.0 - pow(life, 1.3)) * smoothstep(0.0, 0.08, life);
        col += dop_paletteMix(h.y, u.c0, u.c1, u.c2) * spark * fade * twinkle * bloomGain * 1.2 * mix(0.9, 1.3, nearTier);
    }

    // ---- Checkmark drawn in light ----
    float cr = minDim * 0.11;
    float sw = cr * 0.12;
    float ccore = 0.0;
    float cglow = 0.0;
    float2 tip = u.origin;
    float drawing = 0.0;

    if (u.sdfOn > 0.5) {
        float bt = floor(u.timeS * 12.0);
        float2 boil = (dop_hash21(bt + 1.7) - 0.5) * cr * 0.05 * u.style;
        float2 gfrag = frag - boil;
        float axisHere; float distPx;
        float wipe = sdfCoverage(gfrag, u, sdfTex, texSampler, axisHere, distPx);
        float sw2 = u.sdfStrokePx;
        float softCore = smoothstep(sw2, sw2 * 0.35, distPx);
        float hardCore = 1.0 - smoothstep(sw2 * 0.85, sw2, distPx);
        ccore = mix(softCore, hardCore, u.style) * wipe;
        cglow = exp(-distPx / (sw2 * 2.0)) * 0.6 * (1.0 - 0.7 * u.style) * wipe;
        float frontier = clamp(u.check * 1.12, 0.0, 1.0);
        float2 boxUVtoPx = float2(2.0 * u.checkBox);
        float2 frontUV = float2(frontier, 0.30 + frontier * 0.55);
        tip = u.origin + (frontUV - 0.5) * boxUVtoPx;
        drawing = smoothstep(0.0, 0.04, u.check) * (1.0 - smoothstep(0.92, 1.06, u.check));
    } else if (u.checkTexOn > 0.5) {
        float bt = floor(u.timeS * 12.0);
        float2 boil = (dop_hash21(bt + 1.7) - 0.5) * cr * 0.05 * u.style;
        float2 gfrag = frag - boil;
        float axisHere;
        float cov = glyphCoverage(gfrag, u, checkTex, texSampler, axisHere);
        ccore = smoothstep(0.35, 0.6, cov);
        cglow = cov * 0.6 * (1.0 - 0.7 * u.style);
        float frontier = clamp(u.check * 1.12, 0.0, 1.0);
        float2 boxUVtoPx = float2(2.0 * u.checkBox);
        float2 frontUV = float2(frontier, 0.30 + frontier * 0.55);
        tip = u.origin + (frontUV - 0.5) * boxUVtoPx;
        drawing = smoothstep(0.0, 0.04, u.check) * (1.0 - smoothstep(0.92, 1.06, u.check));
    } else {
        float bt = floor(u.timeS * 12.0);
        float2 A = u.origin + cr * float2(-0.9, 0.15) + (dop_hash21(bt + 1.1) - 0.5) * cr * 0.06 * u.style;
        float2 B = u.origin + cr * float2(-0.25, -0.55) + (dop_hash21(bt + 2.2) - 0.5) * cr * 0.06 * u.style;
        float2 C = u.origin + cr * float2(1.0, 0.78) + (dop_hash21(bt + 3.3) - 0.5) * cr * 0.06 * u.style;
        float l1 = length(B - A), l2 = length(C - B);
        float total = l1 + l2;
        float drawn = u.check * total;
        float vis1 = clamp(drawn, 0.0, l1);
        tip = A + (B - A) * (vis1 / l1);
        float dseg = dop_sdSeg(frag, A, tip);
        if (drawn > l1) {
            float d2 = clamp(drawn - l1, 0.0, l2);
            tip = B + (C - B) * (d2 / l2);
            dseg = min(dseg, dop_sdSeg(frag, B, tip));
        }
        float softCore = smoothstep(sw, sw * 0.35, dseg);
        float hardCore = 1.0 - smoothstep(sw * 0.85, sw, dseg);
        ccore = mix(softCore, hardCore, u.style);
        cglow = exp(-dseg / (sw * 2.0)) * 0.7 * (1.0 - 0.7 * u.style);
        drawing = smoothstep(0.0, 0.04, u.check) * (1.0 - smoothstep(0.92, 1.06, u.check));
    }

    float tipDist = length(frag - tip);
    float tipSize = sw * 1.6;
    float sparkHead = tipSize / (tipDist + tipSize * 0.4);
    sparkHead *= sparkHead;
    float cFade = 1.0 - smoothstep(0.7, 1.0, u.life);
    float3 checkTint = mix(float3(1.0), u.c0 + 0.4, 0.5);
    col += (float3(1.0) * ccore * 1.6 + checkTint * cglow) * cFade * u.exposure;
    col += float3(1.0) * sparkHead * drawing * cFade * u.exposure * 2.0;

    // ---- Filmic tonemap + dither ----
    col = dop_tonemapACES(col * 0.62);

    if (u.style > 0.001) {
        float l = dot(col, float3(0.299, 0.587, 0.114));
        float3 neon = clamp(l + (col - l) * 1.6, 0.0, 1.0);
        float3 styled = mix(col, neon, 0.7);
        float bands = mix(40.0, 4.0, u.style);
        styled = floor(styled * bands + 0.5) / bands;
        col = mix(col, styled, u.style);
    }

    col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);
    // PREMULTIPLIED-alpha output: alpha = the light's own brightness. Dark
    // regions become transparent so the UI beneath shows through, and bright
    // bloom reads as cast light over it (returning opaque alpha=1 painted the
    // whole overlay black over the card). col is the emitted light, so
    // col_channel <= max(col) = alpha holds → valid premultiplied.
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    return float4(col, outA);
}

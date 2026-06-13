#include <metal_stdlib>
#include "DopamineLook.metal"
#include "SolarbloomUniforms.metal"
using namespace metal;

#define MAX_MOTES 80

struct VSOut { float4 position [[position]]; };
vertex VSOut solarbloom_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float2 ballisticPos(float2 origin, float2 dir, float speed, float gravity, float t) {
  return origin + dir * speed * t - float2(0.0, 1.0) * gravity * t * t;
}

inline float bloomProfile(float dn) {
  
  
  
  float core = exp(-dn * dn * 2.4) * 0.92;
  float halo = exp(-dn * 1.3) * 0.5;
  return core + halo;
}

inline float2 glyphUV(float2 frag, constant SolarbloomUniforms &u) {
  return(frag - u.origin) / (2.0 * u.checkBox) + 0.5;
}

inline float glyphDrawAxis(float2 uv) {
  return clamp((uv.x * 0.86 + uv.y * 0.14), 0.0, 1.0);
}

inline float glyphCoverage(float2 frag, constant SolarbloomUniforms &u, thread float &axisHere, texture2d<float> checkTex, texture2d<float> sdfTex, texture2d<float> motePanel, sampler texSampler) {
  float2 uv = glyphUV(frag, u);
  axisHere = glyphDrawAxis(uv);
  
  if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float a = checkTex.sample(texSampler, uv).a;
  
  
  float frontier = u.check * 1.12;
  float wipe = smoothstep(frontier, frontier - 0.07, axisHere);
  return a * wipe;
}

inline float sdfCoverage(float2 frag, constant SolarbloomUniforms &u, thread float &axisHere, thread float &distPx, texture2d<float> checkTex, texture2d<float> sdfTex, texture2d<float> motePanel, sampler texSampler) {
  float2 uv = glyphUV(frag, u);
  
  
  
  
  
  
  float2 cl = clamp(uv, 0.0, 1.0);
  axisHere = glyphDrawAxis(cl);
  float nd = sdfTex.sample(texSampler, cl).r;
  float outsidePx = length((uv - cl) * 2.0 * u.checkBox);
  distPx = nd * u.sdfRangePx + outsidePx;
  float frontier = u.check * 1.12;
  float wipe = smoothstep(frontier, frontier - 0.07, axisHere);
  return wipe;
}

inline float bloomOcc(float2 p, float r, constant SolarbloomUniforms &u) {
  float dn = length(p - u.origin) / r;
  return exp(-dn * dn * 2.0) * 0.9 + exp(-dn * 1.4) * 0.18;
}

inline float checkOcc(float2 p, float minDim, constant SolarbloomUniforms &u, texture2d<float> checkTex, texture2d<float> sdfTex, texture2d<float> motePanel, sampler texSampler) {
  float cr = minDim * 0.11;
  float sw = cr * 0.12;
  if(u.sdfOn > 0.5) {
    float axisHere; float distPx;
    float wipe = sdfCoverage(p, u, axisHere, distPx, checkTex, sdfTex, motePanel, texSampler);
    return(1.0 - smoothstep(u.sdfStrokePx * 0.6, u.sdfStrokePx * 1.4, distPx)) * wipe * 0.8;
  } else if(u.checkTexOn > 0.5) {
    float axisHere;
    return glyphCoverage(p, u, axisHere, checkTex, sdfTex, motePanel, texSampler) * 0.8;
  }
  float2 A = u.origin + cr * float2(-0.9, 0.15);
  float2 B = u.origin + cr * float2(-0.25, -0.55);
  float2 C = u.origin + cr * float2(1.0, 0.78);
  float l1 = length(B - A), l2 = length(C - B);
  float drawn = u.check * (l1 + l2);
  float vis1 = clamp(drawn, 0.0, l1);
  float2 tip = A + (B - A) * (vis1 / l1);
  float dseg = dop_sdSeg(p, A, tip);
  if(drawn > l1) {
    float d2 = clamp(drawn - l1, 0.0, l2);
    float2 tip2 = B + (C - B) * (d2 / l2);
    dseg = min(dseg, dop_sdSeg(p, B, tip2));
  }
  return(1.0 - smoothstep(sw * 0.6, sw * 1.4, dseg)) * 0.8;
}

inline float4 shadowColor(float2 frag, constant SolarbloomUniforms &u, texture2d<float> checkTex, texture2d<float> sdfTex, texture2d<float> motePanel, sampler texSampler) {
  float minDim = min(u.resolution.x, u.resolution.y);
  float r = u.bloomRadius * minDim;
  
  
  float2 sp = frag - u.shadowOffset;
  float soft = u.shadowSoft;
  float s2 = soft * 0.7071;
  float2 taps[9];
  taps[0] = sp;
  taps[1] = sp + float2( soft, 0.0);
  taps[2] = sp + float2(-soft, 0.0);
  taps[3] = sp + float2(0.0,  soft);
  taps[4] = sp + float2(0.0, -soft);
  taps[5] = sp + float2( s2,  s2);
  taps[6] = sp + float2(-s2,  s2);
  taps[7] = sp + float2( s2, -s2);
  taps[8] = sp + float2(-s2, -s2);

  
  float occ[9];
  for(int k = 0; k < 9; k++) occ[k] = bloomOcc(taps[k], r, u) + checkOcc(taps[k], minDim, u, checkTex, sdfTex, motePanel, texSampler);

  
  
  for(int k = 0; k < 9; k++) {
    float3 m = motePanel.sample(texSampler, taps[k] / u.resolution).rgb;
    occ[k] += max(max(m.r, m.g), m.b) * 0.6;
  }

  
  float blurred = 0.0;
  for(int k = 0; k < 9; k++) blurred += clamp(occ[k] * u.amp, 0.0, 1.0);
  blurred /= 9.0;
  
  float dark = clamp(blurred, 0.0, 1.0) * u.shadowStrength;
  
  
  float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.25);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 solarbloom_fragment(
    VSOut in [[stage_in]],
    constant SolarbloomUniforms &u [[buffer(0)]],
    texture2d<float> checkTex [[texture(0)]],
    texture2d<float> sdfTex [[texture(1)]],
    texture2d<float> motePanel [[texture(3)]],
    sampler texSampler [[sampler(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float minDim = min(u.resolution.x, u.resolution.y);
  float r = u.bloomRadius * minDim;
  float3 col = float3(0.0);

  if(u.shadow > 0.5) {
    return shadowColor(frag, u, checkTex, sdfTex, motePanel, texSampler);
  }

  float2 rel = frag - u.origin;
  float ang = atan2(rel.y, rel.x);
  float d = length(rel);
  float2 ndir = rel / max(d, 1e-4);

  
  
  
  
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

  
  
  
  
  
  
  
  col += motePanel.sample(texSampler, float2(in.position.x, u.resolution.y - in.position.y) / u.resolution).rgb * bloomGain;

  
  
  
  
  
  float cr = minDim * 0.11;
  float sw = cr * 0.12;
  float ccore;   
  float cglow;   
  float2  tip;     
  float drawing; 

  if(u.sdfOn > 0.5) {
    
    
    
    
    float bt = floor(u.timeS * 12.0);
    float2 boil = (dop_hash21(bt + 1.7) - 0.5) * cr * 0.05 * u.style;
    float2 gfrag = frag - boil;
    float axisHere; float distPx;
    float wipe = sdfCoverage(gfrag, u, axisHere, distPx, checkTex, sdfTex, motePanel, texSampler);
    float sw2 = u.sdfStrokePx;
    float softCore = smoothstep(sw2, sw2 * 0.35, distPx);
    float hardCore = 1.0 - smoothstep(sw2 * 0.85, sw2, distPx);
    ccore = mix(softCore, hardCore, u.style) * wipe;
    cglow = exp(-distPx / (sw2 * 2.0)) * 0.6 * (1.0 - 0.7 * u.style) * wipe;
    
    
    
    cglow *= 1.0 - smoothstep(u.sdfRangePx * 0.55, u.sdfRangePx * 0.9, distPx);
    float frontier = clamp(u.check * 1.12, 0.0, 1.0);
    float2 boxUVtoPx = float2(2.0 * u.checkBox);
    float2 frontUV = float2(frontier, 0.30 + frontier * 0.55);
    tip = u.origin + (frontUV - 0.5) * boxUVtoPx;
    drawing = smoothstep(0.0, 0.04, u.check) * (1.0 - smoothstep(0.92, 1.06, u.check));
  } else if(u.checkTexOn > 0.5) {
    
    
    
    float bt = floor(u.timeS * 12.0);
    float2 boil = (dop_hash21(bt + 1.7) - 0.5) * cr * 0.05 * u.style;
    float2 gfrag = frag - boil;
    float axisHere;
    float cov = glyphCoverage(gfrag, u, axisHere, checkTex, sdfTex, motePanel, texSampler);
    
    
    ccore = smoothstep(0.35, 0.6, cov);
    cglow = cov * 0.6 * (1.0 - 0.7 * u.style);
    
    
    
    float frontier = clamp(u.check * 1.12, 0.0, 1.0);
    
    float2 axisDir = normalize(float2(0.86, 0.14));
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
    if(drawn > l1) {
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
  
  
  
  
  
  float checkExposure = 1.5;
  col += (float3(1.0) * ccore * 1.6 + checkTint * cglow) * cFade * checkExposure;
  col += float3(1.0) * sparkHead * drawing * cFade * checkExposure * 2.0;

  
  
  
  col = dop_tonemapACES(col * 0.62);

  
  
  
  
  if(u.style > 0.001) {
    float l = dot(col, float3(0.299, 0.587, 0.114));
    float3 neon = clamp(l + (col - l) * 1.6, 0.0, 1.0);     
    float3 styled = mix(col, neon, 0.7);
    float bands = mix(40.0, 4.0, u.style);                 
    styled = floor(styled * bands + 0.5) / bands;
    col = mix(col, styled, u.style);
  }

  
  
  
  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);

  float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    return float4(col, outA);
}

#include <metal_stdlib>
#include "DopamineLook.metal"
#include "FailUniforms.metal"
using namespace metal;

struct VSOut { float4 position [[position]]; };
vertex VSOut fail_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float2 boxUV(float2 frag, constant FailUniforms &u) { return(frag - u.origin) / (2.0 * u.boxPx) + 0.5; }

inline float crossDist(float2 frag, constant FailUniforms &u, texture2d<float> sdfTex, sampler texSampler) {
  if(u.sdfOn > 0.5) {
    float2 uv = boxUV(frag, u);
    if(uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1e9;
    return sdfTex.sample(texSampler, uv).r * u.sdfRangePx;
  }
  
  float r = u.boxPx * 0.62;
  float2 a1 = u.origin + float2(-r, -r), b1 = u.origin + float2(r, r);
  float2 a2 = u.origin + float2(-r,  r), b2 = u.origin + float2(r, -r);
  return min(dop_sdSeg(frag, a1, b1), dop_sdSeg(frag, a2, b2));
}

inline float stampGate(float2 frag, constant FailUniforms &u) {
  float2 uv = boxUV(frag, u) - 0.5;            
  
  
  float axis = clamp(0.5 + 0.5 * (abs(uv.x) + abs(uv.y)), 0.0, 1.0);
  float frontier = u.stamp * 1.15;
  return smoothstep(frontier, frontier - 0.12, axis);
}

inline float flare(float2 frag, float minDim, constant FailUniforms &u) {
  float d = length(frag - u.origin);
  float r = minDim * mix(0.16, 0.30, u.severity);
  float dn = d / r;
  return(exp(-dn * dn * 2.2) * 0.9 + exp(-dn * 1.6) * 0.25);
}

inline float occlusion(float2 p, float minDim, constant FailUniforms &u, texture2d<float> sdfTex, sampler texSampler) {
  float occ = flare(p, minDim, u) * 0.7;
  float dc = crossDist(p, u, sdfTex, texSampler);
  occ += (1.0 - smoothstep(u.sdfStrokePx * 0.6, u.sdfStrokePx * 1.5, dc)) * stampGate(p, u) * 0.9;
  return clamp(occ * u.amp, 0.0, 1.0);
}

inline float4 shadowColor(float2 frag, constant FailUniforms &u, texture2d<float> sdfTex, sampler texSampler) {
  float minDim = min(u.resolution.x, u.resolution.y);
  float2 sp = frag - u.shadowOffset;
  float occ = occlusion(sp, minDim, u, sdfTex, texSampler);
  float s = u.shadowSoft;
  occ += occlusion(sp + float2(s,0.0), minDim, u, sdfTex, texSampler);
  occ += occlusion(sp + float2(-s,0.0), minDim, u, sdfTex, texSampler);
  occ += occlusion(sp + float2(0.0,s), minDim, u, sdfTex, texSampler);
  occ += occlusion(sp + float2(0.0,-s), minDim, u, sdfTex, texSampler);
  occ /= 5.0;
  float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength;
  
  float3 tint = mix(float3(1.0), float3(0.72, 0.66, 0.66), 1.0);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 fail_fragment(
    VSOut in [[stage_in]],
    constant FailUniforms &u [[buffer(0)]],
    texture2d<float> sdfTex [[texture(1)]],
    sampler texSampler [[sampler(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float minDim = min(u.resolution.x, u.resolution.y);

  if(u.shadow > 0.5) { return shadowColor(frag, u, sdfTex, texSampler); }

  
  
  float shakePx = u.shake * minDim * 0.012;
  float glitch = 0.0;
  if(u.style > 0.001) {
    float band = floor(frag.y / max(2.0, minDim * 0.02));
    float g = dop_hash11(band + floor(u.timeS * 30.0));
    glitch = (step(0.82, g) * (g - 0.82) / 0.18) * minDim * 0.05 * u.style * u.amp;
  }
  float2 sf = frag - float2(shakePx + glitch, 0.0);

  float3 col = float3(0.0);

  
  
  
  
  
  float fl = flare(sf, minDim, u);
  float rn = clamp(length(sf - u.origin) / (minDim * 0.3), 0.0, 1.0);
  float3 ember = u.c0 * mix(1.0, 0.45, rn);          
  col += ember * fl * u.amp * u.exposure * mix(0.9, 1.25, u.severity);

  
  float dc = crossDist(sf, u, sdfTex, texSampler);
  float gate = stampGate(sf, u);
  float sw = u.sdfStrokePx;
  float soft = smoothstep(sw, sw * 0.3, dc);
  float hard = 1.0 - smoothstep(sw * 0.85, sw, dc);
  float core = mix(soft, hard, u.style) * gate;
  float rim = exp(-dc / (sw * 2.2)) * 0.7 * gate;
  
  
  
  
  
  rim *= 1.0 - smoothstep(u.sdfRangePx * 0.55, u.sdfRangePx * 0.9, dc);
  
  
  float3 crossTint = mix(float3(1.0), u.c0 + 0.35, 0.5);
  float collapse = 1.0 - smoothstep(0.6, 1.0, u.life);
  col += (float3(1.0) * core * 1.7 + crossTint * rim) * collapse * u.exposure;

  
  float flash = exp(-u.stamp * 6.0) * (1.0 - u.stamp);
  col += crossTint * flash * core * 1.2 * u.exposure;

  
  col = dop_tonemapACES(col * 0.7);

  
  if(u.style > 0.001) {
    
    float sep = minDim * 0.004 * u.style * u.amp;
    float dr = crossDist(sf - float2(sep, 0.0), u, sdfTex, texSampler);
    float db = crossDist(sf + float2(sep, 0.0), u, sdfTex, texSampler);
    float gr = (1.0 - smoothstep(sw*0.85, sw, dr)) * gate * collapse;
    float gb = (1.0 - smoothstep(sw*0.85, sw, db)) * gate * collapse;
    col.r = max(col.r, gr * 1.2 * u.exposure);
    col.b = max(col.b, gb * 1.2 * u.exposure);
    
    float l = dot(col, float3(0.299, 0.587, 0.114));
    col = mix(col, float3(l), u.style * 0.5 * smoothstep(0.4, 1.0, u.life));
    
    float scan = 0.92 + 0.08 * sin(frag.y * 3.14159);
    col *= mix(1.0, scan, u.style * 0.6);
  }

  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);
  float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    return float4(col, outA);
}

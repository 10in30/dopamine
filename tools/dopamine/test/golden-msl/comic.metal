#include <metal_stdlib>
#include "DopamineLook.metal"
#include "ComicUniforms.metal"
using namespace metal;

struct VSOut { float4 position [[position]]; };
vertex VSOut comic_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float2x2 rot2(float a) { float s = sin(a), c = cos(a); return float2x2(float2(c, -s), float2(s, c)); }

inline float benday(float2 frag, float cell, float v, float ang) {
  float2 p = rot2(ang) * frag / cell;
  float2 g = fract(p) - 0.5;
  float d = length(g);
  float r = 0.52 * sqrt(clamp(v, 0.0, 1.0));
  float aa = 0.7 / cell + fwidth(d);
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

fragment float4 comic_fragment(
    VSOut in [[stage_in]],
    constant ComicUniforms &u [[buffer(0)]],
    texture2d<float> panelTex [[texture(0)]],
    sampler texSampler [[sampler(0)]]
) {
    float2 vUv = float2(in.position.x, u.resolution.y - in.position.y) / u.resolution;
  float2 frag = vUv * u.resolution;
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);
  
  
  
  
  float comicSpan = min(min(u.target.x, u.target.y) * 1.7, minDim);

  
  
  
  
  
  if(u.shadow > 0.5) {
    float2 px = 1.0 / res;
    float2 souv = vUv - u.shadowOffset * px;
    float occ = 0.0;
    for(int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * TAU;
      float2 o = float2(cos(a), sin(a)) * u.shadowSoft * px;
      float2 tuv = souv + o;
      
      
      
      
      float2 inb = step(float2(0.0), tuv) * step(tuv, float2(1.0));
      float mask = inb.x * inb.y;
      float4 s = panelTex.sample(texSampler, tuv);
      occ += clamp(s.r + s.b, 0.0, 1.0) * mask;
    }
    occ /= 8.0;
    float dark = clamp(occ * u.shadowStrength, 0.0, 1.0);
    return float4(float3(1.0 - dark), 1.0);
  }

  float2 fromC = frag - uCenter;
  float rad = length(fromC);
  float ang = atan2(fromC.y, fromC.x);

  float4 panel = panelTex.sample(texSampler, vUv);
  float wordFill = panel.r;
  float inkMask  = clamp(panel.g * u.inkBoost, 0.0, 1.0);
  float burstFill = panel.b;

  float3 col = float3(0.0);

  
  
  
  
  float lineN = max(u.actionLines, 1.0);
  float a01 = (ang / TAU) + 0.5;                 
  float idx = floor(a01 * lineN);
  
  float jr = dop_hash11(idx + u.comicSeed * 3.1);
  float jr2 = dop_hash11(idx * 1.7 + u.comicSeed * 7.3);
  float cellPhase = fract(a01 * lineN);
  float wedge = abs(cellPhase - 0.5);
  
  
  float thick = mix(0.05, 0.14, jr);
  float lineBody = 1.0 - smoothstep(thick * 0.35, thick, wedge);
  
  float innerR = comicSpan * (0.30 + 0.05 * jr2);
  float outerR = comicSpan * (0.46 + 0.30 * jr);
  float radialMask = smoothstep(innerR, innerR + comicSpan * 0.015, rad)
                   * (1.0 - smoothstep(outerR - comicSpan * 0.10, outerR, rad));
  
  float linePresence = smoothstep(0.0, 0.06, u.life) * (1.0 - smoothstep(0.6, 1.0, u.life));
  
  float taper = 1.0 - smoothstep(innerR, outerR, rad);
  float lines = lineBody * radialMask * linePresence * taper;
  
  float beat = floor(u.timeS * 12.0);
  float flick = mix(1.0, step(0.25, dop_hash11(idx + beat + u.comicSeed)), u.style * 0.5);
  lines *= flick;

  
  
  
  float3 lineCol = mix(float3(0.7, 0.74, 0.82), u.c2, u.style);
  col += lineCol * lines * 0.32 * u.exposure;

  
  
  
  
  float3 burstBase = mix(float3(0.9), u.c1, u.saturation);
  
  
  float burstTone = mix(0.35, 0.7, u.halftone);
  float dots = benday(frag, u.dotSize, burstTone, ((15.0) * 0.017453292519943295) + u.comicSeed);
  
  
  float3 burstCol = burstBase + (u.c2 - burstBase) * dots * u.halftone * 0.55;
  col += burstCol * burstFill * u.presence * u.exposure;

  
  
  
  
  
  float wordDots = benday(frag, u.dotSize * 0.7, 0.5, ((75.0) * 0.017453292519943295) + u.comicSeed);
  float3 wordBright = clamp(u.c0 * 1.35 + 0.25, 0.0, 1.4);
  float3 wordBase = mix(float3(0.96, 0.97, 1.0), wordBright, clamp(u.saturation + 0.2, 0.0, 1.0));
  float3 wordCol = wordBase + (u.c2 - wordBase) * wordDots * u.halftone * 0.25 * u.style;
  
  
  col += wordCol * wordFill * u.presence * u.exposure * 1.7;

  
  
  
  
  
  
  float ink = inkMask * u.presence;
  
  
  
  
  
  
  
  
  float carve = ink * (0.45 - 0.19 * wordFill);
  col *= (1.0 - carve);
  
  float rim = ink * (1.0 - u.style) * 0.18;
  col += mix(u.c2, float3(0.8, 0.85, 1.0), 0.5) * rim * u.exposure;

  
  
  
  float flashFall = exp(-rad / (minDim * 0.42));
  float3 flashCol = mix(mix(u.c0, u.c1, 0.5), float3(1.0), 0.45 + 0.3 * u.style);
  col += flashCol * flashFall * u.flash * u.exposure * 1.4;
  
  float core = exp(-rad / (minDim * 0.10));
  col += float3(1.0) * core * u.flash * u.flash * 1.6;

  
  
  
  
  
  col = dop_tonemapACES(col * 0.85);

  
  
  
  if(u.style > 0.001) {
    float lit = smoothstep(0.02, 0.2, max(max(col.r, col.g), col.b));
    float3 q = floor(col * 4.0 + 0.5) / 4.0;
    col = mix(col, mix(col, q, lit), u.style * 0.7);
  }

  
  
  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style * 0.7);

  col = max(col, 0.0);
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    return float4(col, outA);
}

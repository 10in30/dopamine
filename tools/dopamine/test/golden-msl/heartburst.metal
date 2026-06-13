#include <metal_stdlib>
#include "DopamineLook.metal"
#include "HeartburstUniforms.metal"
using namespace metal;

struct VSOut { float4 position [[position]]; };
vertex VSOut heartburst_vertex(uint vid [[vertex_id]]) {
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

fragment float4 heartburst_fragment(
    VSOut in [[stage_in]],
    constant HeartburstUniforms &u [[buffer(0)]],
    texture2d<float> panel [[texture(0)]],
    sampler texSampler [[sampler(0)]]
) {
    float2 vUv = float2(in.position.x, u.resolution.y - in.position.y) / u.resolution;
  float2 frag = vUv * u.resolution;
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);

  
  
  
  
  
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
      float4 s = panel.sample(texSampler, tuv);
      occ += clamp(s.r + s.b, 0.0, 1.0) * mask;
    }
    occ /= 8.0;
    float dark = clamp(occ * u.shadowStrength, 0.0, 1.0);
    return float4(float3(1.0 - dark), 1.0);
  }

  float2 fromC = frag - u.origin;
  float rad = length(fromC);

  float4 panel = panel.sample(texSampler, vUv);
  float heartFill = panel.r;
  float ink = panel.g;
  float burstFill = panel.b;

  float3 col = float3(0.0);

  
  
  
  
  float glowR = minDim * (0.18 + 0.30 * u.glow) * (1.0 + 0.25 * u.beat);
  float bloom = exp(-rad / glowR);
  float bloomAmp = (0.35 + 0.65 * u.beat) * (0.6 + 0.8 * u.burst * (1.0 - u.burst) * 3.0);
  float3 glowCol = mix(u.c0, u.c2, 0.45 + 0.3 * u.saturation);
  col += glowCol * bloom * bloomAmp * u.presence * u.glow * u.exposure * 0.9;

  
  
  
  
  
  
  float vshade = clamp(1.0 - vUv.y, 0.0, 1.0);
  float3 bodyLit  = mix(u.c1, u.c0, 0.35 + 0.65 * u.saturation);          
  float3 bodyHi   = clamp(bodyLit * 1.5 + 0.18, 0.0, 1.6);             
  float3 bodyLow  = bodyLit * 0.55;                                     
  
  float g = smoothstep(0.15, 0.95, vshade);
  float gCel = step(0.5, vshade);
  float grad = mix(g, gCel, u.style);
  float3 heartCol = mix(bodyLow, bodyHi, grad);

  
  
  
  float edge = 0.0;
  {
    float2 px = 1.0 / res;
    for(int i = 0; i < 6; i++){
      float a = float(i) / 6.0 * TAU;
      edge += panel.sample(texSampler, vUv + float2(cos(a), sin(a)) * px * 3.0).r;
    }
    edge /= 6.0;
  }
  float rimDark = clamp((heartFill - edge), 0.0, 1.0); 
  heartCol *= 1.0 - rimDark * 0.5 * (1.0 - u.style);

  
  float blush = benday(frag, u.dotSize, mix(0.35, 0.6, u.halftone), radians(20.0) + u.heartburstSeed);
  heartCol += (u.c2 - heartCol) * blush * u.halftone * u.style * 0.28;

  col += heartCol * heartFill * u.presence * u.exposure * 1.6;

  
  
  
  
  float gloss = ink * heartFill;          
  float glossAmt = u.gloss * (1.0 - u.style) * (0.6 + 0.6 * u.beat);
  col += float3(1.0) * gloss * glossAmt * u.presence * 1.4;

  
  
  
  
  float burstFade = 1.0 - smoothstep(0.55, 1.0, u.burst);
  float3 littleCol = mix(u.c1, u.c2, 0.3 + 0.4 * u.saturation);
  littleCol = clamp(littleCol * 1.25 + 0.1, 0.0, 1.5);
  col += littleCol * burstFill * u.presence * burstFade * u.exposure * 1.5;
  
  col += littleCol * burstFill * 0.4 * burstFade * (0.5 + 0.5 * sin(u.timeS * 30.0 + u.heartburstSeed));

  
  
  
  
  
  float contour = ink * (1.0 - heartFill);  
  float carve = contour * u.presence * mix(0.45, 0.95, u.style);
  col *= (1.0 - carve);

  
  
  
  float flashFall = exp(-rad / (minDim * 0.40));
  float3 flashCol = mix(u.c0, float3(1.0, 0.85, 0.8), 0.4 + 0.25 * u.style);
  col += flashCol * flashFall * u.flash * u.exposure * 1.2;
  
  float core = exp(-rad / (minDim * 0.08));
  col += float3(1.0, 0.92, 0.9) * core * u.flash * u.beat * 1.3;

  
  col = dop_tonemapACES(col * 0.9);

  
  
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

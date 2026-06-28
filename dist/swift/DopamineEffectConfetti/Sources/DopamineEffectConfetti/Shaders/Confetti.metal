#include <metal_stdlib>
#include "DopamineLook.metal"
#include "ConfettiUniforms.metal"
using namespace metal;

struct VSOut { float4 position [[position]]; };
vertex VSOut confetti_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

fragment float4 confetti_fragment(
    VSOut in [[stage_in]],
    constant ConfettiUniforms &u [[buffer(0)]],
    texture2d<float> panelTex [[texture(0)]],
    sampler texSampler [[sampler(0)]]
) {
    float2 vUv = float2(in.position.x, u.resolution.y - in.position.y) / u.resolution;
  float2 frag = vUv * u.resolution;

  
  
  
  if(u.shadow > 0.5) {
    float2 px = 1.0 / u.resolution;
    float2 souv = vUv - u.shadowOffset * px;
    float occ = 0.0;
    for(int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * TAU;
      float2 o = float2(cos(a), sin(a)) * u.shadowSoft * px;
      float2 tuv = souv + o;
      float2 inb = step(float2(0.0), tuv) * step(tuv, float2(1.0));
      float3 s = panelTex.sample(texSampler, tuv).rgb;
      occ += (s.r + s.g + s.b) * (1.0 / 3.0) * inb.x * inb.y;
    }
    occ /= 8.0;
    float dark = clamp(occ * u.amp, 0.0, 1.0) * u.shadowStrength;
    float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.2);
    float3 mul = mix(float3(1.0), tint, dark);
    return float4(mul, 1.0);
  }

  
  
  
  float3 col = panelTex.sample(texSampler, vUv).rgb * (u.amp * u.exposure) * 1.35;

  col = dop_tonemapACES(col * 0.85);

  
  if(u.style > 0.001) {
    float l = dot(col, float3(0.299, 0.587, 0.114));
    float3 neon = clamp(l + (col - l) * 1.5, 0.0, 1.0);
    float3 styled = mix(col, neon, 0.65);
    float bands = mix(40.0, 5.0, u.style);
    styled = floor(styled * bands + 0.5) / bands;
    col = mix(col, styled, u.style);
  }

  
  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);

  col = max(col, 0.0);
    float bk = clamp(u.backdropLum, 0.0, 1.0);
    float luma = dot(col, float3(0.2126, 0.7152, 0.0722));
    col = max(mix(float3(luma), col, 1.0 + bk * 1.100), 0.0);
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    outA = pow(outA, 1.0 + bk * 1.600);
    return float4(col, outA);
}

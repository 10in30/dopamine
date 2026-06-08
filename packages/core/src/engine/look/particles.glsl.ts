/**
 * Shared GPU-particle GLSL chunk.
 *
 * Solarbloom's drifting "motes" and Verdict's flung "droplets" are both
 * point-sprite particle fields that differ only in their MOTION model (motes:
 * outward drift + buoyancy + curl, with motion-blur streaks; droplets: a
 * ballistic arc under gravity) and their styling. The cross-pollination plan
 * asks for one parametric particle module behind a shared include + params.
 *
 * Here we extract the parts that were duplicated verbatim between the two: the
 * per-particle soft round sprite (`particleSprite`), the ballistic position
 * (`ballisticPos`), and the standard fade-in/out over a particle's life
 * (`particleFade`). Each effect keeps its own emit shape + motion (the part that
 * is its identity) and composes these shared primitives, so the dot falloff,
 * the gravity arc and the lifetime curve no longer drift between effects.
 *
 * Comic debris can adopt the same primitives later (deferred — noted in the
 * plan as P2). Requires no other chunk.
 */

export const GLSL_PARTICLES = /* glsl */ `
// Soft round particle sprite: an inverse-distance dot that, squared, gives the
// glowing-photon falloff both motes and droplets use. \`d\` is distance to the
// particle centre, \`size\` its radius in device px.
float particleSprite(float d, float size){
  float s = size / (d + size * 0.5);
  return s * s;
}

// Ballistic arc: launch from \`origin\` along \`dir\` at \`speed\`, pulled down by
// \`gravity\` (device px) over normalized particle life \`t\` (0..1). Screen y is
// up, so gravity subtracts on y. Used by Verdict's flung ink droplets and any
// effect that wants sparks thrown off an impact.
vec2 ballisticPos(vec2 origin, vec2 dir, float speed, float gravity, float t){
  return origin + dir * speed * t - vec2(0.0, 1.0) * gravity * t * t;
}

// Standard particle fade: ramps in fast then fades out across its life. \`t\` is
// normalized particle life (0..1); \`tailPow\` shapes the decay (higher = longer
// luminous body before it dims).
float particleFade(float t, float tailPow){
  return (1.0 - pow(t, tailPow)) * smoothstep(0.0, 0.08, t);
}
`;

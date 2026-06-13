/**
 * Confetti's bespoke timing — the launch-then-fall amplitude envelope.
 *
 * Unlike the success effects' held-breath `envelope` (which decays from its
 * early peak), confetti stays BRIGHT through the long fall — per-piece
 * `particleFade` in the shader handles each piece dimming as it lands. So this
 * is a sharp POP attack (overshoot at launch), a near-full sustain while
 * everything falls, then a gentle fade only at the very end as the last pieces
 * settle. Built on the generic `easeOutBack`/`easeOutCubic` primitives.
 */

import { easeOutBack, easeOutCubic } from "@dopaminefx/core";

/** Confetti launch-then-fall amplitude over normalized life. Peak > 1 at launch. */
export function confettiAmp(life: number, overshoot: number): number {
  if (life <= 0 || life >= 1) return 0;
  const attack = 0.12;
  if (life < attack) {
    // Sharp pop with a little overshoot (the burst leaving the action).
    return easeOutBack(life / attack, overshoot);
  }
  // Long luminous sustain, then a soft fade over the last ~30% as pieces settle.
  const tailStart = 0.7;
  if (life < tailStart) return 1;
  const x = (life - tailStart) / (1 - tailStart);
  return 1 - easeOutCubic(x) * 0.85;
}

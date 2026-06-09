/**
 * Halo's timing — the ONE genuinely time-varying helper for the config `frame()`.
 *
 * Halo is Dopamine's first CONTINUOUS effect, so unlike the nine one-shot reward
 * effects it does NOT use the held-breath `envelope(life)` (a 0→peak→0 fade that
 * would not loop). Its `amp` is instead a STEADY, gently PERIODIC "breathe" gate
 * driven off elapsed seconds: a slow sine of the loop period that swings between
 * ~0.7 and ~1.0. Because it is periodic in `timeS` with the SAME period the
 * `.dope` makes `tempo.durationMs` an integer multiple of, `haloBreathe(0) ==
 * haloBreathe(N·period)` — the loop seam is exact at every whimsy (the on-twos
 * snap is itself periodic; see halo-shader.ts).
 *
 * This is the analog of ripple's inline envelope, lifted into a named tempo file
 * (the per-effect `<name>-tempo.ts` convention) so the Swift + Android ports have
 * a parallel home for the same one line.
 */

const TAU = Math.PI * 2;

/**
 * Halo's steady breathe gate at elapsed seconds `timeS` for loop period
 * `periodS` (seconds). Returns ~0.7..1.0; `haloBreathe(0) === 0.85` and the
 * function is periodic with period `periodS`, so the loop is seamless. NOT a
 * life-based fade — there is no attack/decay, so re-firing (or a long duration)
 * loops with no visible seam.
 */
export function haloBreathe(timeS: number, periodS: number): number {
  const ph = (TAU * timeS) / Math.max(periodS, 1e-3);
  return 0.85 + 0.15 * Math.sin(ph);
}

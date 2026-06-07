/**
 * Animation tempo — the "natural" timing that makes the effect feel alive.
 *
 * Two layers, per the reward-timing research:
 *  1. Functional confirmation (the checkmark) draws within ~240 ms regardless of
 *     total duration — fast enough to land near the ~100 ms reward-prediction
 *     signal and read as an unambiguous "it worked".
 *  2. The affective afterglow (the bloom) follows a fast attack → held-breath
 *     overshoot → long gentle decay. It may linger past 500 ms because it is
 *     non-blocking (pointer-events: none) and gates no task.
 *
 * Linear motion reads as unnatural, so everything here is eased.
 */

/** Window (ms) over which the checkmark draws in, independent of total length. */
export const CHECK_DRAW_MS = 240;

/**
 * Coarse animation step (ms) for the hand-drawn "animate on twos" look at full
 * whimsy — ~12 updates/sec, i.e. 24fps on twos. Motion is snapped toward this
 * grid as style rises (see the renderer), giving discrete, posed beats instead
 * of smooth interpolation.
 */
export const NPR_TIME_STEP_MS = 1000 / 12;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Classic ease-out cubic — quick start, gentle settle. */
export function easeOutCubic(x: number): number {
  const t = clamp01(x);
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Ease-out "back" — overshoots past 1 then settles exactly to 1 at x=1. This is
 * the held-breath release. `overshoot` scales how far past 1 it swells.
 */
export function easeOutBack(x: number, overshoot = 1): number {
  const t = clamp01(x);
  const c1 = 1.70158 * overshoot;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Bloom amplitude over normalized life `t` ∈ [0, 1].
 * Fast attack with overshoot in the first ~18%, then a long decay to zero.
 * `envelope(0) === 0`, `envelope(1) === 0`, peak > 1 during the attack.
 */
export function envelope(t: number, overshoot = 1): number {
  if (t <= 0 || t >= 1) return 0;
  const attack = 0.18;
  if (t < attack) {
    return easeOutBack(t / attack, overshoot);
  }
  const x = (t - attack) / (1 - attack);
  // Decays from 1 → 0; exponent > 1 keeps a slow, luxurious tail.
  return Math.pow(1 - x, 1.6);
}

/** Checkmark draw progress (0..1) given elapsed ms. */
export function checkProgress(elapsedMs: number): number {
  return easeOutCubic(elapsedMs / CHECK_DRAW_MS);
}

/**
 * Window (ms) over which the calligraphic stroke writes itself. A confident
 * gesture: a touch longer than a checkmark tick so the pressure belly + flick
 * read, but still inside the ~250–360 ms confirmation band so it lands as "done"
 * immediately rather than as a slow build.
 */
export const STROKE_DRAW_MS = 360;

/**
 * Calligraphic stroke / pen progress (0..1) over elapsed ms. The pen accelerates
 * into the gesture then eases off the flick — modelled as ease-out cubic so the
 * heavy belly is laid quickly and the exit decelerates into the upward flick.
 */
export function strokeProgress(elapsedMs: number): number {
  return easeOutCubic(elapsedMs / STROKE_DRAW_MS);
}

/**
 * Window (ms) over which the comic onomatopoeia word SLAMS in. Deliberately
 * very short — a hard, fast IMPACT — so the word reads as a punch landing, not
 * a tween. The word scales from huge → settles, overshooting (recoil) en route.
 */
export const IMPACT_MS = 200;

/** Hold (ms) the word sits proud at full size before it begins to settle out. */
export const IMPACT_HOLD_MS = 650;

/**
 * Comic impact SCALE over elapsed ms. The word arrives oversized and slams down
 * past its rest size, recoils (a quick spring), holds, then eases out at the
 * tail. Returns a multiplier on rest size:
 *   - t≈0           : large (≈1 + overshoot*0.8) — caught mid-slam, big
 *   - ~IMPACT_MS    : ≈1 (rest), having overshot slightly below then back
 *   - hold window   : gentle breathing ≈1
 *   - tail          : sags toward ~0.92 as it fades (handled by the renderer's
 *                     opacity; scale stays close to rest so letters stay legible)
 *
 * `overshoot` scales the slam magnitude (driven by intensity).
 */
export function impactScale(elapsedMs: number, overshoot = 1): number {
  const t = elapsedMs;
  if (t <= 0) return 1 + 0.85 * overshoot;
  if (t < IMPACT_MS) {
    // Slam: shrink from oversized down through a small undershoot, spring to 1.
    const x = t / IMPACT_MS;
    const eased = easeOutCubic(x);
    const big = 1 + 0.85 * overshoot;
    // overshoot dip slightly below 1 around 75% then back to exactly 1.
    const dip = -0.12 * overshoot * Math.sin(x * Math.PI) * (1 - x);
    return big + (1 - big) * eased + dip;
  }
  return 1;
}

/**
 * Comic impact OPACITY/presence over normalized life (0..1). A near-instant
 * appearance, a long proud hold, then a quick fade at the very end so the panel
 * clears. `durationMs` is the whole-effect length; the fade occupies the last
 * ~18%.
 */
export function impactPresence(life: number): number {
  const t = clamp01(life);
  if (t < 0.04) return easeOutCubic(t / 0.04); // snap in
  if (t < 0.82) return 1;
  const fade = clamp01(1 - (t - 0.82) / 0.18);
  return Math.pow(fade, 1.4); // quick clean fade
}

// ---------------------------------------------------------------------------
// FAILURE / ERROR envelope — the emotional OPPOSITE of the success effects.
//
// Where success swells and lingers, failure is a hard NEGATIVE jolt: the ✗ is
// STAMPED in almost instantly, the frame RECOILS with a fast damped SHAKE (a
// "no" head-shake / error buzz), then the whole thing DESATURATES and COLLAPSES
// out quickly. Short and punchy — no afterglow, no celebration.
// ---------------------------------------------------------------------------

/** Window (ms) over which the ✗ cross is stamped/slashed in. Hard + fast. */
export const FAIL_STAMP_MS = 170;

/** Total nominal length the shake + collapse occupy after the stamp. */
export const FAIL_SHAKE_MS = 300;

/**
 * Stamp progress (0..1) of the ✗ over elapsed ms. Eased so the cross lands hard
 * and immediately (most of the draw happens in the first third), reading as a
 * stamp/slash rather than a gentle write-on.
 */
export function stampProgress(elapsedMs: number): number {
  const x = clamp01(elapsedMs / FAIL_STAMP_MS);
  // ease-out quint: very fast in, abrupt settle.
  return 1 - Math.pow(1 - x, 5);
}

/**
 * Fail presence/amplitude over normalized life (0..1): a near-instant slam to
 * full, a brief hold, then a fast collapse. The fade is steeper + earlier than
 * the comic's so the moment reads as curt/negative, not a proud hold.
 * `envelope(0) ~ 0`, peaks ~1 right after the stamp, → 0 by life 1.
 */
export function failEnvelope(life: number): number {
  const t = clamp01(life);
  if (t < 0.05) return easeOutCubic(t / 0.05); // hard slam in
  if (t < 0.55) return 1; // brief, curt hold
  const fade = clamp01(1 - (t - 0.55) / 0.45);
  return Math.pow(fade, 1.7); // quick collapse
}

// ---------------------------------------------------------------------------
// HEARTBURST envelope — a love / like / favorite moment.
//
// The shape of time is a "lub-dub" double-pulse: the heart swells on a first
// (loud) beat, relaxes, swells again on a second (softer) beat, then on the
// release it BURSTS into a flurry of little hearts that fly outward and fade.
// All pure functions of normalized life so a frame is reproducible.
//
//   life 0.00 .. 0.30  : LUB-DUB — two beats; the second tucked behind the first
//   life 0.30 .. 1.00  : BURST + AFTERGLOW — little hearts fly out, big heart fades
// ---------------------------------------------------------------------------

/** Fraction of life occupied by the lub-dub beat phase before the burst. */
export const HEARTBEAT_PHASE = 0.3;

/**
 * A single soft beat pulse centred at `center` (in life units) with half-width
 * `width`: rises fast, eases back down. Returns 0..1 (peak 1 at `center`).
 */
function beatPulse(t: number, center: number, width: number): number {
  const x = (t - center) / width;
  if (x <= -1 || x >= 1) return 0;
  // smooth bell: cos lobe, sharper attack than decay for a muscular "thump".
  const lobe = 0.5 + 0.5 * Math.cos(x * Math.PI);
  return x < 0 ? Math.pow(lobe, 0.7) : Math.pow(lobe, 1.4);
}

/**
 * Heart SCALE multiplier over normalized life. A resting 1.0 with two beats
 * superimposed (lub = strong, dub = ~62% as strong, slightly later), then it
 * settles to rest through the burst and gently shrinks as it fades out.
 *
 * `strength` scales how hard the beats swell (driven by intensity).
 * `doubleBeat` 0..1 blends from a SINGLE gentle pulse (serene) to a full
 * lub-dub (celebratory/electric) — the dub fades in with it.
 */
export function heartbeatScale(life: number, strength = 1, doubleBeat = 1): number {
  const t = clamp01(life);
  const lub = beatPulse(t, 0.1, 0.1);
  const dub = beatPulse(t, 0.21, 0.075) * 0.62 * clamp01(doubleBeat);
  const beat = Math.max(lub, dub);
  // After the burst release the heart relaxes to rest, then sags slightly as it
  // dissolves so it reads as "spent".
  const sag = t > HEARTBEAT_PHASE ? 0.06 * easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE)) : 0;
  return 1 + beat * 0.42 * strength - sag;
}

/**
 * The amplitude/energy envelope (→ uAmp + shadow strength). Tracks the beats
 * during the lub-dub then a bright flare at the burst, decaying through the
 * afterglow. `envelope(0) ~ 0`, peaks on the beats + burst, → 0 by life 1.
 */
export function heartburstEnvelope(life: number, strength = 1, doubleBeat = 1): number {
  const t = clamp01(life);
  if (t <= 0 || t >= 1) return 0;
  const lub = beatPulse(t, 0.1, 0.1);
  const dub = beatPulse(t, 0.21, 0.075) * 0.62 * clamp01(doubleBeat);
  const beats = Math.max(lub, dub) * 0.9 * strength;
  // Burst flare: a quick spike at release, then a long gentle decay.
  const b = burstProgress(life);
  const flare = b * Math.pow(1 - b, 1.1) * 2.4;
  return clamp01(Math.max(beats, flare * (0.7 + 0.3 * strength)));
}

/**
 * Burst progress 0..1 over the post-beat phase: 0 until the dub finishes, then
 * eases out to 1 as the little hearts fly out and fade. Drives the particle
 * fan-out distance + fade in both the renderer and the shader.
 */
export function burstProgress(life: number): number {
  const t = clamp01(life);
  if (t <= HEARTBEAT_PHASE) return 0;
  return easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE));
}

/**
 * Damped recoil SHAKE offset over elapsed ms — a horizontal "no" head-shake that
 * decays fast. Returns a signed multiplier (~-1..1) the renderer scales into px.
 * `amount` (driven by intensity) scales the initial swing. Settles to ~0 quickly
 * so the effect doesn't jitter through its whole life.
 */
export function shakeOffset(elapsedMs: number, amount = 1): number {
  if (elapsedMs <= 0) return 0;
  const decay = Math.exp(-elapsedMs / (FAIL_SHAKE_MS * 0.35));
  // ~3.5 oscillations over the shake window.
  const osc = Math.sin((elapsedMs / FAIL_SHAKE_MS) * Math.PI * 7.0);
  return osc * decay * amount;
}

// ---------------------------------------------------------------------------
// LIGHTNING — a high-energy "power-up / boost" STRIKE. The bolt cracks in almost
// instantly with a hard FLASH on contact, then a brief FLICKER AFTERGLOW strobes
// and decays. The shapes below are pure functions of time (frame-deterministic).
// ---------------------------------------------------------------------------

/** Window (ms) over which the bolt cracks in to the strike point. Hard + fast. */
export const STRIKE_MS = 130;

/**
 * Bolt strike progress (0..1) over elapsed ms — the jagged arc racing from the
 * source to the action point. Ease-out quint: a near-instant crack-in that
 * settles abruptly, so the bolt reads as a strike, not a slow draw.
 */
export function strikeProgress(elapsedMs: number): number {
  const x = clamp01(elapsedMs / STRIKE_MS);
  return 1 - Math.pow(1 - x, 5);
}

/**
 * FLASH / STROBE amplitude (0..1+) over normalized life — the signature electric
 * hit. An instantaneous near-white flash on the strike instant that decays fast,
 * then a few discrete FLICKER re-pulses (the afterglow strobe) whose peaks decay
 * across the tail. `flicker` (driven by intensity) scales how many/how strong the
 * re-pulses are. `envelope(0)≈peak`, → 0 by life 1.
 */
export function flashStrobe(life: number, flicker = 1): number {
  const t = clamp01(life);
  const primary = Math.exp(-t / 0.035);
  const beats = 6;
  const phase = t * beats * Math.PI * 2;
  const spike = Math.max(0, Math.sin(phase));
  const sharp = Math.pow(spike, 8);
  const tail = Math.pow(1 - t, 2.2) * 0.28 * flicker;
  return primary + sharp * tail;
}

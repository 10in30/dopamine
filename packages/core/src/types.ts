/**
 * Public types for Dopamine's success effect.
 *
 * The whole point of the API is that callers choose a *feeling* — a mood, how
 * intense it should be, and how much whimsy — rather than tuning low-level
 * particle counts and easing curves. Those get derived internally (see
 * `engine/mood.ts`).
 */

/** Emotional register of the celebration. */
export type DopamineMood = "serene" | "celebratory" | "electric";

export interface DopamineSuccessOptions {
  /**
   * Emotional register. Default `"celebratory"`. A built-in success mood, or any
   * mood registered via `registerMood` (e.g. the fail effect's `try-again` /
   * `error` / `denied`).
   */
  mood?: DopamineMood | (string & {});
  /**
   * How strong the reward feels, 0..1. Drives saturation, brightness, bloom
   * size, mote count and overshoot — grounded in the finding that saturated,
   * bright color raises both arousal and positive valence. Default `0.7`.
   */
  intensity?: number;
  /**
   * How playful/organic the motion is, 0..1. Widens the hue spread and the
   * turbulence of the drifting motes. Default `0.5`.
   */
  whimsy?: number;
  /**
   * Seed for the algorithmic color + motion. Omit to get a fresh, unique
   * palette every fire (the variable-reward / novelty lever). Provide a fixed
   * value for reproducible output (e.g. tests, snapshots).
   */
  seed?: number;
  /** Origin of the bloom in viewport pixels. Default: center of `target`. */
  origin?: { x: number; y: number };
  /**
   * Element the full-bleed overlay is mounted over. Default `document.body`,
   * i.e. the whole page. Light is cast (via `mix-blend-mode`) onto whatever
   * sits beneath the overlay.
   */
  target?: HTMLElement;
}

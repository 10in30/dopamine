// The demo imports the LEAN runtime from `@dopamine/core/core` and pulls each
// effect explicitly from its own subpath entry (`@dopamine/core/effects/<name>`)
// via dynamic import, so Vite code-splits every effect (shader + .dope + fonts/
// SDF) into its OWN chunk — a consumer pays only for what they import. The demo
// is a showcase of all four, so it preloads them during init; a real app would
// import only the ones it fires.
import {
  play,
  prepare as preparePlay,
  type PreparedEffect,
  type DopamineMood,
} from "@dopamine/core/core";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

type EffectName =
  | "solarbloom" | "inkstroke" | "comic" | "fail"
  | "aurora" | "ripple" | "confetti" | "heartburst" | "lightning";

// Lazy per-effect chunks. Each module self-registers its effect on import; we
// await them so the generic `play("name", …)` can find the registered factory.
const EFFECT_LOADERS: Record<EffectName, () => Promise<unknown>> = {
  solarbloom: () => import("@dopamine/core/effects/solarbloom"),
  inkstroke: () => import("@dopamine/core/effects/inkstroke"),
  comic: () => import("@dopamine/core/effects/comic"),
  fail: () => import("@dopamine/core/effects/fail"),
  aurora: () => import("@dopamine/core/effects/aurora"),
  ripple: () => import("@dopamine/core/effects/ripple"),
  confetti: () => import("@dopamine/core/effects/confetti"),
  heartburst: () => import("@dopamine/core/effects/heartburst"),
  lightning: () => import("@dopamine/core/effects/lightning"),
};

// The fail effect speaks failure moods; map the shared success-mood toggle onto
// gentle → harsh so the one mood control drives every effect.
const FAIL_MOOD: Record<DopamineMood, string> = {
  serene: "try-again",
  celebratory: "error",
  electric: "denied",
};
const state = {
  mood: "celebratory" as DopamineMood,
  intensity: 0.7,
  whimsy: 0.5,
  effect: "comic" as EffectName,
};

// Map the demo's success-mood toggle onto the effect's actual mood.
const moodFor = (effect: EffectName, mood: DopamineMood): string =>
  effect === "fail" ? FAIL_MOOD[mood] : mood;

// Mood segmented control
const moodGroup = $("#mood");
moodGroup.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-mood]");
  if (!btn) return;
  state.mood = btn.dataset.mood as DopamineMood;
  moodGroup
    .querySelectorAll("button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
});

// Sliders
const bind = (id: string, key: "intensity" | "whimsy") => {
  const input = $<HTMLInputElement>(`#${id}`);
  const out = $(`#${id}-val`);
  const sync = () => {
    state[key] = Number(input.value);
    out.textContent = state[key].toFixed(2);
  };
  input.addEventListener("input", sync);
  sync();
};
bind("intensity", "intensity");
bind("whimsy", "whimsy");

// Effect segmented control.
const effectGroup = document.querySelector("#effect");
effectGroup?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-effect]");
  if (!btn) return;
  state.effect = btn.dataset.effect as EffectName;
  effectGroup
    .querySelectorAll("button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
});

// Fire from the button's center so the bloom radiates from the action.
const fireBtn = $<HTMLButtonElement>("#fire");
function fire(overrides: Partial<typeof state> = {}): Promise<void> {
  const mood = overrides.mood ?? state.mood;
  const intensity = overrides.intensity ?? state.intensity;
  const whimsy = overrides.whimsy ?? state.whimsy;
  const effect = (overrides.effect ?? state.effect) as EffectName;
  const r = fireBtn.getBoundingClientRect();
  return play(effect, {
    mood: moodFor(effect, mood),
    intensity,
    whimsy,
    origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
  });
}
fireBtn.addEventListener("click", () => void fire());

// Prepare an effect for offline/fixed-timestep capture. An optional `seed` pins
// the palette/word so capture scripts can isolate one variable.
function prepare(overrides: Partial<typeof state> & { seed?: number } = {}): PreparedEffect | null {
  const mood = overrides.mood ?? state.mood;
  const intensity = overrides.intensity ?? state.intensity;
  const whimsy = overrides.whimsy ?? state.whimsy;
  const effect = (overrides.effect ?? state.effect) as EffectName;
  const seed = overrides.seed;
  const r = fireBtn.getBoundingClientRect();
  return preparePlay(effect, {
    mood: moodFor(effect, mood),
    intensity,
    whimsy,
    seed,
    origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
  });
}

// Expose hooks for the Playwright recorders + signal readiness.
interface DopamineDemo {
  fire: typeof fire;
  prepare: typeof prepare;
}
(window as unknown as { __dopamine: DopamineDemo }).__dopamine = { fire, prepare };

// Preload every effect chunk before signalling readiness, so capture scripts can
// synchronously prepare any effect. The bundled faces (comic lettering / check
// glyph) ship in their own effect chunks; await them via those modules so the
// real fonts are loaded before the first paint. (A real app would only import the
// effects it fires.) Each chunk self-registers on import.
void Promise.all(Object.values(EFFECT_LOADERS).map((load) => load()))
  .then(async () => {
    const [comicMod, solarMod] = await Promise.all([
      import("@dopamine/core/effects/comic"),
      import("@dopamine/core/effects/solarbloom"),
    ]);
    await Promise.all([
      (comicMod as { ensureComicFonts(): Promise<void> }).ensureComicFonts(),
      (solarMod as { ensureCheckFonts(): Promise<void> }).ensureCheckFonts(),
    ]);
  })
  .finally(() => {
    document.documentElement.dataset.dopamineReady = "true";
  });

// ?autoplay=<mood> fires once shortly after load (used by the recorder).
const autoplay = new URLSearchParams(location.search).get("autoplay");
if (autoplay) {
  const mood = (["serene", "celebratory", "electric"] as DopamineMood[]).includes(
    autoplay as DopamineMood,
  )
    ? (autoplay as DopamineMood)
    : "celebratory";
  setTimeout(() => void fire({ mood }), 500);
}

import {
  celebrate,
  celebrateInk,
  celebrateComic,
  fail as dopamineFail,
  prepareSolarbloom,
  prepareInkstroke,
  prepareComic,
  prepareFail,
  ensureComicFonts,
  ensureCheckFonts,
  type DopamineMood,
} from "@dopamine/core";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

type EffectName = "solarbloom" | "inkstroke" | "comic" | "fail";

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

// Effect segmented control (Solarbloom vs Calligraphic Verdict / inkstroke).
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
  const effect = overrides.effect ?? state.effect;
  if (effect === "inkstroke") {
    return celebrateInk({ mood, intensity, whimsy });
  }
  if (effect === "comic") {
    return celebrateComic({ mood, intensity, whimsy });
  }
  if (effect === "fail") {
    return dopamineFail({ mood: FAIL_MOOD[mood], intensity, whimsy });
  }
  const r = fireBtn.getBoundingClientRect();
  return celebrate({
    mood,
    intensity,
    whimsy,
    origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
  });
}
fireBtn.addEventListener("click", () => void fire());

// Prepare an effect for offline/fixed-timestep capture. An optional `seed`
// pins the palette/word so capture scripts can isolate one variable (e.g. the
// whimsy axis) without the per-fire palette changing underneath them.
function prepare(overrides: Partial<typeof state> & { seed?: number } = {}) {
  const mood = overrides.mood ?? state.mood;
  const intensity = overrides.intensity ?? state.intensity;
  const whimsy = overrides.whimsy ?? state.whimsy;
  const effect = overrides.effect ?? state.effect;
  const seed = overrides.seed;
  if (effect === "inkstroke") {
    return prepareInkstroke({ mood, intensity, whimsy, seed });
  }
  if (effect === "comic") {
    return prepareComic({ mood, intensity, whimsy, seed });
  }
  if (effect === "fail") {
    return prepareFail({ mood: FAIL_MOOD[mood], intensity, whimsy, seed });
  }
  const r = fireBtn.getBoundingClientRect();
  return prepareSolarbloom({
    mood,
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
// Make sure the bundled faces have loaded before we signal readiness, so capture
// scripts grab frames with the real lettering (Comic) and the real checkmark
// glyph (Solarbloom) rather than the fallbacks. The core also degrades
// gracefully if these never resolve.
void Promise.all([ensureComicFonts(), ensureCheckFonts()]).finally(() => {
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

import { celebrate, prepareSolarbloom, type DopamineMood } from "@dopamine/core";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

const state = { mood: "celebratory" as DopamineMood, intensity: 0.7, whimsy: 0.5 };

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

// Fire from the button's center so the bloom radiates from the action.
const fireBtn = $<HTMLButtonElement>("#fire");
function fire(overrides: Partial<typeof state> = {}): Promise<void> {
  const r = fireBtn.getBoundingClientRect();
  return celebrate({
    mood: overrides.mood ?? state.mood,
    intensity: overrides.intensity ?? state.intensity,
    whimsy: overrides.whimsy ?? state.whimsy,
    origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
  });
}
fireBtn.addEventListener("click", () => void fire());

// Prepare an effect for offline/fixed-timestep capture, anchored at the button.
function prepare(overrides: Partial<typeof state> = {}) {
  const r = fireBtn.getBoundingClientRect();
  return prepareSolarbloom({
    mood: overrides.mood ?? state.mood,
    intensity: overrides.intensity ?? state.intensity,
    whimsy: overrides.whimsy ?? state.whimsy,
    origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
  });
}

// Expose hooks for the Playwright recorders + signal readiness.
interface DopamineDemo {
  fire: typeof fire;
  prepare: typeof prepare;
}
(window as unknown as { __dopamine: DopamineDemo }).__dopamine = { fire, prepare };
document.documentElement.dataset.dopamineReady = "true";

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

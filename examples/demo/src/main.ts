// The demo imports the LEAN runtime from `@dopaminefx/core` and pulls each effect
// explicitly from its own package (`@dopaminefx/effect-<name>`) via dynamic
// import, so Vite code-splits every effect (shader + .dope + fonts/SDF) into its
// OWN chunk — a consumer pays only for what they import. The demo is a showcase
// of all nine, so it preloads them during init; a real app would import only the
// ones it fires (or pull the whole set from the `@dopaminefx/effects` umbrella).
import {
  getEffect,
  play,
  prepare as preparePlay,
  type PlayHandle,
  type PreparedEffect,
  type DopamineMood,
} from "@dopaminefx/core";

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};

type EffectName =
  // dopamine:effects:names — generated from effects/ by scripts/gen-registries.mjs; do not edit
  | "aurora" | "checkmate" | "comic" | "confetti" | "dots" | "fail" | "halo" | "heartburst" | "inkstroke" | "lightning" | "ripple" | "solarbloom";
  // dopamine:effects:names:end

// Lazy per-effect chunks. Each module self-registers its effect on import; we
// await them so the generic `play("name", …)` can find the registered factory.
const EFFECT_LOADERS: Record<EffectName, () => Promise<unknown>> = {
  // dopamine:effects:loaders — generated from effects/ by scripts/gen-registries.mjs; do not edit
  aurora: () => import("@dopaminefx/effect-aurora"),
  checkmate: () => import("@dopaminefx/effect-checkmate"),
  comic: () => import("@dopaminefx/effect-comic"),
  confetti: () => import("@dopaminefx/effect-confetti"),
  dots: () => import("@dopaminefx/effect-dots"),
  fail: () => import("@dopaminefx/effect-fail"),
  halo: () => import("@dopaminefx/effect-halo"),
  heartburst: () => import("@dopaminefx/effect-heartburst"),
  inkstroke: () => import("@dopaminefx/effect-inkstroke"),
  lightning: () => import("@dopaminefx/effect-lightning"),
  ripple: () => import("@dopaminefx/effect-ripple"),
  solarbloom: () => import("@dopaminefx/effect-solarbloom"),
  // dopamine:effects:loaders:end
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

// Theme segmented control (Dark/Light). Lets you compare how the same effect
// reads against a dark vs light stage — the light layer (screen blend) is vivid
// on dark and far subtler on light, where the shadow layer carries it. The choice
// persists across reloads; default is dark (also what headless capture records).
type Theme = "dark" | "light";
const themeGroup = $("#theme");
function applyTheme(theme: Theme, persist: boolean): void {
  document.documentElement.dataset.theme = theme;
  if (persist) {
    try {
      localStorage.setItem("dopamine-theme", theme);
    } catch {
      /* private mode / blocked storage — fine, the choice just won't persist */
    }
  }
  themeGroup
    .querySelectorAll("button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === theme)));
}
// Sync the buttons to whatever the pre-paint inline script already applied (don't
// persist the default — only an explicit user choice should be remembered).
applyTheme((document.documentElement.dataset.theme as Theme) ?? "dark", false);
themeGroup.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-theme]");
  if (btn) applyTheme(btn.dataset.theme as Theme, true);
});

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

// Effect segmented control. The buttons are generated from the canonical effect
// list (scripts/gen-registries.mjs); reflect the initial selection here so the
// default highlights without a hardcoded aria-pressed in the markup.
const effectGroup = document.querySelector("#effect");
const pressEffect = (name: string) =>
  effectGroup
    ?.querySelectorAll("button")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.effect === name)));
pressEffect(state.effect);
effectGroup?.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-effect]");
  if (!btn) return;
  state.effect = btn.dataset.effect as EffectName;
  pressEffect(state.effect);
});

const fireBtn = $<HTMLButtonElement>("#fire");

// Celebrate ON the "Order complete" card: the effect is centred on, and SIZED to,
// that element — not the full page. This matters because an effect has two kinds
// of parts: the panel centrepiece (comic's word, heartburst's heart) is drawn at
// the origin, while procedural parts (comic's action-line ring, the burst) are
// sized to the targeted box. If the box defaults to the whole viewport the ring
// becomes viewport-sized and sweeps the screen center while the word sits at the
// origin — they look like two different targets. Targeting the card keeps every
// part coherent on one element. (The full-page overlay still hosts it, so effects
// that spill past the card aren't clipped.)
const targetEl = $(".receipt");
function originTarget(): {
  origin: { x: number; y: number };
  targetSize: { width: number; height: number };
} {
  const r = targetEl.getBoundingClientRect();
  return {
    origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
    targetSize: { width: r.width, height: r.height },
  };
}

// MOBILE TARGETING FIX. The overlay is `position: fixed`, so an effect is drawn
// at the target card's VIEWPORT coordinates. If the card has been scrolled
// off-screen (e.g. on a phone, where you'd scroll to reach a control), firing
// would draw the effect where the card *is* — above the viewport — and a fixed
// canvas never scrolls it back into view. So before an INTERACTIVE fire, if the
// card's centre is outside the viewport, scroll it into view (instantly) so the
// effect lands on the visible card. `prepare()` deliberately doesn't scroll, to
// keep offline capture deterministic.
function ensureTargetVisible(): void {
  const r = targetEl.getBoundingClientRect();
  const centreY = r.top + r.height / 2;
  if (centreY < 0 || centreY > window.innerHeight) {
    targetEl.scrollIntoView({ block: "center", behavior: "auto" });
  }
}

// The surface the effect composites against. In DARK mode we omit `backdrop`,
// keeping the classic `mix-blend-mode: screen` light (rich cast light over the
// dark UI — and unchanged for the headless reels). In LIGHT mode we pass the
// actual stage colour so the runtime switches to premultiplied source-over
// light, which stays visible on the light surface instead of vanishing into it.
const stageEl = $(".stage");
function currentBackdrop(): string | undefined {
  if (document.documentElement.dataset.theme !== "light") return undefined;
  return getComputedStyle(stageEl).backgroundColor || "#ffffff";
}

// A CONTINUOUS effect (halo, dots) loops until stopped — Fire becomes a toggle
// for it: the first click starts the loading indicator, the next click stops it
// (the way a real host would stop it when its work completes).
let loopingHandle: PlayHandle | null = null;
// Whether the running continuous effect is currently paused (the Pause button).
let loopPaused = false;

// The Pause/Resume button only does anything while a CONTINUOUS effect runs; keep
// its label + enabled state in sync with the loop's lifecycle.
const pauseBtn = $<HTMLButtonElement>("#pause");
function syncPauseBtn(): void {
  const active = loopingHandle !== null;
  pauseBtn.disabled = !active;
  pauseBtn.textContent = !active ? "Pause loop" : loopPaused ? "Resume loop ▶" : "Pause loop ⏸";
  pauseBtn.setAttribute("aria-pressed", String(loopPaused));
}

function fire(overrides: Partial<typeof state> = {}): Promise<void> {
  const mood = overrides.mood ?? state.mood;
  const intensity = overrides.intensity ?? state.intensity;
  const whimsy = overrides.whimsy ?? state.whimsy;
  const effect = (overrides.effect ?? state.effect) as EffectName;
  if (loopingHandle) {
    loopingHandle.stop();
    loopingHandle = null;
    loopPaused = false;
    syncPauseBtn();
    return Promise.resolve();
  }
  // Intensity is the effect's "presence" dial; 0 means "don't show it at all".
  // The .dope mappings floor a NON-zero intensity at a visible minimum (glyphs
  // ~40% size, ~a handful of elements), so the host owns the hard off-switch at
  // exactly 0 (a clean numeric guard — never fire on a non-positive intensity).
  if (!(intensity > 0)) return Promise.resolve();
  // Bring the targeted card into view first, so the effect (drawn at the card's
  // viewport position on the fixed overlay) is actually visible when it fires.
  ensureTargetVisible();
  const handle = play(effect, {
    mood: moodFor(effect, mood),
    intensity,
    whimsy,
    backdrop: currentBackdrop(),
    ...originTarget(),
  });
  if (getEffect(effect)?.loop) {
    loopingHandle = handle;
    loopPaused = false;
    syncPauseBtn();
    void handle.then(() => {
      if (loopingHandle === handle) {
        loopingHandle = null;
        loopPaused = false;
        syncPauseBtn();
      }
    });
  }
  return handle;
}
fireBtn.addEventListener("click", () => void fire());

// Exercise the conductor's drift-free pause/resume on the RUNNING continuous
// effect: the loop visibly freezes mid-breath and continues exactly where it
// left off — the manual analog of the hidden-tab auto-pause (battery economics).
pauseBtn.addEventListener("click", () => {
  if (!loopingHandle) return;
  loopPaused = !loopPaused;
  if (loopPaused) loopingHandle.pause();
  else loopingHandle.resume();
  syncPauseBtn();
});
syncPauseBtn();

// Prepare an effect for offline/fixed-timestep capture. An optional `seed` pins
// the palette/word so capture scripts can isolate one variable.
function prepare(overrides: Partial<typeof state> & { seed?: number } = {}): PreparedEffect | null {
  const mood = overrides.mood ?? state.mood;
  const intensity = overrides.intensity ?? state.intensity;
  const whimsy = overrides.whimsy ?? state.whimsy;
  const effect = (overrides.effect ?? state.effect) as EffectName;
  const seed = overrides.seed;
  return preparePlay(effect, {
    mood: moodFor(effect, mood),
    intensity,
    whimsy,
    seed,
    backdrop: currentBackdrop(),
    ...originTarget(),
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
      import("@dopaminefx/effect-comic"),
      import("@dopaminefx/effect-solarbloom"),
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

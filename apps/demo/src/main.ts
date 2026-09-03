import "./style.css";
import { createLime, type Lime, type MusicalStatePatch, type StylePack } from "@lime/core";
import { createToneRenderer, type ToneRenderer } from "@lime/renderer-tone";
import { ambientMinimal } from "@lime/styles";

/** A selectable style: the built-in one or a corpus-generated pack. */
interface StyleEntry {
  id: string;
  style: StylePack;
  suggestedState?: MusicalStatePatch;
}

/** Normalized (0–1) state parameters exposed as sliders. */
const PARAMS = [
  "energy",
  "tension",
  "valence",
  "density",
  "complexity",
  "instability",
  "brightness",
] as const;
type ParamKey = (typeof PARAMS)[number];

const VOICES = ["pad", "bass", "melody", "percussion"] as const;

/** Semantic moods — demo-only sugar over continuous state (per handoff). */
const MOODS: Record<string, MusicalStatePatch> = {
  Calm: { energy: 0.15, tension: 0.1, valence: 0.7, density: 0.2, complexity: 0.2, instability: 0.1, brightness: 0.5, tempo: 68 },
  Explore: { energy: 0.42, tension: 0.32, valence: 0.55, density: 0.42, complexity: 0.42, instability: 0.38, brightness: 0.55, tempo: 78 },
  Unease: { energy: 0.48, tension: 0.62, valence: 0.32, density: 0.42, complexity: 0.48, instability: 0.55, brightness: 0.4, tempo: 82 },
  Danger: { energy: 0.88, tension: 0.92, valence: 0.2, density: 0.72, complexity: 0.62, instability: 0.58, brightness: 0.35, tempo: 98 },
  Resolve: { energy: 0.4, tension: 0.15, valence: 0.78, density: 0.34, complexity: 0.3, instability: 0.2, brightness: 0.62, tempo: 74 },
};

const SHOWCASE_ORDER = ["Calm", "Explore", "Unease", "Danger", "Resolve", "Calm"];
const SHOWCASE_INTERVAL_MS = 30_000;

const initialState: MusicalStatePatch = { ...MOODS.Calm };

// Corpus-generated StylePacks are pure JSON data (no corpus code in the bundle).
const packModules = import.meta.glob("../../../packages/corpus/generated/*.json", {
  eager: true,
}) as Record<string, { default: { style: StylePack; suggestedState?: MusicalStatePatch } }>;

const corpusPacks: StyleEntry[] = Object.entries(packModules)
  .filter(([path]) => !path.endsWith("index.json"))
  .map(([, mod]) => ({
    id: mod.default.style.id,
    style: mod.default.style,
    suggestedState: mod.default.suggestedState,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const STYLES: StyleEntry[] = [
  { id: "ambient-minimal (built-in)", style: ambientMinimal, suggestedState: { ...MOODS.Calm } },
  ...corpusPacks,
];

let music: Lime | null = null;
let renderer: ToneRenderer | null = null;
let showcaseTimer: ReturnType<typeof setInterval> | undefined;
let showcaseIndex = 0;
let currentSeed = "demo-forest-1";
let currentEntry: StyleEntry = STYLES[0]!;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

// --- Enter / start ---------------------------------------------------------

$("#enter-btn").addEventListener("click", async () => {
  $("#enter-overlay").hidden = true;
  $("#app").hidden = false;

  buildStyleSelector();
  buildMoods();
  buildSliders();
  buildActivity();
  buildStateBars();

  // First engine build — must run inside the click gesture so Tone can start.
  await selectStyle(STYLES[0]!);
  requestAnimationFrame(loop);
});

/**
 * (Re)build the renderer + engine for a style. Switching restarts composition
 * with the pack's own harmony/melody/rhythm and suggested state, keeping the
 * demo a live playground. A brief gap on switch is fine for a testing tool.
 */
async function selectStyle(entry: StyleEntry, opts: { newSeed?: boolean } = {}): Promise<void> {
  currentEntry = entry;
  if (opts.newSeed) currentSeed = `demo-${Math.floor(Math.random() * 1e9)}`;

  music?.stop();
  renderer?.dispose?.();
  stopShowcase();

  const init: MusicalStatePatch = entry.suggestedState ?? { ...MOODS.Calm };
  renderer = createToneRenderer({ instrumentation: entry.style.instrumentation });
  music = createLime({ seed: currentSeed, style: entry.style, renderer, initialState: init, lookAheadBars: 4 });
  await music.start();
  renderer.setBrightness(init.brightness ?? 0.5);

  syncSliders(init);
  clearMoodHighlight();
  const sb = $("#showcase-btn");
  sb.textContent = "Showcase: off";
  sb.classList.remove("active");
}

function buildStyleSelector(): void {
  const sel = $<HTMLSelectElement>("#style-select");
  sel.innerHTML = "";
  STYLES.forEach((e, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = e.id;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => {
    void selectStyle(STYLES[Number(sel.value)]!);
  });
  $("#reseed-btn").addEventListener("click", () => {
    void selectStyle(currentEntry, { newSeed: true });
  });
}

/** Reflect a state on the sliders (used when a pack sets its own initial state). */
function syncSliders(state: MusicalStatePatch): void {
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
    const k = input.dataset.key!;
    const v = (state as Record<string, number>)[k];
    if (v === undefined) continue;
    input.value = String(v);
    const out = input.nextElementSibling as HTMLOutputElement | null;
    if (out) out.textContent = fmt(v, k === "tempo");
  }
}

$("#stop-btn").addEventListener("click", () => {
  music?.stop();
  stopShowcase();
});

$("#showcase-btn").addEventListener("click", () => {
  const btn = $("#showcase-btn");
  if (showcaseTimer) {
    stopShowcase();
    btn.textContent = "Showcase: off";
    btn.classList.remove("active");
  } else {
    startShowcase();
    btn.textContent = "Showcase: on";
    btn.classList.add("active");
  }
});

// --- Controls --------------------------------------------------------------

function buildMoods(): void {
  const host = $("#moods");
  host.innerHTML = "";
  for (const name of Object.keys(MOODS)) {
    const btn = document.createElement("button");
    btn.className = "mood";
    btn.textContent = name;
    btn.dataset.mood = name;
    btn.addEventListener("click", () => applyMood(name, true));
    host.appendChild(btn);
  }
}

function buildSliders(): void {
  const host = $("#sliders");
  host.innerHTML = "";
  for (const key of PARAMS) {
    host.appendChild(makeSlider(key, key, 0, 1, 0.01, initialState[key] ?? 0.3));
  }
  host.appendChild(makeSlider("tempo", "tempo", 60, 100, 1, initialState.tempo ?? 76));
}

function makeSlider(key: string, label: string, min: number, max: number, step: number, value: number): HTMLElement {
  const row = document.createElement("div");
  row.className = "slider-row";
  row.innerHTML = `<label>${label}</label>`;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.dataset.key = key;
  const out = document.createElement("output");
  out.textContent = fmt(value, key === "tempo");
  input.addEventListener("input", () => {
    const v = Number(input.value);
    out.textContent = fmt(v, key === "tempo");
    onSlider(key, v);
    clearMoodHighlight();
  });
  row.appendChild(input);
  row.appendChild(out);
  return row;
}

function onSlider(key: string, value: number): void {
  if (!music) return;
  music.setState({ [key]: value } as MusicalStatePatch, { quantize: "nextBar" });
  if (key === "brightness") renderer?.setBrightness(value);
}

function applyMood(name: string, transition: boolean): void {
  if (!music) return;
  const target = MOODS[name]!;
  if (transition) music.transitionTo({ ...target }, { duration: { bars: 8 }, quantize: "nextBar" });
  else music.setState({ ...target }, { quantize: "nextBar" });
  if (target.brightness !== undefined) renderer?.setBrightness(target.brightness);

  // Reflect the mood's target values on the sliders.
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
    const k = input.dataset.key!;
    const v = (target as Record<string, number>)[k];
    if (v !== undefined) {
      input.value = String(v);
      const out = input.nextElementSibling as HTMLOutputElement | null;
      if (out) out.textContent = fmt(v, k === "tempo");
    }
  }
  highlightMood(name);
}

function highlightMood(name: string): void {
  for (const b of document.querySelectorAll<HTMLElement>(".mood")) {
    b.classList.toggle("active", b.dataset.mood === name);
  }
}
function clearMoodHighlight(): void {
  for (const b of document.querySelectorAll<HTMLElement>(".mood")) b.classList.remove("active");
}

function startShowcase(): void {
  showcaseIndex = 0;
  applyMood(SHOWCASE_ORDER[0]!, true);
  showcaseTimer = setInterval(() => {
    showcaseIndex = (showcaseIndex + 1) % SHOWCASE_ORDER.length;
    applyMood(SHOWCASE_ORDER[showcaseIndex]!, true);
  }, SHOWCASE_INTERVAL_MS);
}
function stopShowcase(): void {
  if (showcaseTimer) clearInterval(showcaseTimer);
  showcaseTimer = undefined;
}

// --- Debug panel -----------------------------------------------------------

function buildActivity(): void {
  const host = $("#d-activity");
  host.innerHTML = "";
  for (const voice of VOICES) {
    const row = document.createElement("div");
    row.className = "act-row";
    row.innerHTML = `<span>${voice}</span>`;
    const cells = document.createElement("div");
    cells.className = "act-cells";
    cells.dataset.voice = voice;
    for (let i = 0; i < 4; i++) {
      const c = document.createElement("div");
      c.className = "cell";
      cells.appendChild(c);
    }
    row.appendChild(cells);
    host.appendChild(row);
  }
}

function buildStateBars(): void {
  const host = $("#d-state");
  host.innerHTML = "";
  for (const key of PARAMS) {
    const row = document.createElement("div");
    row.className = "state-row";
    row.innerHTML = `<label>${key}</label><div class="bar-track"><div class="bar-cur" data-cur="${key}"></div><div class="bar-tgt" data-tgt="${key}"></div></div>`;
    host.appendChild(row);
  }
}

function loop(): void {
  update();
  requestAnimationFrame(loop);
}

function update(): void {
  if (!music) return;
  const s = music.debug.snapshot();

  $("#d-bar").textContent = String(s.bar);
  $("#d-beat").textContent = String(s.beat + 1);
  $("#d-bpm").textContent = s.bpm.toFixed(1);
  $("#d-key").textContent = `${s.keyName} ${s.mode}`;
  $("#d-chord").textContent = s.chordLabel ? `${s.chordLabel} (${s.chordRoman})` : "–";
  $("#d-phrase").textContent = s.phrase ? `${s.phrase.role} ${s.phrase.barInPhrase + 1}/${s.phrase.lengthBars}` : "–";

  // Upcoming harmony chips.
  const harmony = $("#d-harmony");
  harmony.innerHTML = "";
  for (const c of s.upcomingHarmony) {
    const chip = document.createElement("span");
    chip.className = "chord-chip";
    if (c.bar <= s.bar && s.bar < c.bar + c.durationBars) chip.classList.add("now");
    chip.innerHTML = `${c.label} <small>${c.roman}</small>`;
    harmony.appendChild(chip);
  }

  $("#d-motif").textContent = s.activeMotifId ?? "–";
  $("#d-motif-count").textContent = String(s.motifCount);
  $("#d-horizon").textContent = String(Math.max(0, s.composedThroughBar - s.bar));

  // Activity grid over the upcoming bars in the snapshot.
  const byBarVoice = new Set<string>();
  for (const e of s.upcomingEvents) byBarVoice.add(`${e.voice}@${Math.floor(e.time / (480 * 4))}`);
  for (const cells of document.querySelectorAll<HTMLElement>(".act-cells")) {
    const voice = cells.dataset.voice!;
    cells.querySelectorAll<HTMLElement>(".cell").forEach((cell, i) => {
      const on = byBarVoice.has(`${voice}@${s.bar + i}`);
      cell.className = "cell" + (on ? ` on ${voice === "pad" ? "pad" : voice === "percussion" ? "perc" : ""}` : "");
    });
  }

  // Current vs target state bars.
  const cur = s.currentState as unknown as Record<string, number>;
  const tgt = s.targetState as unknown as Record<string, number>;
  for (const el of document.querySelectorAll<HTMLElement>("[data-cur]")) {
    el.style.width = `${(cur[el.dataset.cur!] ?? 0) * 100}%`;
  }
  for (const el of document.querySelectorAll<HTMLElement>("[data-tgt]")) {
    el.style.left = `${(tgt[el.dataset.tgt!] ?? 0) * 100}%`;
  }
}

function fmt(v: number, isTempo: boolean): string {
  return isTempo ? v.toFixed(0) : v.toFixed(2);
}

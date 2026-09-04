import "./style.css";
import {
  createLime,
  REFERENCE_SEEDS,
  SHOWCASE_SEQUENCE,
  expandShowcase,
  type Lime,
  type MusicalStatePatch,
  type StylePack,
  type HarmonyStyle,
  type RhythmStyle,
  type NoteEvent,
  type VoiceId,
  type PhrasePlan,
} from "@lime/core";
import { eventsToStandardMidiFile } from "@lime/midi";
import {
  createToneRenderer,
  ROCK_INSTRUMENTS, METAL_INSTRUMENTS, POP_INSTRUMENTS, JAZZ_INSTRUMENTS,
  BLUES_INSTRUMENTS, HIPHOP_INSTRUMENTS, ELECTRONIC_INSTRUMENTS, FOLK_INSTRUMENTS,
  LATIN_INSTRUMENTS, FUNK_INSTRUMENTS, CLASSICAL_INSTRUMENTS,
  type ToneRenderer,
  type InstrumentFactory,
} from "@lime/renderer-tone";
import { GENRE_PALETTES_SAMPLED } from "./sampledGenre";
import { FluidRenderer, GM_PROGRAMS } from "./fluidRenderer";

/**
 * Genre → instrument palette. The StylePack gives a genre its grammar; the
 * palette gives it its timbre. Genres without a palette fall back to the
 * default/sampled instruments (ambient).
 */
const GENRE_PALETTES: Record<string, Partial<Record<VoiceId, InstrumentFactory>>> = {
  "genre-rock-pop": ROCK_INSTRUMENTS,
  "genre-metal": METAL_INSTRUMENTS,
  "genre-pop": POP_INSTRUMENTS,
  "genre-jazz": JAZZ_INSTRUMENTS,
  "genre-blues": BLUES_INSTRUMENTS,
  "genre-hiphop": HIPHOP_INSTRUMENTS,
  "genre-electronic": ELECTRONIC_INSTRUMENTS,
  "genre-folk": FOLK_INSTRUMENTS,
  "genre-latin": LATIN_INSTRUMENTS,
  "genre-funk": FUNK_INSTRUMENTS,
  "genre-classical": CLASSICAL_INSTRUMENTS,
};

/** Friendly dropdown labels per genre id. */
const GENRE_LABELS: Record<string, string> = {
  "genre-rock-pop": "Rock", "genre-metal": "Metal", "genre-pop": "Pop",
  "genre-jazz": "Jazz", "genre-blues": "Blues", "genre-hiphop": "Hip-hop",
  "genre-electronic": "Electrónica", "genre-folk": "Folk", "genre-latin": "Latina",
  "genre-funk": "R&B / Funk", "genre-classical": "Clásica", "genre-ambient": "Ambient",
};
import {
  classicalPack, popPack, hiphopPack, electronicPack, jazzPack, bluesPack,
  folkPack, latinPack, funkPack, metalPack, ambientPack,
} from "@lime/styles";
import * as Tone from "tone";
import { SAMPLED_INSTRUMENTS } from "./sampledInstruments";

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

const VOICES = ["pad", "bass", "melody", "motion", "percussion"] as const;

/** Semantic moods — demo-only sugar over continuous state (per handoff). */
const MOODS: Record<string, MusicalStatePatch> = {
  Calm: { energy: 0.15, tension: 0.1, valence: 0.7, density: 0.2, complexity: 0.2, instability: 0.1, brightness: 0.5, tempo: 68 },
  Explore: { energy: 0.42, tension: 0.32, valence: 0.55, density: 0.42, complexity: 0.42, instability: 0.38, brightness: 0.55, tempo: 78 },
  Unease: { energy: 0.48, tension: 0.62, valence: 0.32, density: 0.42, complexity: 0.48, instability: 0.55, brightness: 0.4, tempo: 82 },
  Danger: { energy: 0.88, tension: 0.92, valence: 0.2, density: 0.72, complexity: 0.62, instability: 0.58, brightness: 0.35, tempo: 98 },
  Resolve: { energy: 0.4, tension: 0.15, valence: 0.78, density: 0.34, complexity: 0.3, instability: 0.2, brightness: 0.62, tempo: 74 },
};

const initialState: MusicalStatePatch = { ...MOODS.Calm };

// Deterministic, bar-driven showcase schedule (shared with the regression suite).
const SHOWCASE = expandShowcase();

// Corpus-generated StylePacks are pure JSON data (no corpus code in the bundle).
const packModules = import.meta.glob("../../../packages/corpus/generated/*.json", {
  eager: true,
}) as Record<string, { default: { style: StylePack; suggestedState?: MusicalStatePatch } }>;

const corpusPacks: StyleEntry[] = Object.values(packModules)
  // Only entries that actually carry a StylePack — skips index.json and any
  // other non-pack JSON that happens to live in generated/ (e.g. a manifest).
  .filter((mod) => mod.default?.style?.id)
  .map((mod) => ({
    id: mod.default.style.id,
    style: mod.default.style,
    suggestedState: mod.default.suggestedState,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

// The 12-genre dropdown. Each genre carries an energetic default so its groove
// plays on selection; the emotion selector then drives live state. Rock is the
// corpus-derived pack; the rest are authored (GENRES.md).
const GENRE_STATE: Record<string, MusicalStatePatch> = {
  "genre-classical": { energy: 0.5, valence: 0.6, tension: 0.3, density: 0.45, complexity: 0.4, instability: 0.25, brightness: 0.55, tempo: 90 },
  "genre-pop": { energy: 0.7, valence: 0.72, tension: 0.3, density: 0.55, complexity: 0.35, instability: 0.25, brightness: 0.6, tempo: 118 },
  "genre-rock-pop": { energy: 0.8, valence: 0.25, tension: 0.6, density: 0.6, complexity: 0.55, instability: 0.42, brightness: 0.38, tempo: 126 },
  "genre-hiphop": { energy: 0.8, valence: 0.4, tension: 0.35, density: 0.6, complexity: 0.35, instability: 0.3, brightness: 0.45, tempo: 88 },
  "genre-electronic": { energy: 0.76, valence: 0.45, tension: 0.4, density: 0.65, complexity: 0.45, instability: 0.35, brightness: 0.55, tempo: 126 },
  "genre-jazz": { energy: 0.55, valence: 0.5, tension: 0.35, density: 0.5, complexity: 0.55, instability: 0.4, brightness: 0.55, tempo: 130 },
  "genre-blues": { energy: 0.55, valence: 0.3, tension: 0.4, density: 0.5, complexity: 0.3, instability: 0.15, brightness: 0.52, tempo: 95 },
  "genre-folk": { energy: 0.45, valence: 0.55, tension: 0.25, density: 0.4, complexity: 0.3, instability: 0.2, brightness: 0.55, tempo: 100 },
  "genre-latin": { energy: 0.72, valence: 0.65, tension: 0.35, density: 0.6, complexity: 0.45, instability: 0.35, brightness: 0.6, tempo: 105 },
  "genre-funk": { energy: 0.72, valence: 0.55, tension: 0.35, density: 0.62, complexity: 0.45, instability: 0.35, brightness: 0.55, tempo: 108 },
  "genre-metal": { energy: 0.9, valence: 0.28, tension: 0.62, density: 0.72, complexity: 0.5, instability: 0.4, brightness: 0.42, tempo: 160 },
  "genre-ambient": { energy: 0.32, valence: 0.5, tension: 0.2, density: 0.3, complexity: 0.25, instability: 0.15, brightness: 0.5, tempo: 68 },
};
const rockPack = corpusPacks.find((p) => p.id === "genre-rock-pop");

// Per-genre generation tweaks (judged by ear with the audio judge): move the
// harmony so it stops circling the tonic, and vary the backbeat. Only the named
// genres change; the rest stay exactly as authored. Deep-merged so each pack's
// own harmony/rhythm data (transitions, groove) survives.
const STYLE_TWEAKS: Record<string, Partial<StylePack>> = {
  "genre-metal": { harmony: { harmonyMotion: 0.7 }, rhythm: { grooveVariation: 0.4 } },
  "genre-latin": { harmony: { harmonyMotion: 0.5 } },
  "genre-folk": { harmony: { harmonyMotion: 0.5 } },
  // Blues: a minor (dorian) 12-bar blues reads darker/sadder than the pack's
  // mixolydian, and force a I-IV-V progression (its corpus transitions wandered).
  "genre-blues": {
    defaultMode: "dorian",
    harmony: { transitions: {
      1: [{ degree: 4, weight: 3 }, { degree: 1, weight: 2.5 }, { degree: 5, weight: 1 }],
      4: [{ degree: 1, weight: 3 }, { degree: 4, weight: 1.5 }, { degree: 5, weight: 1 }],
      5: [{ degree: 4, weight: 2.5 }, { degree: 1, weight: 2.5 }],
    } },
  },
};
function tweak(style: StylePack): StylePack {
  const t = STYLE_TWEAKS[style.id];
  if (!t) return style;
  return {
    ...style,
    ...t,
    ...(t.harmony ? { harmony: { ...style.harmony, ...t.harmony } } : {}),
    ...(t.rhythm ? { rhythm: { ...style.rhythm, ...t.rhythm } } : {}),
  };
}
const entry = (style: StylePack): StyleEntry => ({
  id: style.id,
  style: tweak(style),
  suggestedState: GENRE_STATE[style.id] ?? { ...MOODS.Calm },
});
const STYLES: StyleEntry[] = [
  entry(classicalPack),
  entry(popPack),
  // Rock's corpus pack came out in major, which reads emotionally "happy"; force
  // natural minor so it lands dark/aggressive as the genre intends. Its corpus
  // matrix circled back to the tonic every chord (repetitive), so give it
  // harmonyMotion so the progression travels, and a touch of motifDevelopment so
  // the melody evolves instead of restating one shape. All judged by ear with the
  // audio judge. Merge harmony/melody so the corpus data survives.
  ...(rockPack ? [{ id: rockPack.style.id, style: { ...rockPack.style, defaultMode: "naturalMinor" as const, bassStyle: "default" as const, harmony: { ...rockPack.style.harmony, harmonyMotion: 0.8 }, melody: { ...rockPack.style.melody, motifDevelopment: 0.3, durationWeights: { whole: 1, half: 7, dottedQuarter: 3, quarter: 9, dottedEighth: 0.2, eighth: 0.5, sixteenth: 0.1 } }, rhythm: { ...rockPack.style.rhythm, grooveVariation: 0.5 } }, suggestedState: GENRE_STATE["genre-rock-pop"]! }] : []),
  entry(hiphopPack),
  entry(electronicPack),
  entry(jazzPack),
  entry(bluesPack),
  entry(folkPack),
  entry(latinPack),
  entry(funkPack),
  entry(metalPack),
  entry(ambientPack),
];

/** A quadrant emotion preset: a corpus-derived state the host transitions to. */
interface EmotionPreset {
  readonly quadrant: "Q1" | "Q2" | "Q3" | "Q4";
  readonly label: string;
  readonly state: MusicalStatePatch;
}

// The 2×2 emotion selector (valence × arousal). State comes from the corpus
// feel-* packs' suggestedState where present, with a sensible fallback. Order is
// the grid's reading order: intense row (tense | happy), then calm row (sad | calm).
const FEEL_FALLBACK: Record<string, MusicalStatePatch> = {
  "feel-tense": { energy: 0.7, valence: 0.2, tension: 0.82, brightness: 0.35, density: 0.65, complexity: 0.57, instability: 0.5, tempo: 118 },
  "feel-happy": { energy: 0.6, valence: 0.8, tension: 0.25, brightness: 0.75, density: 0.55, complexity: 0.45, instability: 0.3, tempo: 112 },
  "feel-sad": { energy: 0.3, valence: 0.2, tension: 0.3, brightness: 0.35, density: 0.3, complexity: 0.35, instability: 0.25, tempo: 72 },
  "feel-calm": { energy: 0.35, valence: 0.85, tension: 0.2, brightness: 0.78, density: 0.35, complexity: 0.3, instability: 0.17, tempo: 80 },
};
const EMOTIONS: EmotionPreset[] = (
  [
    ["feel-tense", "Q2", "Tense"],
    ["feel-happy", "Q1", "Happy"],
    ["feel-sad", "Q3", "Sad"],
    ["feel-calm", "Q4", "Calm"],
  ] as const
).map(([id, quadrant, label]) => ({
  quadrant,
  label,
  state: corpusPacks.find((p) => p.id === id)?.suggestedState ?? FEEL_FALLBACK[id]!,
}));

let currentEmotion: EmotionPreset | null = null;

let music: Lime | null = null;
// Playback engine: FluidSynth-WASM + a GM SoundFont, persistent across genre
// switches (the 30 MB SoundFont loads once).
const renderer = new FluidRenderer();
let currentSeed = "demo-forest-1";
let currentEntry: StyleEntry = STYLES[0]!;

// Bar-driven showcase runner state.
let showcaseActive = false;
let showcaseStartBar = 0; // engine bar at which the journey began
let showcaseNextIndex = 0; // next scheduled change to fire
let showcaseStageName = "off";

// Deliverable 4: when true, controls (moods/sliders/showcase) stop pushing state
// into the engine; the engine keeps composing its current trajectory forward.
let automationPaused = false;

// Deliverable 3: per-voice mute + solo, computed here and pushed to the renderer.
const muted: Record<VoiceId, boolean> = {
  pad: false,
  bass: false,
  melody: false,
  motion: false,
  percussion: false,
  texture: false,
};
let soloVoice: VoiceId | null = null;

// A/B instrument palette: false = self-contained synth (default, no fetch),
// true = high-quality sampled instruments plugged in via the renderer's API.

const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

// --- Enter / start ---------------------------------------------------------

$("#enter-btn").addEventListener("click", async () => {
  $("#enter-overlay").hidden = true;
  $("#app").hidden = false;

  buildStyleSelector();
  buildRefSeedSelector();
  buildEmotions();
  buildMoods();
  buildSliders();
  buildVoices();
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
  stopShowcase();

  // Keep the chosen emotion across a genre switch: the genre supplies the
  // grammar (StylePack), the emotion supplies the state we start from.
  const init: MusicalStatePatch =
    currentEmotion?.state ?? entry.suggestedState ?? { ...MOODS.Calm };
  // The genre's per-voice GM programs drive the FluidSynth SoundFont.
  renderer.setGenrePrograms(GM_PROGRAMS[entry.style.id] ?? {});
  music = createLime({ seed: currentSeed, style: entry.style, renderer, initialState: init, lookAheadBars: 4 });
  await music.start(); // FluidRenderer loads the SoundFont on first start
  renderer.setBrightness(init.brightness ?? 0.5);
  applyVoiceStates(); // re-push mute/solo onto the engine

  syncSliders(init);
  clearMoodHighlight();
  const sb = $("#showcase-btn");
  sb.textContent = "Showcase: off";
  sb.classList.remove("active");
  if (currentEmotion) highlightEmotion(currentEmotion.quadrant);
}

function buildStyleSelector(): void {
  const sel = $<HTMLSelectElement>("#style-select");
  sel.innerHTML = "";
  STYLES.forEach((e, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = GENRE_LABELS[e.id] ?? e.id;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => {
    void selectStyle(STYLES[Number(sel.value)]!);
  });
  $("#reseed-btn").addEventListener("click", () => {
    void selectStyle(currentEntry, { newSeed: true });
  });
}

/**
 * Reference-seed selector: recompose the CURRENT style with one of the 10 fixed
 * `REFERENCE_SEEDS`. Sets `currentSeed` to the chosen value and re-runs the
 * normal `selectStyle` path (no `newSeed`, so nothing is randomized) — same seed
 * + same style ⇒ identical music.
 */
function buildRefSeedSelector(): void {
  const sel = $<HTMLSelectElement>("#refseed-select");
  sel.innerHTML = "";
  const head = document.createElement("option");
  head.value = "";
  head.textContent = "reference seed…";
  sel.appendChild(head);
  for (const seed of REFERENCE_SEEDS) {
    const o = document.createElement("option");
    o.value = seed;
    o.textContent = seed;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    if (!sel.value) return;
    currentSeed = sel.value;
    void selectStyle(currentEntry);
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
  const sb = $("#showcase-btn");
  sb.textContent = "Showcase: off";
  sb.classList.remove("active");
});

$("#showcase-btn").addEventListener("click", () => {
  const btn = $("#showcase-btn");
  if (showcaseActive) {
    stopShowcase();
    btn.textContent = "Showcase: off";
    btn.classList.remove("active");
  } else {
    startShowcase();
    btn.textContent = "Showcase: on";
    btn.classList.add("active");
  }
});

// Deliverable 4: pause / resume state automation (music keeps playing).
$("#pause-btn").addEventListener("click", () => {
  automationPaused = !automationPaused;
  const btn = $("#pause-btn");
  btn.textContent = automationPaused ? "Automation: paused" : "Automation: live";
  btn.classList.toggle("active", automationPaused);
});

// Deliverable 5: capture the current composition and download it as a .mid.
$("#export-btn").addEventListener("click", () => exportMidi());

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

/** The 2×2 emotion selector: each cell transitions live to a quadrant's state. */
function buildEmotions(): void {
  const host = $("#emotions");
  host.innerHTML = "";
  for (const preset of EMOTIONS) {
    const btn = document.createElement("button");
    btn.className = "emotion";
    btn.textContent = preset.label;
    btn.dataset.quadrant = preset.quadrant;
    btn.addEventListener("click", () => applyEmotion(preset));
    host.appendChild(btn);
  }
}

/** Transition the live state toward an emotion quadrant (no restart). */
function applyEmotion(preset: EmotionPreset): void {
  currentEmotion = preset;
  highlightEmotion(preset.quadrant);
  if (!music || automationPaused) return;
  music.transitionTo({ ...preset.state }, { duration: { bars: 8 }, quantize: "nextBar" });
  if (preset.state.brightness !== undefined) renderer?.setBrightness(preset.state.brightness);
  syncSliders(preset.state);
  clearMoodHighlight();
}

function highlightEmotion(quadrant: string): void {
  for (const b of document.querySelectorAll<HTMLElement>("#emotions .emotion")) {
    b.classList.toggle("active", b.dataset.quadrant === quadrant);
  }
}

function clearEmotionHighlight(): void {
  currentEmotion = null;
  for (const b of document.querySelectorAll<HTMLElement>("#emotions .emotion")) {
    b.classList.remove("active");
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
    clearEmotionHighlight();
  });
  row.appendChild(input);
  row.appendChild(out);
  return row;
}

function onSlider(key: string, value: number): void {
  if (!music || automationPaused) return;
  music.setState({ [key]: value } as MusicalStatePatch, { quantize: "nextBar" });
  if (key === "brightness") renderer?.setBrightness(value);
}

function applyMood(name: string, transition: boolean): void {
  if (!music || automationPaused) return;
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
  clearEmotionHighlight();
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

/**
 * Deliverable 2: deterministic, bar-driven showcase. Start anchors the journey
 * to the engine's current bar; the runner fires each scheduled change exactly
 * once when the engine reaches its bar (see {@link tickShowcase}).
 */
function startShowcase(): void {
  if (!music) return;
  showcaseActive = true;
  showcaseStartBar = music.debug.snapshot().bar;
  showcaseNextIndex = 0;
  showcaseStageName = "starting";
}
function stopShowcase(): void {
  showcaseActive = false;
  showcaseNextIndex = 0;
  showcaseStageName = "off";
}

/**
 * Fire any showcase changes now due for the current bar. Called from the rAF
 * `update()` loop. Paused automation freezes firing; the engine keeps composing.
 * The journey loops deterministically, re-anchoring to the current bar.
 */
function tickShowcase(currentBar: number): void {
  if (!showcaseActive || !music || automationPaused) return;
  const rel = currentBar - showcaseStartBar;
  while (
    showcaseNextIndex < SHOWCASE.changes.length &&
    rel >= SHOWCASE.changes[showcaseNextIndex]!.atBar
  ) {
    const change = SHOWCASE.changes[showcaseNextIndex]!;
    music.transitionTo(change.patch, {
      duration: { bars: change.transitionBars },
      quantize: "nextBar",
    });
    if (change.patch.brightness !== undefined) renderer?.setBrightness(change.patch.brightness);
    showcaseStageName = SHOWCASE_SEQUENCE[showcaseNextIndex]!.name;
    syncSliders(change.patch);
    showcaseNextIndex++;
  }
  // Loop the journey once its full bar budget has elapsed, re-anchored so the
  // relative schedule (and thus the music) stays deterministic.
  if (showcaseNextIndex >= SHOWCASE.changes.length && rel >= SHOWCASE.totalBars) {
    showcaseStartBar = currentBar;
    showcaseNextIndex = 0;
  }
}

// --- Voice mute / solo (deliverable 3) -------------------------------------

/** Effective mute for a voice: solo silences every OTHER voice. */
function effectiveMuted(voice: VoiceId): boolean {
  if (soloVoice !== null) return voice !== soloVoice || muted[voice];
  return muted[voice];
}

/** Push the computed mute set to the renderer and reflect state in the UI. */
function applyVoiceStates(): void {
  for (const voice of VOICES) renderer?.setVoiceMuted(voice, effectiveMuted(voice));
  for (const row of document.querySelectorAll<HTMLElement>(".voice-row")) {
    const voice = row.dataset.voice as VoiceId;
    const muteBtn = row.querySelector<HTMLElement>("button.mute");
    const soloBtn = row.querySelector<HTMLElement>("button.solo");
    muteBtn?.classList.toggle("active", muted[voice]);
    soloBtn?.classList.toggle("active", soloVoice === voice);
    row.classList.toggle("muted", effectiveMuted(voice));
  }
}

function buildVoices(): void {
  const host = $("#d-voices");
  host.innerHTML = "";
  for (const voice of VOICES) {
    const row = document.createElement("div");
    row.className = "voice-row";
    row.dataset.voice = voice;
    row.innerHTML = `<span class="vname">${voice}</span>`;

    const muteBtn = document.createElement("button");
    muteBtn.className = "mute";
    muteBtn.textContent = "mute";
    muteBtn.addEventListener("click", () => {
      muted[voice] = !muted[voice];
      applyVoiceStates();
    });

    const soloBtn = document.createElement("button");
    soloBtn.className = "solo";
    soloBtn.textContent = "solo";
    soloBtn.addEventListener("click", () => {
      soloVoice = soloVoice === voice ? null : voice;
      applyVoiceStates();
    });

    row.appendChild(muteBtn);
    row.appendChild(soloBtn);
    host.appendChild(row);
  }
}

// --- MIDI export (deliverable 5) -------------------------------------------

/**
 * Capture the current composition and download it as a Standard MIDI File.
 * Uses the engine's current tempo as a single tempo value.
 */
function exportMidi(): void {
  if (!music) return;
  const bars = showcaseActive ? SHOWCASE.totalBars : 64;
  const capture = music.captureComposition(bars);
  const events: NoteEvent[] = capture.bars.flatMap((b) => b.events);
  if (events.length === 0) return;

  // Normalize event times so the file starts at tick 0 (the capture begins at
  // the live composition frontier, not bar 0).
  const minTime = events.reduce((min, e) => Math.min(min, e.time), Infinity);
  const shifted: NoteEvent[] = events.map((e) => ({ ...e, time: e.time - minTime }));

  // TODO: tempo map — the showcase changes tempo per stage; a tempoChanges[]
  // built from the captured per-bar tempo would preserve those ramps.
  const tempo = music.debug.snapshot().bpm;
  const bytes = eventsToStandardMidiFile(shifted, { tempo, name: `LIME ${currentSeed}` });

  const blob = new Blob([bytes as unknown as BlobPart], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lime-${currentSeed}.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

  // Deterministic showcase: fire any changes now due for this bar.
  tickShowcase(s.bar);
  $("#d-showcase").textContent = showcaseActive ? showcaseStageName : "off";

  $("#d-bar").textContent = String(s.bar);
  $("#d-beat").textContent = String(s.beat + 1);
  $("#d-bpm").textContent = s.bpm.toFixed(1);
  $("#d-key").textContent = `${s.keyName} ${s.mode}`;
  $("#d-chord").textContent = s.chordLabel ? `${s.chordLabel} (${s.chordRoman})` : "–";
  $("#d-phrase").textContent = s.phrase ? `${s.phrase.role} ${s.phrase.barInPhrase + 1}/${s.phrase.lengthBars}` : "–";
  $("#d-plan").textContent = s.phrasePlan ? fmtPlan(s.phrasePlan) : "–";
  $("#d-arr").textContent = s.activeVoices.length ? s.activeVoices.join(" + ") : "–";
  $("#d-form").textContent = `${s.formSection} · ${(s.formIntensity * 100).toFixed(0)}%`;

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

const ARROW: Record<string, string> = { rising: "↑", falling: "↓", steady: "→" };

/** Compact one-line view of the phrase gesture for the debug panel. */
function fmtPlan(p: PhrasePlan): string {
  const cad = p.cadenceIntent === "none" ? "" : ` · cad:${p.cadenceIntent}`;
  return (
    `${p.shape} · ` +
    `e ${p.energyStart.toFixed(2)}${ARROW[p.rhythmicDensityDirection]}${p.energyEnd.toFixed(2)}` +
    ` · t ${p.tensionStart.toFixed(2)}→${p.tensionEnd.toFixed(2)}` +
    ` · harm ${ARROW[p.harmonicDirection]} · reg ${ARROW[p.melodicRegisterDirection]}` +
    ` · mel:${p.melodicActivity}${cad}`
  );
}

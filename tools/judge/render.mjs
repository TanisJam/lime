import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLime } from "../../packages/core/dist/index.js";
import { eventsToStandardMidiFile } from "../../packages/midi/dist/index.js";
import * as styles from "../../packages/styles/dist/index.js";

/**
 * LIME offline capture — render composed music to WAV for the audio judge.
 *
 * For each (genre, seed) it drives the pure-TS composer headlessly (no browser,
 * no renderer), collects the NoteEvents, writes a Standard MIDI File with the
 * SAME per-voice GM programs + lead-register folding the browser uses, then
 * renders it to WAV with `fluidsynth` and the SAME SoundFont — so the judge
 * hears what you hear. Emits out/manifest.json for judge.py.
 *
 * Usage:
 *   node tools/judge/render.mjs                       # all 12 genres, seed 1, 24s
 *   node tools/judge/render.mjs --genres=genre-metal,genre-rock-pop --seeds=1,2,3
 *   node tools/judge/render.mjs --seconds=20
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../..");
const OUT = join(HERE, "out");
const SF2 = join(REPO, "apps/demo/public/soundfonts/GeneralUser-GS.sf2");
const TRACK_ORDER = ["pad", "bass", "melody", "motion", "percussion", "texture"];

// Per-genre GM programs + lead-register folding — MIRROR of GM_PROGRAMS in
// apps/demo/src/fluidRenderer.ts. Keep in sync so the WAV matches the browser.
const GM = {
  "genre-classical": { melody: 40, pad: 48, bass: 43, melodyMax: 79 },
  "genre-pop": { melody: 0, pad: 4, bass: 33, motion: 0, melodyMax: 76 },
  "genre-rock-pop": { melody: 29, pad: 29, bass: 33, melodyMax: 76 },
  "genre-hiphop": { melody: 4, pad: 89, bass: 38, motion: 4, melodyMax: 76 },
  "genre-jazz": { melody: 66, pad: 4, bass: 32, motion: 0 },
  "genre-blues": { melody: 27, pad: 18, bass: 33, melodyMax: 76 },
  "genre-folk": { melody: 25, pad: 24, bass: 32, melodyMax: 76 },
  "genre-latin": { melody: 56, pad: 0, bass: 33, motion: 24, melodyMax: 78 },
  "genre-funk": { melody: 66, pad: 28, bass: 33, motion: 4, melodyMax: 79 },
  "genre-metal": { melody: 29, pad: 30, bass: 33, melodyMax: 71 },
  "genre-electronic": { melody: 81, pad: 89, bass: 38, motion: 81, melodyMax: 76 },
  "genre-ambient": { melody: 73, pad: 89, melodyMax: 79 },
};

// Per-genre initial state (tempo + mood) — MIRROR of GENRE_STATE in main.ts.
const STATE = {
  "genre-classical": { energy: 0.5, valence: 0.6, tension: 0.3, density: 0.45, complexity: 0.4, instability: 0.25, brightness: 0.55, tempo: 90 },
  "genre-pop": { energy: 0.7, valence: 0.72, tension: 0.3, density: 0.55, complexity: 0.35, instability: 0.25, brightness: 0.6, tempo: 118 },
  "genre-rock-pop": { energy: 0.8, valence: 0.25, tension: 0.6, density: 0.6, complexity: 0.55, instability: 0.42, brightness: 0.38, tempo: 126 },
  "genre-hiphop": { energy: 0.8, valence: 0.4, tension: 0.35, density: 0.6, complexity: 0.35, instability: 0.3, brightness: 0.45, tempo: 88 },
  "genre-electronic": { energy: 0.76, valence: 0.45, tension: 0.4, density: 0.65, complexity: 0.45, instability: 0.35, brightness: 0.55, tempo: 126 },
  "genre-jazz": { energy: 0.55, valence: 0.5, tension: 0.35, density: 0.5, complexity: 0.55, instability: 0.4, brightness: 0.55, tempo: 130 },
  "genre-blues": { energy: 0.55, valence: 0.4, tension: 0.35, density: 0.5, complexity: 0.3, instability: 0.15, brightness: 0.45, tempo: 95 },
  "genre-folk": { energy: 0.45, valence: 0.55, tension: 0.25, density: 0.4, complexity: 0.3, instability: 0.2, brightness: 0.55, tempo: 100 },
  "genre-latin": { energy: 0.72, valence: 0.65, tension: 0.35, density: 0.6, complexity: 0.45, instability: 0.35, brightness: 0.6, tempo: 105 },
  "genre-funk": { energy: 0.72, valence: 0.55, tension: 0.35, density: 0.62, complexity: 0.45, instability: 0.35, brightness: 0.55, tempo: 108 },
  "genre-metal": { energy: 0.9, valence: 0.28, tension: 0.62, density: 0.72, complexity: 0.5, instability: 0.4, brightness: 0.42, tempo: 160 },
  "genre-ambient": { energy: 0.32, valence: 0.5, tension: 0.2, density: 0.3, complexity: 0.25, instability: 0.15, brightness: 0.5, tempo: 68 },
};

// GM program number → human name, for the programs LIME actually uses.
const GM_NAMES = {
  0: "Acoustic Grand Piano", 4: "Electric Piano (Rhodes)", 18: "Rock Organ",
  24: "Nylon Guitar", 25: "Steel Guitar", 27: "Clean Electric Guitar",
  28: "Muted Electric Guitar", 29: "Overdriven Guitar", 30: "Distortion Guitar",
  32: "Acoustic Bass", 33: "Finger Electric Bass", 38: "Synth Bass 1", 40: "Violin",
  43: "Contrabass", 48: "String Ensemble", 56: "Trumpet", 66: "Tenor Sax",
  73: "Flute", 81: "Saw Lead", 89: "Warm Pad",
};
const gmName = (n) => (n === undefined ? undefined : `${GM_NAMES[n] ?? "program"} (GM ${n})`);

const NAMES = {
  "genre-classical": "Classical", "genre-pop": "Pop", "genre-rock-pop": "Rock",
  "genre-hiphop": "Hip-hop", "genre-electronic": "Electronic", "genre-jazz": "Jazz",
  "genre-blues": "Blues", "genre-folk": "Folk", "genre-latin": "Latin",
  "genre-funk": "Funk/R&B", "genre-metal": "Metal", "genre-ambient": "Ambient",
};

// Resolve a StylePack by id: authored packs from @lime/styles, rock from corpus.
const AUTHORED = {
  "genre-classical": styles.classicalPack, "genre-pop": styles.popPack,
  "genre-hiphop": styles.hiphopPack, "genre-electronic": styles.electronicPack,
  "genre-jazz": styles.jazzPack, "genre-blues": styles.bluesPack,
  "genre-folk": styles.folkPack, "genre-latin": styles.latinPack,
  "genre-funk": styles.funkPack, "genre-metal": styles.metalPack,
  "genre-ambient": styles.ambientPack,
};
// Per-genre style overrides applied at load (kept out of the corpus JSON so a
// corpus rebuild can't clobber them). Mirror any keeper into main.ts.
const STYLE_OVERRIDE = {
  "genre-rock-pop": {
    defaultMode: "naturalMinor",
    bassStyle: "default",
    harmony: { harmonyMotion: 0.8 },
    // The corpus rock lead was ~75% sixteenth/eighth notes → a choppy, nervous
    // melody. Rebalance toward sustained values so the lead sings on every seed.
    melody: {
      motifDevelopment: 0.3,
      durationWeights: { whole: 1, half: 7, dottedQuarter: 3, quarter: 9, dottedEighth: 0.2, eighth: 0.5, sixteenth: 0.1 },
    },
    rhythm: { grooveVariation: 0.5 },
  },
  // Metal is structurally rock-like (minor, power, backbeat): move the harmony
  // and vary the drums. Keeps its fast minor-pentatonic character.
  "genre-metal": { harmony: { harmonyMotion: 0.7 }, rhythm: { grooveVariation: 0.4 } },
  // Latin/Folk read harmonically static; a moderate push helps without de-genre.
  "genre-latin": { harmony: { harmonyMotion: 0.5 } },
  "genre-folk": { harmony: { harmonyMotion: 0.5 } },
  // Blues corpus transitions wandered (III/VI/VII); force a I-IV-V progression
  // so it reads as a 12-bar blues. Dominant 7ths come from mixolydian+seventh.
  "genre-blues": { harmony: { transitions: {
    1: [{ degree: 4, weight: 3 }, { degree: 1, weight: 2.5 }, { degree: 5, weight: 1 }],
    4: [{ degree: 1, weight: 3 }, { degree: 4, weight: 1.5 }, { degree: 5, weight: 1 }],
    5: [{ degree: 4, weight: 2.5 }, { degree: 1, weight: 2.5 }],
  } } },
};
function stylePack(id) {
  let style;
  if (id === "genre-rock-pop") {
    style = JSON.parse(readFileSync(join(REPO, "packages/corpus/generated/genre-rock-pop.json"), "utf8")).style;
  } else {
    style = AUTHORED[id];
  }
  const ov = STYLE_OVERRIDE[id];
  if (!ov) return style;
  const merged = { ...style, ...ov };
  // Deep-merge nested config so corpus transitions / melody weights survive.
  if (ov.harmony) merged.harmony = { ...style.harmony, ...ov.harmony };
  if (ov.melody) merged.melody = { ...style.melody, ...ov.melody };
  if (ov.rhythm) merged.rhythm = { ...style.rhythm, ...ov.rhythm }; // keep groove/onsetProfile
  return merged;
}

function foldMelody(pitch, cfg) {
  let p = pitch + (cfg.melodyShift ?? 0);
  if (cfg.melodyMax !== undefined) while (p > cfg.melodyMax) p -= 12;
  if (cfg.melodyMin !== undefined) while (p < cfg.melodyMin) p += 12;
  return p;
}

function emotionLabel(s) {
  const val = s.valence >= 0.55 ? "positive" : s.valence <= 0.45 ? "negative" : "neutral";
  const ar = s.energy >= 0.6 ? "high-arousal" : s.energy <= 0.4 ? "low-arousal" : "mid-arousal";
  return `${ar}, ${val} valence`;
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const genres = arg("genres", Object.keys(GM).join(",")).split(",").filter(Boolean);
const seeds = arg("seeds", "1").split(",").map(Number);
const seconds = Number(arg("seconds", "24"));

mkdirSync(OUT, { recursive: true });
const clips = [];

for (const genre of genres) {
  const style = stylePack(genre);
  if (!style) { console.warn(`skip unknown genre ${genre}`); continue; }
  const state = STATE[genre];
  const cfg = GM[genre];
  const bpm = state.tempo;
  const bars = Math.ceil(seconds / (240 / bpm));

  for (const seed of seeds) {
    const lime = createLime({ seed, style, initialState: state });
    const events = [];
    for (let bar = 0; bar < bars; bar++) {
      for (const e of lime.composeBar(bar)) {
        events.push(e.voice === "melody" ? { ...e, pitch: foldMelody(e.pitch, cfg) } : e);
      }
    }
    const programs = {};
    for (const v of ["pad", "bass", "melody", "motion"]) if (cfg[v] !== undefined) programs[v] = cfg[v];

    const base = `${genre}_seed${seed}`;
    const midPath = join(OUT, `${base}.mid`);
    const wavPath = join(OUT, `${base}.wav`);
    const bytes = eventsToStandardMidiFile(events, { tempo: bpm, ppq: 480, trackOrder: TRACK_ORDER, programs, name: `${NAMES[genre]} seed ${seed}` });
    writeFileSync(midPath, bytes);
    execFileSync("fluidsynth", ["-ni", "-g", "0.8", "-r", "44100", "-F", wavPath, SF2, midPath], { stdio: "ignore" });

    const character = {
      instruments: {
        pad: gmName(cfg.pad), bass: gmName(cfg.bass),
        melody: gmName(cfg.melody), motion: gmName(cfg.motion),
      },
      chordStyle: style.chordStyle ?? "triad",
      bassStyle: style.bassStyle ?? "default",
      groove: style.rhythm?.groove ?? "none",
      melodyScale: style.melody?.scale ?? "diatonic",
      motion: style.motion ?? "none",
      tempoRange: style.tempoRange,
      mood: { energy: state.energy, valence: state.valence, tension: state.tension, density: state.density, brightness: state.brightness },
    };
    clips.push({ file: `${base}.wav`, genre, genreName: NAMES[genre], emotion: emotionLabel(state), seed, bpm, seconds, character });
    console.log(`rendered ${base}.wav  (${bars} bars @ ${bpm}bpm, ${events.length} notes)`);
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify({ sampleRate: 44100, generatedAt: new Date().toISOString(), clips }, null, 2));
console.log(`\n${clips.length} clip(s) → ${OUT}/manifest.json`);

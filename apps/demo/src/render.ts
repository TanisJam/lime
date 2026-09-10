import * as Tone from "tone";
import {
  createLime,
  type MusicalStatePatch,
  type StylePack,
  type VoiceId,
} from "@lime/core";
import {
  createToneRenderer,
  ROCK_INSTRUMENTS, METAL_INSTRUMENTS, POP_INSTRUMENTS, JAZZ_INSTRUMENTS,
  BLUES_INSTRUMENTS, HIPHOP_INSTRUMENTS, ELECTRONIC_INSTRUMENTS, FOLK_INSTRUMENTS,
  LATIN_INSTRUMENTS, FUNK_INSTRUMENTS, CLASSICAL_INSTRUMENTS,
  type InstrumentFactory,
} from "@lime/renderer-tone";
import {
  classicalPack, popPack, hiphopPack, electronicPack, jazzPack, bluesPack,
  folkPack, latinPack, funkPack, metalPack, ambientPack, applyGenreTuning,
} from "@lime/styles";
import { GENRE_PALETTES_SAMPLED } from "./sampledGenre";

/**
 * LIME offline capture (browser) — render composed music to WAV through the
 * Tone.js renderer, headlessly.
 *
 * `tools/judge/render.mjs` renders the same compositions as GM MIDI through
 * fluidsynth, which cannot reproduce the Tone palettes (distortion, cabs,
 * filters) — so metal and rock come out indistinguishable. This page renders
 * the SAME (genre, seed, state) through the real renderer + per-genre timbre
 * palettes, so the judge hears what the browser plays.
 *
 * The style packs and initial states below MIRROR `tools/judge/render.mjs`;
 * keep them in sync so both sets of clips are comparable. Per-genre style
 * tuning (defaultMode, harmonyMotion, melody rebalancing, grooveVariation,
 * etc.) is NOT mirrored here — it comes from `@lime/styles`' single
 * `applyGenreTuning`, the same one `render.mjs` and the demo's `main.ts` call
 * (see `packages/styles/src/genreTuning.ts`).
 *
 * Driven by Playwright:
 *   await page.evaluate(() => window.limeRenderClip({ genre, seed, seconds }))
 */

// --- Genre tables (mirror of tools/judge/render.mjs) --------------------------

/** Per-genre initial state (tempo + mood). MIRROR of STATE in render.mjs. */
const STATE: Record<string, MusicalStatePatch> = {
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

/** Authored packs from @lime/styles. MIRROR of AUTHORED in render.mjs. */
const AUTHORED: Record<string, StylePack> = {
  "genre-classical": classicalPack, "genre-pop": popPack,
  "genre-hiphop": hiphopPack, "genre-electronic": electronicPack,
  "genre-jazz": jazzPack, "genre-blues": bluesPack,
  "genre-folk": folkPack, "genre-latin": latinPack,
  "genre-funk": funkPack, "genre-metal": metalPack,
  "genre-ambient": ambientPack,
};

// Rock is the one corpus-derived pack. Pure JSON data, loaded the same way
// main.ts does it (no corpus code in the bundle).
const rockModules = import.meta.glob("../../../packages/corpus/generated/genre-rock-pop.json", {
  eager: true,
}) as Record<string, { default: { style: StylePack } }>;
const rockCorpusPack: StylePack | undefined = Object.values(rockModules)[0]?.default?.style;

/**
 * Resolve a StylePack by genre id and apply its canonical tuning. Rock has no
 * authored pack (its corpus JSON is the base pack); every other genre comes
 * from `@lime/styles`. Either way, `applyGenreTuning` is the single place the
 * per-genre tuning merge is expressed — see `packages/styles/src/genreTuning.ts`.
 */
function stylePack(id: string): StylePack | undefined {
  const style = id === "genre-rock-pop" ? rockCorpusPack : AUTHORED[id];
  return style ? applyGenreTuning(style) : undefined;
}

/**
 * Genre → timbre palette. Declared here rather than imported from main.ts so
 * this entry point pulls in no UI, no DOM wiring and no sampled instruments.
 * `genre-ambient` has no Tone palette and renders on the default synth voices,
 * exactly as the browser does.
 */
const GENRE_PALETTES_FOR_RENDER: Record<string, Partial<Record<VoiceId, InstrumentFactory>>> = {
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

// --- Render ------------------------------------------------------------------

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
/** Tail rendered past the music so the reverb/delay aux is not cut off. Matches
 *  the renderer's default `reverbDecay` (5 s). */
const REVERB_TAIL_SEC = 5;
/** Seconds per bar in 4/4. Mirrors the bar count in render.mjs. */
const barSeconds = (bpm: number): number => 240 / bpm;

/** Which timbre set to render with. */
export type PaletteKind = "synth" | "sampled";

export interface RenderClipOptions {
  /** Genre id, e.g. "genre-metal". */
  genre: string;
  seed: number;
  /** Musical length. The returned WAV also carries the reverb tail. */
  seconds: number;
  /** Timbre set. Defaults to the pure-synthesis palettes. */
  palette?: PaletteKind;
}

export interface RenderClipResult {
  sampleRate: number;
  /** WAV bytes (16-bit PCM stereo) as a plain array, so `page.evaluate` can
   *  serialise it across the CDP bridge. */
  wav: number[];
  /** Notes Tone refused to schedule during this render. */
  dropped: { count: number; firstReason: string };
}

/**
 * Encode a rendered buffer as a 16-bit PCM stereo WAV.
 *
 * No encoder exists in the repo and Tone offers none; this is the whole format:
 * a 44-byte canonical header followed by interleaved little-endian samples.
 */
function encodeWav(buffer: Tone.ToneAudioBuffer): Uint8Array {
  const frames = buffer.length;
  const rate = buffer.sampleRate;
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  const dataBytes = frames * CHANNELS * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * CHANNELS * 2, true); // byte rate
  view.setUint16(32, CHANNELS * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of [left, right]) {
      const s = Math.max(-1, Math.min(1, channel[i] ?? 0));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return bytes;
}

/**
 * Render one clip offline and return it as WAV bytes.
 *
 * Everything is built INSIDE the `Tone.Offline` callback: `Tone.Offline` swaps
 * the global Tone context, so a renderer constructed outside it would wire its
 * nodes into the live context and render nothing.
 *
 * `lime.start()` is deliberately NOT used: it installs a 100 ms `setInterval`
 * pump that never advances while an OfflineAudioContext renders. `composeThrough`
 * composes and schedules every bar synchronously instead.
 */
export async function renderClip(opts: RenderClipOptions): Promise<RenderClipResult> {
  const { genre, seed, seconds } = opts;
  // "synth" is the pure-synthesis palette; "sampled" swaps in recorded
  // instrument bodies (including a real distorted guitar for metal).
  const paletteKind: PaletteKind = opts.palette ?? "synth";
  const palette =
    paletteKind === "sampled" ? GENRE_PALETTES_SAMPLED[genre] : GENRE_PALETTES_FOR_RENDER[genre];
  const style = stylePack(genre);
  if (!style) throw new Error(`unknown genre "${genre}"`);
  const initialState = STATE[genre];
  if (!initialState) throw new Error(`no initial state for genre "${genre}"`);
  if (!(seconds > 0)) throw new Error(`seconds must be > 0, got ${seconds}`);

  const bpm = initialState.tempo ?? 120;
  const bars = Math.ceil(seconds / barSeconds(bpm));

  // Notes Tone refused to schedule. Reported so a caller can tell a clean clip
  // from one that lost so much material that judging it would be meaningless.
  let dropped = { count: 0, firstReason: "" };
  // Held outside the callback on purpose: the transport fires its notes during
  // context.render(), which happens AFTER the callback returns, so reading the
  // counter inside it would always report zero.
  const held: { renderer: ReturnType<typeof createToneRenderer> | null } = { renderer: null };

  const buffer = await Tone.Offline(
    async () => {
      const renderer = createToneRenderer({ instruments: palette });
      const lime = createLime({ seed, style, initialState, renderer, lookAheadBars: 4 });

      await renderer.start();
      // `renderer.ready()` awaits the reverb's impulse response. Without it the
      // convolver has no buffer yet and the whole reverb/delay aux renders
      // silent, with no error.
      await renderer.ready();
      // Samplers fetch their audio; without this they render silent.
      await Tone.loaded();

      // Tempo is normally set by `lime.start()`. Assign it directly (rather than
      // via `renderer.setTempo`, which ramps over 0.5 s) so the clip sits at a
      // fixed tempo from sample zero, like the fluidsynth clips.
      Tone.getTransport().bpm.value = bpm;
      if (initialState.brightness !== undefined) renderer.setBrightness(initialState.brightness);

      held.renderer = renderer;
      lime.composeThrough(bars - 1);
    },
    seconds + REVERB_TAIL_SEC,
    CHANNELS,
    SAMPLE_RATE,
  );

  dropped = held.renderer ? held.renderer.droppedNotes : dropped;
  if (buffer.length === 0) throw new Error(`render produced an empty buffer for ${genre} seed ${seed}`);
  return { sampleRate: buffer.sampleRate, wav: Array.from(encodeWav(buffer)), dropped };
}

declare global {
  interface Window {
    limeRenderClip: (opts: RenderClipOptions) => Promise<RenderClipResult>;
    /** Set once the module has evaluated; poll before calling `limeRenderClip`. */
    limeRenderReady: boolean;
  }
}

window.limeRenderClip = renderClip;
window.limeRenderReady = true;

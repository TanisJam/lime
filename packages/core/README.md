# @tanisjam/lime-core

Pure TypeScript continuous adaptive music composer. **No audio dependencies** —
`@tanisjam/lime-core` only produces musical events (notes, chords, phrases);
pair it with [`@tanisjam/lime-renderer-tone`](https://www.npmjs.com/package/@tanisjam/lime-renderer-tone)
for browser playback, or [`@tanisjam/lime-midi`](https://www.npmjs.com/package/@tanisjam/lime-midi)
to export Standard MIDI Files headlessly (Node or browser).

LIME generates continuous, adaptive music in real time. You don't tell it
which notes to play — you tell it how the music should *feel* (energy,
tension, valence, tempo), and it composes a few bars into the future,
remembering and developing material as the intent changes.

## Install

```bash
npm install @tanisjam/lime-core
```

## Usage

With a renderer (see `@tanisjam/lime-renderer-tone`):

```ts
import { createLime } from "@tanisjam/lime-core";
import { createToneRenderer } from "@tanisjam/lime-renderer-tone";
import { ambientMinimal } from "@tanisjam/lime-styles";

const music = createLime({
  seed: "forest-level-12",
  style: ambientMinimal,
  renderer: createToneRenderer({ instrumentation: ambientMinimal.instrumentation }),
  initialState: { energy: 0.2, tension: 0.1, valence: 0.65, tempo: 76 },
});

// Must run inside a user gesture (click, keydown, …) — see "Playback,
// start/stop and browser autoplay" below.
await music.start();

// Gradual transition, absorbed over 8 bars.
music.transitionTo({ energy: 0.85, tension: 0.9, valence: 0.2 }, { duration: { bars: 8 } });

// `urgent: true` makes the change audible on the very next bar instead of
// waiting out the already-composed look-ahead window — useful for a sudden
// event (e.g. the player is hit). It discards and recomposes the unplayed
// bars ahead of the playhead; it degrades gracefully to a normal quantized
// change when the renderer can't cancel scheduled notes.
music.setState({ tension: 1, energy: 1 }, { urgent: true, quantize: "immediate" });
```

Headless (no renderer — Node, tests, offline rendering):

```ts
import { createLime } from "@tanisjam/lime-core";
import { ambientMinimal } from "@tanisjam/lime-styles";

const music = createLime({ seed: 42, style: ambientMinimal });

// Compose 8 bars headlessly and get every note/chord/phrase produced.
const capture = music.captureComposition(8);
console.log(capture.bars.length, capture.keyPc, capture.mode);
```

## Musical state

`setState`/`transitionTo` take a partial `MusicalState` — the application's
*intent*, not notes. Seven parameters are normalized to **0–1**; `tempo` is in
BPM and is clamped to **60–130** regardless of what you pass (`clampTempo`).
The composer maintains its own current state and converges toward whatever
you set at musically meaningful boundaries (see "Timing" below) — it never
jumps discontinuously mid-phrase.

| Parameter | Range | Musical effect |
| --- | --- | --- |
| `energy` | 0–1 | Rhythmic density, activity, layer count, average velocity. The broadest "how much is happening" dial. At very low energy, melody and percussion can drop out entirely. |
| `tension` | 0–1 | Harmonic instability: dominant/leading-tone tendency, cadence avoidance. Higher tension keeps the harmony reaching rather than resolving. |
| `valence` | 0–1 | Emotional axis, 0 = darker, 1 = brighter/positive. One influence among several (mode, register, harmony), not a hard rule. |
| `density` | 0–1 | Amount of musical information, independent of `energy` — more notes/ornamentation/voices active at once without necessarily being louder or faster. |
| `brightness` | 0–1 | Register/timbre brightness. Inside the composer it biases voicing register (pad/melody octave and register choice — see `OrchestrationDirector`/`PadGenerator`), pushing brighter values up and darker values down. It is *not* automatically wired to a renderer's own timbral filter: `@tanisjam/lime-renderer-tone`'s `ToneRenderer` and the demo's FluidSynth renderer both expose their own `setBrightness(v)` for filter-cutoff timbre, which a host app calls itself if it wants brightness to also affect tone color, not just register. |
| `complexity` | 0–1 | Rhythmic variation, motif transformation, syncopation, chord-change rate. Low complexity favors repetition and stable patterns; high complexity favors variation and faster harmonic movement. |
| `instability` | 0–1 | Willingness to depart from established patterns (low = the composer leans on repetition and familiar material; high = it's more willing to introduce new material). |
| `tempo` | 60–130 BPM | Tempo. Not normalized. Renderers ramp to it (see `MusicRenderer.setTempo`) to avoid a discontinuous jump. |

## Timing

### Wall-clock terms

LIME works in **bars**, not seconds, but everything maps predictably onto
wall-clock time in 4/4 (the only meter in v0.x):

```
bar length (seconds) = 4 beats × 60 / bpm
```

| Tempo | Bar length |
| --- | --- |
| 60 bpm | 4.00 s |
| 90 bpm | 2.67 s |
| 120 bpm | 2.00 s |

To convert a wall-clock duration into a bar count at the *current* tempo:

```ts
function secondsToBars(seconds: number, bpm: number): number {
  return seconds / ((4 * 60) / bpm); // 4/4 only
}

const bpm = music.debug.snapshot().bpm;
music.transitionTo({ energy: 0.8 }, { duration: { bars: secondsToBars(6, bpm) } });
```

### `quantize`

`quantize` (default `"nextBar"`) picks the earliest bar a change is allowed to
land on:

- `"immediate"` / `"nextBeat"` — as soon as possible. In practice these two
  resolve identically: the engine only ever quantizes at bar granularity
  (there is no mid-bar application), so both mean "the earliest bar that
  isn't already frozen" (see below) — not literally the current beat.
- `"nextBar"` — the bar right after the current playhead bar.
- `"nextPhrase"` — the start of the next phrase (a style's
  `phraseLengthBars` bars), e.g. every 4 or 8 bars depending on the style.

Whichever boundary that resolves to, it is then clamped forward to the
earliest **not-yet-composed** bar: bars already composed inside the
look-ahead horizon (`LimeConfig.lookAheadBars`, default 4) are frozen and
can't be changed retroactively — this is the "musical inertia" at the
parameter level. If you need to override even the frozen horizon, use
`urgent` instead.

### `duration.bars` vs. omitting it

`setState` and `transitionTo` differ in what "no duration" means:

- **`setState(patch, { duration: { bars } })`** — with `duration.bars`
  given, a precise **linear ramp** of that length. **Omitted**, it defaults
  to `0`, which means gradual **asymptotic easing**: each bar, the current
  value closes a fixed fraction (`easingPerBar`, default `0.25`,
  configurable via `LimeConfig.easingPerBar`) of the remaining gap to the
  target — it approaches but never overshoots, and never fully "arrives" in
  a fixed number of bars. Good for continuous background drift toward a new
  baseline.
- **`transitionTo(patch, { duration: { bars } })`** — `duration` is
  required by the type, but if you omit `bars` it defaults to **4**, i.e. a
  4-bar linear ramp, not easing. Use `transitionTo` when you want a
  deliberate, finite transition; use `setState` when you want to nudge the
  baseline and let it settle on its own schedule.

### `urgent`

`urgent: true` makes a change audible on the very next bar instead of
waiting out the look-ahead horizon: the engine discards whatever was already
composed (and scheduled) between the playhead and the horizon, and
recomposes it under the new state. It requires a renderer that implements
`MusicRenderer.cancelFrom` (`ToneRenderer` does); without one — or headless
usage, where nothing is ever composed ahead of the frontier — it degrades
gracefully to a normal quantized change.

| Goal | Suggested options |
| --- | --- |
| Snappy UI response (a click, a hit) | `{ urgent: true, duration: { bars: 1 } }` or `{ bars: 2 }` |
| Scene / area change | `{ urgent: true, duration: { bars: 4 } }` |
| Slow ambient drift | `setState(patch)` — no `duration`, no `urgent` |

## Playback: `start()`/`stop()` and browser autoplay

- **Browser autoplay:** call `music.start()` from inside a user gesture
  handler (a click/keydown listener). `ToneRenderer.start()` itself calls
  `Tone.start()` internally — you do not need to call it yourself — but the
  browser still requires the *call stack* that first triggers `start()` to
  originate from a real user interaction, or `Tone.start()`/the underlying
  `AudioContext` will stay suspended.
- **`stop()`** halts the renderer but keeps the composition exactly where it
  is: key, form position, motif memory, harmonic plan and the composed-ahead
  horizon all survive. It does not rewind or reset anything about the piece.
- **`start()` after `stop()` resumes the same piece.** Many renderers
  (`Tone.Transport.stop()` among them) reset their own clock to tick 0 on
  `stop()`; `LimeEngine` re-anchors the composition's timeline onto the
  renderer's clock on the next `start()` and re-sends whatever material was
  already composed but not yet played (the renderer's own schedule was wiped
  by `stop()`), so playback picks back up in the same piece instead of
  restarting a fresh one at bar 0. Calling `start()` while already running,
  or interleaving `start()`/`stop()` repeatedly, is safe and never
  double-registers the internal pump timer.

```ts
startButton.addEventListener("click", async () => {
  await music.start(); // safe to call again after a later stop()
});
stopButton.addEventListener("click", () => {
  music.stop();
});
```

## Public API

The **documented surface** below is stable-ish for 0.x and is what you
should build against: `createLime`, every `Lime` method (`start`, `stop`,
`setState`, `transitionTo`, `isRunning`, `debug.snapshot()`, `composeBar`,
`pump`, `composeThrough`, `step`, `captureComposition`, `buildCapture`), the
`MusicalState`/`MusicalStatePatch`/`StateChangeOptions`/`Quantization` types,
`StylePack`, `MusicRenderer`, `DebugSnapshot`, and the capture/analysis
helpers under `analysis/` (`analyze`, `BarCapture`, `CompositionCapture`).

Everything else exported from the package (harmony/phrase/motif/orchestration
internals, generators, humanization, `SeededRandom`, etc.) is an internal
building block the composer is made of. It's exported because the corpus
tooling and test suite use it directly, and you're welcome to reach for it,
but it's more likely to change shape between 0.x releases than the surface
above.

## Example: scroll-driven music

```ts
import { createLime } from "@tanisjam/lime-core";
import { createToneRenderer } from "@tanisjam/lime-renderer-tone";
import { ambientMinimal } from "@tanisjam/lime-styles";

const music = createLime({
  seed: "scroll-story",
  style: ambientMinimal,
  renderer: createToneRenderer({ instrumentation: ambientMinimal.instrumentation }),
  initialState: { energy: 0.25, tension: 0.1, valence: 0.6 },
});

// Start on the first user interaction (browser autoplay policy).
document.getElementById("start-btn")!.addEventListener(
  "click",
  () => void music.start(),
  { once: true },
);

// Each <section data-mood="..."> drives the music as it scrolls into view.
const sections = document.querySelectorAll<HTMLElement>("section[data-mood]");
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const mood = (entry.target as HTMLElement).dataset.mood;
      if (mood === "climax") {
        // A jump-scare-style beat: land on the very next bar.
        music.transitionTo(
          { energy: 0.9, tension: 0.7, density: 0.8 },
          { urgent: true, duration: { bars: 2 } },
        );
      } else if (mood === "calm") {
        music.transitionTo({ energy: 0.25, tension: 0.1, density: 0.3 }, { duration: { bars: 4 } });
      }
    }
  },
  { threshold: 0.5 },
);
sections.forEach((section) => observer.observe(section));
```

## API

- `createLime(config: LimeConfig): Lime` — build an engine instance.
- `Lime.start()` / `Lime.stop()` — drive playback through a `MusicRenderer`.
  See "Playback" above for the stop/start resume contract.
- `Lime.setState(patch, options?)` / `Lime.transitionTo(patch, options)` —
  request a musical-intent change (`energy`, `tension`, `valence`, `tempo`, …).
  `options.urgent` skips the look-ahead delay; `options.duration`/`quantize`
  control easing and timing otherwise.
- `Lime.captureComposition(bars)` / `Lime.step()` / `Lime.composeThrough(bar)` —
  headless composition for analysis, tests or offline export.
- `Lime.debug.snapshot()` — a `DebugSnapshot` of current/target state, active
  motif, upcoming harmony, per-voice activity.

See [ARCHITECTURE.md](https://github.com/TanisJam/lime/blob/main/ARCHITECTURE.md)
and the [root README](https://github.com/TanisJam/lime#readme) for the full
design and package overview.

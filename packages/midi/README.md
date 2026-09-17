# @tanisjam/lime-midi

Standard MIDI File (SMF) export for [LIME](https://github.com/TanisJam/lime).
Pure TypeScript, zero runtime dependencies — writes Format 1 SMF bytes by
hand from `@tanisjam/lime-core` note events.

## Install

```bash
npm install @tanisjam/lime-midi
```

## Usage

```ts
import { createLime } from "@tanisjam/lime-core";
import { ambientMinimal } from "@tanisjam/lime-styles";
import { eventsToStandardMidiFile } from "@tanisjam/lime-midi";
import { writeFileSync } from "node:fs";

const music = createLime({ seed: 42, style: ambientMinimal });
const capture = music.captureComposition(16);
const events = capture.bars.flatMap((bar) => bar.events);

const bytes = eventsToStandardMidiFile(events, { tempo: 120 });
writeFileSync("out.mid", bytes);
```

## API

`eventsToStandardMidiFile(events: readonly NoteEvent[], opts?: MidiExportOptions): Uint8Array`

`opts`:
- `ppq` — pulses per quarter note (default `TICKS_PER_QUARTER`, 480).
- `tempo` — single BPM when no `tempoChanges` map is given (default 120).
- `tempoChanges` — `{ tick, bpm }[]` tempo map, takes precedence over `tempo`.
- `trackOrder` — voice write order (default `DEFAULT_TRACK_ORDER`).
- `name` — sequence name meta written to the conductor track.
- `programs` — per-voice General MIDI program (0–127), so a bare SMF played
  by a GM synth (e.g. FluidSynth) uses the intended instrument.

Percussion is written to channel 9 (`DRUM_CHANNEL`); every other voice gets
the next free channel.

See the [root README](https://github.com/TanisJam/lime#readme) and
[ARCHITECTURE.md](https://github.com/TanisJam/lime/blob/main/ARCHITECTURE.md)
for how this fits into the rest of LIME.

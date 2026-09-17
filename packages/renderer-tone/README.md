# @tanisjam/lime-renderer-tone

Browser renderer for [LIME](https://github.com/TanisJam/lime) built on
[Tone.js](https://tonejs.github.io/) — the only LIME package allowed to
depend on Tone. Maps `@tanisjam/lime-core`'s tick-based symbolic events onto
`Tone.Transport` for real-time playback.

This package requires a browser (Web Audio) environment to actually produce
sound; its exports resolve and type-check under Node, but running it needs a
browser or a Web Audio polyfill.

## Install

```bash
npm install @tanisjam/lime-renderer-tone tone
```

`tone` is a **peer dependency** — install it yourself so your app shares one
Tone instance (and one `AudioContext`/`Transport`) between LIME and any other
Tone-based code you run. LIME targets `tone@^15`.

## Usage

```ts
import { createLime } from "@tanisjam/lime-core";
import { createToneRenderer } from "@tanisjam/lime-renderer-tone";
import { ambientMinimal } from "@tanisjam/lime-styles";

const renderer = createToneRenderer({ instrumentation: ambientMinimal.instrumentation });

const music = createLime({
  seed: "forest-level-12",
  style: ambientMinimal,
  renderer,
  initialState: { energy: 0.2, tension: 0.1, valence: 0.65, tempo: 76 },
});

// Call from a user gesture — Web Audio requires it.
await music.start();
```

## API

- `createToneRenderer(options?: ToneRendererOptions): ToneRenderer` — build a
  `MusicRenderer` for `createLime({ renderer })`.
  - `options.instrumentation` — per-voice mix config.
  - `options.instruments` — override per-voice `InstrumentFactory`s (e.g. a
    `Tone.Sampler`-based instrument with your own samples); voices without an
    override use the built-in self-contained palette.
- Built-in instrument factories and genre palettes (`DEFAULT_INSTRUMENT_FACTORIES`,
  `ROCK_INSTRUMENTS`, `POP_INSTRUMENTS`, `JAZZ_INSTRUMENTS`, `METAL_INSTRUMENTS`,
  and more) are exported for reuse or as a reference when writing your own.

See the [root README](https://github.com/TanisJam/lime#readme) and
[ARCHITECTURE.md](https://github.com/TanisJam/lime/blob/main/ARCHITECTURE.md)
for how this fits into the rest of LIME.

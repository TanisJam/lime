# LIME

**Live Interactive Music Engine** — a continuous adaptive music engine for the web.

**▶ [Live demo](https://dist-pi-indol-64.vercel.app)** — enter, then drive the mood in real time.

LIME generates continuous, adaptive music in real time. You don't tell it which
notes to play — you tell it how the music should *feel*, and it composes a few
bars into the future, remembering and developing material as the intent changes.
No song boundaries, no loop restarts, no crossfading between tracks.

```ts
import { createLime } from "@lime/core";
import { createToneRenderer } from "@lime/renderer-tone";
import { ambientMinimal } from "@lime/styles";

const music = createLime({
  seed: "forest-level-12",
  style: ambientMinimal,
  renderer: createToneRenderer({ instrumentation: ambientMinimal.instrumentation }),
  initialState: { energy: 0.2, tension: 0.1, valence: 0.65, tempo: 76 },
});

await music.start();

music.transitionTo(
  { energy: 0.85, tension: 0.9, valence: 0.2 },
  { duration: { bars: 8 } },
);
```

## Workspace

| Package | What it is |
| --- | --- |
| `@lime/core` | Pure-TypeScript composer. **No audio dependencies.** |
| `@lime/renderer-tone` | Browser renderer (Tone.js). |
| `@lime/styles` | Built-in StylePacks (`ambient-minimal`). |
| `@lime/demo` | Vite demo: sliders, mood buttons, live debug panel, showcase. |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design.

## Develop

```bash
pnpm install
node apps/demo/scripts/setup-fluidsynth.mjs   # fetch the FluidSynth-WASM + SoundFont assets (gitignored, ~31 MB)
pnpm build          # build core, styles, renderer (required before the demo)
pnpm test           # run the core test suite
pnpm demo           # start the Vite demo at http://localhost:5173
```

> The demo's high-fidelity playback path uses FluidSynth-WASM and a SoundFont that
> are gitignored (large and regenerable). Run the `setup-fluidsynth.mjs` script
> once after `pnpm install`, or the demo audio will not load.

> The demo consumes the `@lime/*` packages from their built `dist`, so run
> `pnpm build` again after changing `core`, `styles`, or `renderer-tone`.

## Demo

Open the demo, click **ENTER LIME** (audio starts on interaction), then drive the
music with the state sliders or the mood buttons
(**Calm → Explore → Unease → Danger → Resolve**). Toggle **Showcase** to cycle
the moods automatically. The debug panel shows the live bar/beat/BPM, key, chord,
phrase role, active motif, upcoming harmony, per-voice activity, and current vs.
target state.

The **Style pack** dropdown switches between the built-in `ambient-minimal` and
any corpus-generated pack found in `packages/corpus/generated/` (e.g.
`emotion-calm`, `emotion-tense`) — build those with `pnpm corpus:build --merge`
(see `packages/corpus/CORPUS.md`). **⟳ seed** recomposes the current style with a
new seed.

## Status

v0.3 — **Orchestration & Multi-Genre**. Determinism, continuous composition,
musical inertia, motif memory, and adaptive state are implemented and tested,
now with per-genre orchestration (ambient, blues, hip-hop, jazz, rock/pop). See
ARCHITECTURE.md for what is intentionally out of scope.

## Judging the output

Genre quality here is measured, not asserted. Three independent listeners score
rendered clips — MuQ-MuLan, Essentia `genre_discogs400` and MAEST — and their
fused verdict feeds a blind-identification and confusion-matrix report under
`tools/judge/`.

That judge is itself calibrated against 48 reviewed human recordings, eight for
each of six genres, and the outcome is worth knowing before you read any number
it produces: **only Blues and Electronic pass the per-class trust gates.**
Funk/R&B, Rock and Pop score 25 %, 13 % and 0 % top-1 on real, human-made,
human-labelled music, so a LIME score in those genres measures the evaluator
more than it measures the music. A blind listening test confirmed the direction
of the gap — a human identifies funk that the ears cannot hear.

Treat any per-genre number outside the two trusted classes as unproven.
[tools/judge/README.md](./tools/judge/README.md) documents the calibration
workflow, the class gates and how to read them.

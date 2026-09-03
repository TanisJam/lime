# LIME

**Live Interactive Music Engine** — a continuous adaptive music engine for the web.

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
pnpm build          # build core, styles, renderer (required before the demo)
pnpm test           # run the core test suite
pnpm demo           # start the Vite demo at http://localhost:5173
```

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

v0.1 — proof of concept. Determinism, continuous composition, musical inertia,
motif memory, and adaptive state are implemented and tested. See ARCHITECTURE.md
for what is intentionally out of scope.

# @tanisjam/lime-styles

Built-in `StylePack`s for [LIME](https://github.com/TanisJam/lime) — genre
presets, tuning tables and General MIDI program maps consumed by
`@tanisjam/lime-core` and `@tanisjam/lime-renderer-tone`.

## Install

```bash
npm install @tanisjam/lime-styles
```

## Usage

```ts
import { createLime } from "@tanisjam/lime-core";
import { ambientMinimal, popPack, applyGenreTuning } from "@tanisjam/lime-styles";

const music = createLime({
  seed: "forest-level-12",
  style: ambientMinimal,
  initialState: { energy: 0.2, tension: 0.1, valence: 0.65, tempo: 76 },
});
```

```ts
// Authored genre packs, tuned to their genre's grammar before use.
const style = applyGenreTuning(popPack);
```

## API

- `ambientMinimal: StylePack` — the built-in default style.
- `GENRE_PACKS: Record<string, StylePack>` and named exports (`popPack`,
  `hiphopPack`, `jazzPack`, `bluesPack`, `folkPack`, `latinPack`, `funkPack`,
  `metalPack`, `classicalPack`, `electronicPack`, `ambientPack`) — authored
  genre `StylePack`s. Most target genres aren't in the reference MIDI corpus,
  so their grammar is authored from validated fingerprints rather than
  extracted (see [GENRES.md](https://github.com/TanisJam/lime/blob/main/GENRES.md)).
- `applyGenreTuning(pack): StylePack` / `GENRE_TUNING` and per-genre
  tuning tables (`ROCK_TUNING`, `METAL_TUNING`, `LATIN_TUNING`, `FOLK_TUNING`,
  `BLUES_TUNING`) — corpus-calibrated adjustments layered onto a pack.
- `GM_PROGRAMS`, `GM_PROGRAM_NAMES`, `GUITAR_PROGRAMS`, `gmProgramName(id)` —
  General MIDI program tables, used for MIDI export (`@tanisjam/lime-midi`)
  and instrument selection.

See the [root README](https://github.com/TanisJam/lime#readme) and
[ARCHITECTURE.md](https://github.com/TanisJam/lime/blob/main/ARCHITECTURE.md)
for how this fits into the rest of LIME. Corpus-generated packs (built from
`@tanisjam/lime-corpus`, private/dev-only) are documented in
[packages/corpus/CORPUS.md](https://github.com/TanisJam/lime/blob/main/packages/corpus/CORPUS.md).

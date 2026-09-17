# Changelog

All notable changes to the LIME packages are documented in this file.

## Unreleased

- `@tanisjam/lime-core` — fix: calling `Lime.start()` after `Lime.stop()`
  went silent for a long time (or indefinitely at a fixed tempo). Most
  renderers reset their own clock to tick 0 on `stop()` (e.g.
  `Tone.Transport.stop()`), but the engine's composition frontier
  (`composedThroughBar`) never moved, so the playhead had to catch up in
  real time before `pump()` would compose anything new, and whatever was
  already composed but unplayed had been wiped from the renderer's own
  schedule along with everything else. `LimeEngine` now re-anchors the
  composition's tick timeline onto the renderer's (possibly reset) clock on
  `start()` and re-sends the composed-but-unplayed material, so a restart
  resumes the same piece instead of going silent. Documented as the
  `Lime.start`/`Lime.stop` contract.

## 0.1.0 — Initial release

First public release of the LIME (Live Interactive Music Engine) packages:

- `@tanisjam/lime-core` — pure TypeScript continuous adaptive composer:
  seeded determinism, musical-intent state (`energy`/`tension`/`valence`/`tempo`),
  motif memory, phrase/form direction, per-genre orchestration, and headless
  composition/analysis APIs. Includes `urgent` state changes, which recompose
  already-composed look-ahead bars so an intent change lands on the very next
  bar instead of waiting out the look-ahead window.
- `@tanisjam/lime-renderer-tone` — browser renderer built on Tone.js, with
  built-in instrument palettes per genre (rock, pop, jazz, blues, hip-hop,
  electronic, folk, latin, funk, metal, classical, ambient).
  `tone` is a peer dependency.
- `@tanisjam/lime-styles` — built-in StylePacks: an ambient default, authored
  genre packs, corpus-calibrated genre tuning, and General MIDI program tables.
- `@tanisjam/lime-midi` — Standard MIDI File (SMF) export, pure TypeScript
  with zero runtime dependencies.

This release also ships a genre judge and calibration pipeline (`tools/judge/`)
that scores generated audio against real, human-labelled reference recordings
across harmony, rhythm, melody and responsiveness — see the root README for
current per-genre trust gates.

`@tanisjam/lime-corpus` (corpus ingestion/StylePack-compilation tooling) and
the Vite demo app remain private and are not published to npm.

# LIME Architecture (v0.1)

**LIME — Live Interactive Music Engine.** A continuous adaptive music engine for
the web. This document reflects the v0.1 implementation and the reasoning behind
it.

## Core idea

The application communicates **musical intent**, not notes:

```ts
music.setState({ energy: 0.8, tension: 0.7, valence: 0.2 });
```

The engine keeps its own *current* musical state and converges toward the
requested *target* at musically meaningful boundaries. It composes a few bars
into the future continuously, so playback never stops and changes are absorbed
gradually rather than as abrupt automation.

```
APPLICATION STATE → TARGET STATE → StateManager → CURRENT STATE
      → HarmonyPlanner / Orchestrator (composer) → MusicalEvent[] → Renderer
```

## Packages

```
packages/
  core/            pure TypeScript composer — NO audio deps
  renderer-tone/   browser renderer (the only place Tone.js is used)
  styles/          built-in StylePacks (ambient-minimal)
apps/
  demo/            Vite app: sliders, moods, live debug panel, showcase mode
```

`core` is host-agnostic (Node, browser, Web Worker) and knows nothing about how
sound is produced. It talks to a `MusicRenderer` interface; `ToneRenderer`
implements it. This keeps the door open for SoundFont, Web MIDI, or MIDI-file
export renderers with no core changes.

## Determinism

Everything random flows through `SeededRandom` (cyrb128 + sfc32). Composition
code never calls `Math.random()`. Streams are **hierarchical**: `rng.derive(name)`
yields an independent, reproducible child stream, so changing (say) percussion
logic does not perturb harmony. The engine splits the root seed into
`harmony`, `orchestration → pad/bass/melodyBar/melodyMotif/percussion`, and each
voice further derives a **bar-scoped** stream (`voiceStream.derive(String(bar))`).
Bar generation is therefore idempotent and order-independent for randomness;
cross-bar continuity is carried by explicit fields, not RNG state.

## Time model

Integer **ticks** at `TICKS_PER_QUARTER = 480` (MIDI-friendly). `Meter` is
explicit (only 4/4 in v0.1). Events carry absolute ticks and no renderer data,
so MIDI export later is straightforward. Hierarchy: note < beat < bar < phrase.

## Harmony (the spine)

- **Symbolic scale degrees**, never note names (`Scale.ts`, `Chord.ts`).
- Modes: major, natural minor, dorian, mixolydian.
- `HarmonyRules.ts` is a **weighted transition system**; weights bend with state
  (tension favors dominant/predominant and cadence avoidance; valence tints
  chord color; instability/complexity flatten the distribution toward the
  unexpected). It always has a *direction*.
- `HarmonyPlanner.ts` plans **a phrase at a time, ahead of the playhead**. Once a
  chord is planned it is frozen. A later state change only affects *unplanned*
  future bars — this is the **musical inertia** the handoff asks for. Cadence
  phrases resolve toward the tonic (deceptive to vi under high tension).
- `PhrasePlanner.ts` cycles a grammar: statement → variation → development →
  cadence (4- or 8-bar phrases), so structure evolves without obvious looping.

## Motifs & memory (musical identity)

- `Motif.ts`: a motif is diatonic **step offsets + rhythm**, so realizing it over
  any key/anchor is in-scale by construction.
- `MotifTransformer.ts`: transpose, invert, fragment, augment.
- `ComposerMemory.ts`: motifs, recent motif ids, pitch histogram, recent chords,
  and unresolved commitments — short-term memory that enables
  introduce → remember → vary → return → develop instead of random-forever.

## Voices

`pad`, `bass`, `melody`, `percussion` (+ optional `texture`). Each generator is a
pure per-bar function of a `BarContext`.

- **Pad** — harmonic bed; light voice leading (`Voicing.ts`), register from
  brightness, note count from density/energy, re-attacks from energy/complexity.
- **Bass** — chord root; sustained at low energy, growing to a pulse with fifths,
  octaves, and next-root anticipation (kept diatonic in v0.1).
- **Melody** — motif-driven: pick/return/introduce a motif, adapt to the chord,
  apply a role-appropriate variation, schedule. Density/energy gate whether it
  sounds at all; **silence is valid**.
- **Percussion** — abstract kick/snare/hat from a small grammar; energy-gated
  (disappears at low energy), density drives the hat pulse.

## State convergence

`StateManager` holds `current` and `target`. `setState` eases current toward
target asymptotically; `transitionTo` uses a precise linear ramp over N bars.
Requested changes are queued with an `applyAtBar` derived from `quantize`
(`immediate` / `nextBeat` / `nextBar` / `nextPhrase`), clamped to the earliest
uncommitted bar (parameter-level inertia). Generators sample `currentState` once
per bar, so most parameters take effect at bar boundaries; brightness is applied
continuously by the renderer as a filter parameter.

## Scheduling

`CompositionScheduler` keeps `lookAheadBars` (default 4) composed beyond the
playhead. `pump()` composes forward one bar at a time and never regenerates a
committed bar. The renderer is the clock: `now()` returns transport ticks. The
`ToneRenderer` sets `Transport.PPQ` to match core ticks, schedules events at
absolute ticks, and ramps BPM so tempo changes are smooth.

## Testing

`packages/core` has deterministic Vitest coverage: seed reproducibility, seed
divergence, pitch validity (in-scale), scheduling horizon, no-regeneration of
committed bars, state bounds across transitions, silence at low energy, and
harmony continuity/cadence resolution.

## Out of scope for v0.1

Neural/LLM generation, imported MIDI, jazz/chromatic harmony, key modulation,
multiple meters, polyrhythm, microtonality, Web MIDI hardware, multiplayer,
server components, AudioWorklet DSP, full MIDI export. The event model is
designed so MIDI export is easy to add later.

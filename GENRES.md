# LIME — Multi-Genre Design & Research Note

**Goal:** LIME should play in twelve genres and *sound like* each one — not just
tweak harmony, but carry the genre's instrumentation, groove, and timbre.

This is a research/spec note. It fixes what defines each genre, how we classify
the corpus into them, what we extract, and how we render the sound. Nothing here
is built yet; it is the foundation to review before we build.

---

## 1. Where each ingredient comes from

A genre's identity has three layers, and they live in three different places:

| Layer | What it is | Source |
|---|---|---|
| **Composition** | scales, progressions, riffs, cycles, cadences, melodic shape | **the MIDI corpus** (already parsed: notes) |
| **Instrumentation + groove** | which instruments play which role; the drum pattern | **the MIDI corpus** (GM `program` per track; channel-10 drums — already parsed, not yet used) |
| **Timbre** | the actual *sound* of those instruments | **authored in the renderer** (samples / synths) — the MIDI only names the instrument, it has no audio |

The corpus does the heavy lifting on the first two. We only author the third —
and even that is *guided* by the corpus (it tells us "distorted guitar here,
drum kit there"). Proven on real files:

```
Beethoven 5th   strings:6074 reed:3527 brass:1352   drums:0    → classical
Amr Diab        piano:197 ensemble:124 reed:105      drums:338  → band/pop
Batman (screen) strings:944 brass:561                drums:401  → cinematic
```

The GM instrument signature discriminates genre on its own.

---

## 2. Classification strategy

Today genre comes from filename/folder tokens only, leaving ~62% as `various`.
For twelve genres we combine three signals, most-confident first:

1. **Name tokens** — composer/artist/folder (what `genreForPath` does now).
2. **GM instrumentation signature** — the distribution of instrument families +
   drum presence. A file with distorted guitar + bass + kit is rock/metal; piano
   + upright + sax + brushes is jazz; 808 + sparse melodic content is hip-hop;
   strings/winds + no drums is classical.
3. **Musical features** — tempo, mode, harmonic vocabulary, swing, syncopation
   (from the analyzers we already have + new ones).

A small, transparent scoring function combines these into a best-genre guess
with a confidence; low confidence stays `various` (honest unknown). This also
rescues much of the anonymous numeric dump, which *does* carry GM + musical
signal even without a name.

> Reality check: the collection is old-school MIDI — rich in classical, rock,
> pop, screen; thin in hip-hop, modern electronic, metal. Genres the corpus
> can't populate get an **authored** grammar (from this note's fingerprints)
> until better data arrives. Classification tells us honestly which is which.

---

## 3. Genre fingerprints

Each entry: **scale/harmony · rhythm/groove · instrumentation (→ LIME roles) ·
tempo**. These drive both classification and the authored defaults. Tempos and
load-bearing claims were validated against sources (see Appendix A); values
here are the corrected ones. BPM ranges are approximate — no single authority
exists, so they are working bands, not hard limits.

### Clásica / académica
- Functional tonal harmony (I–IV–V–I, secondary dominants, real modulation);
  major & minor; counterpoint. Large forms (sonata, theme & variations), wide
  dynamic range, expressive tempo flexibility (rubato/accel./rit.). *(Pre-1600
  and some 20th-c. repertoire is modal/atonal — a narrower core than the umbrella.)*
- Rubato/straight, **no backbeat drum kit** (timpani/cymbals only).
- Strings, winds, brass, piano, timpani.
- **~40–200** (Largo ≈40–60 … Allegro ≈120–156 … Presto ≈168–200).

### Popular / pop
- Predominantly major/diatonic (Aeolian minor common) — "classical tonality,
  simplified"; 4-chord loops (I–V–vi–IV & rotations); verse–chorus around a hook.
- Straight backbeat (kick 1/3, snare 2/4), steady 8th hats; often programmed.
- Vocal-lead → synth/piano, electric bass, kit, pads.
- **90–130** (core ~100–130, 120 most common).

### Rock
- Pentatonic/blues over major, plus Dorian/Mixolydian; power chords (root-fifth),
  I–♭VII–IV, riffs; verse–chorus with a lead/rhythm split and guitar solos.
- Driving backbeat, straight 8ths in 4/4, snare on 2/4, crash accents.
- Distorted electric guitar (rhythm + lead), electric bass, drum kit, organ (opt).
- **~110–140 core** (subgenre spread 100–160).

### Hip-hop / rap
- Loop-based, minor/Dorian, sampled chord stabs; sparse/static harmonic motion.
- **Boom-bap:** hard kick 1/3, snare 2/4, swung. **Trap:** double/triple-time hi-hats,
  triplet rolls, 808 glides. Space and pocket over motion.
- Sampled keys/strings, vinyl texture, MPC/SP-1200 feel; 808 sub+kick (central to
  trap), sampled/acoustic bass (boom-bap), snare/clap on 2/4.
- **Boom-bap ~85–95; Trap ~130–150 (felt half-time ~70).** *(split, not a flat range)*

### Electrónica / dance
- Modal/minor riffs, sustained pads, filter movement; simple harmony, much motion;
  build → breakdown → drop tension arc.
- **Four-on-the-floor** kick + offbeat open hats + syncopated bass — **house/techno/
  trance only.** **Dubstep/DnB are breakbeat/half-time, NOT four-on-floor.**
- Supersaw (JP-8000), analog synths, sub bass, drum machines (TR-808/909), arps.
- **Per sub-style:** house 115–130 · techno 120–150 · trance 125–150 · dubstep
  132–142 · drum-and-bass 160–180.

### Jazz
- ii–V–I everywhere, 7/9/13 extensions, tritone subs, secondary dominants, modal
  (Dorian/Mixolydian/Lydian), bebop/altered/diminished scales.
- Swing (triplet subdivision), ride-cymbal pattern + brushes, comping; walking bass.
- Piano/Rhodes, upright bass (walking), brushed kit, sax/trumpet.
- **~50–300:** ballad 50–85 · medium swing 90–140 · bebop/fast 180–300+.

### Blues
- 12-bar (I–IV–V) with **dominant 7ths throughout**; blues scale + blue notes
  (♭3/♭5/♭7), major/minor pentatonic; AAB lyric form, call-and-response.
- Shuffle = triplet-based (middle note dropped), swung 8ths, laid-back backbeat
  (Chicago shuffle vs Texas/double shuffle).
- Electric/acoustic guitar, harmonica, piano/organ, upright or electric bass, kit.
- **60–120** (most classics 80–100).

### Folk / tradicional
- Modal (Dorian/Mixolydian/Aeolian) and simple major/pentatonic; drones/pedal tones,
  open & modal tunings (DADGAD), non-functional modal motion; strophic, **AABB** tunes.
- Straight or lilting; often no kit, hand percussion.
- Acoustic guitar, fiddle, flute/whistle, mandolin, upright bass, light percussion.
  *(Western/Anglo-Celtic subset — global "folk" is far broader: sheng, mbira, …)*
- **Repertoire-dependent (≈60 ballads … 110–120+ reels)** — no reliable single band.

### Latina *(sub-styles differ materially — treat separately)*
- Tonality major/minor; **salsa:** montuno/tumbao over I–IV–V & dominant chains;
  **bossa nova:** jazz ii–V–I with 7/9 extensions; **cumbia/reggaeton:** vamp/loop-based.
- **Clave** (son/rumba, 2–3 or 3–2) as structural organizer; tumbao = tresillo-based
  bass/conga ostinato; anticipated (ahead-of-beat) bass. **Reggaeton uses the dembow
  (3+3+2 tresillo), not clave.**
- Piano montuno, brass, bass, percussion battery (congas, timbales, bongos, güiro,
  claves), nylon guitar (bossa). *(Reggaeton is largely programmed, not the acoustic battery.)*
- **Per sub-style:** salsa 90–130 · bossa ~120–140 notated / ~60–70 felt *(contested)* ·
  cumbia 85–100 · reggaeton 85–100.

### R&B / soul / funk *(umbrella — funk faster than modern R&B)*
- Extended 7/9/11 chords, chromatic passing, gospel voicings; groove/vamp over static
  or minimal changes (one/two-chord vamps); Dorian/Mixolydian + pentatonic/blues.
- Syncopated 16th-note funk groove, emphasis on **"the one,"** ghost notes, tight pocket.
- Rhodes/clavinet, electric bass (slap/finger), tight kit, horn section, wah guitar.
- **Funk 90–130 · R&B/soul 60–110** (modern R&B often 75–90).

### Metal
- Power chords, drop/down tuning, Aeolian/Phrygian modes, tritones, chromatic
  progressions, pedal-point riffs, palm-mute. *(Phrygian-dominant leans death/neoclassical.)*
- Double-kick, driving 8th/16th, galloping palm-muted figures, blast beats (200–240+);
  dual guitar (rhythm + lead/solos); extreme vocals.
- Heavily distorted down-tuned guitars, distorted bass, big kit.
- **~60–220+:** doom 40–80 · groove/nu 90–130 · thrash/death 140–220 · blast 200–240.

### Experimental / ambient / avant-garde
- Non-functional harmony, drones, sustained/repeated tones, atonal or modal;
  tone clusters & extended technique (more avant-garde art music than ambient proper).
- Free/pulseless or slow-evolving; texture over beat.
- Synth pads, processed/emulated textures, field recordings, prepared/extended instruments.
- **40–90 or beatless.** *(Closest to today's ambientMinimal.)*

---

## 4. What we extract from the corpus (new analysis)

Extending the existing harmony/melody/rhythm extractors:

- **Instrumentation profile** — GM-family histogram per file/genre → which roles
  are active and what family plays each (e.g. rock: guitar=lead+harmony,
  bass=bass, kit=rhythm).
- **Drum grooves** — channel-10 pattern extraction → per-genre kit patterns
  (backbeat, shuffle, four-on-floor, boom-bap, clave) instead of one generic
  percussion grammar.
- **Characteristic progressions & cycles** — mine frequent degree n-grams per
  genre (12-bar blues, ii–V–I, I–♭VII–IV) as reusable progression templates.
- **Riffs / ostinati** — recurring short pitch-rhythm cells per genre.
- **Scale/mode tendency** — beyond major/minor: dorian, mixolydian, phrygian
  dominant, blues, pentatonic (needs a modal key-detection upgrade).
- **Swing/groove ratio** — off-beat timing deviation → swing amount per genre.

These feed richer, genre-specific StylePacks (composition side).

---

## 5. Timbre — the authored layer (real instruments)

Decision: **real / sampled instruments** (not pure synthesis), because the goal
is authenticity. The renderer gains an instrument palette keyed by GM family;
the corpus's instrumentation profile picks which the genre uses.

- **Instrument palette** — sampled multisamples per family: piano, Rhodes,
  organ, acoustic/electric/distorted guitar, upright/electric/synth bass,
  strings, sax/brass, flute, and per-genre **drum kits** (acoustic, jazz brushes,
  808/trap, electronic, rock). Loaded via `Tone.Sampler`, which the renderer
  already supports as an optional path.
- **Sourcing** — free/permissive licenses only, so the demo stays runnable after
  install (CC0 / CC-BY with credit; e.g. the sampled-instrument sources already
  scoped earlier). A sample-manifest + loader task. Synthesis stays as the
  zero-asset fallback for anything unsampled.
- **Mapping** — `GM program → family → renderer instrument`, and roles get
  genre-appropriate defaults (metal lead = distorted guitar; jazz foundation =
  upright bass). This is where v0.3's MusicalRole layer pays off.

---

## 6. Engine gaps this surfaces

Some genres need composition features v0.2/v0.3 doesn't fully have yet — these
join the v0.3 harmonic-realization work:

- 7th/9th/13th chords & extensions (jazz, R&B, soul).
- Dominant-7th-throughout & blue notes (blues).
- Swing/shuffle timing (jazz, blues, hip-hop).
- Power chords & phrygian-dominant (metal).
- Clave-locked syncopation (latina).
- Modal key detection (folk, jazz, metal).

---

## 7. Staged rollout (listen at each step)

1. **This note** — agree the genre definitions and approach.
2. **Instrumentation + groove extraction** — add GM-family and channel-10 drum
   analysis; verify per-genre profiles against known files.
3. **Prototype ONE genre end-to-end** — recommend **Rock**: the corpus has data
   (GROUPS/Dylan/bands), it's instantly recognizable, and it exercises the whole
   stack (distorted guitar + bass + kit timbre, power-chord/pentatonic grammar,
   backbeat groove). Get it to *sound like rock*, by ear.
4. **Generalize the system**, then roll out the remaining eleven, each with a
   listening checkpoint, sampling per-genre timbres and grooves as we go.
5. **Later:** genre blends, sub-styles (bossa vs salsa), user-authored genres.

The principle stays LIME's: the host asks for a genre + an emotion + a state, and
the engine composes it — now with the right instruments, groove, and harmony.

---

## Appendix A — Validation & sources

The §3 fingerprints were validated against reliable sources (the empirical GM
instrumentation evidence in §1 comes from parsing the corpus itself). Harmony,
scale, and instrumentation claims are well-established music theory (Wikipedia
genre articles used for load-bearing structural facts). Tempo ranges have **no
single canonical authority** — commercial BPM aggregators (bpmcalc, etc.) were
treated as corroborating, not authoritative — so they are working bands.

**What changed from the memory-only draft:**

- **Classical** tempo widened 50–160 → **~40–200** (Largo…Presto).
- **Rock** center lowered to **~110–140** (envelope 100–160); added Dorian/Mixolydian.
- **Metal** widened 120–200 → **~60–220+** (doom 40–80 … blast 200–240); Aeolian/
  Phrygian emphasis; Phrygian-dominant scoped to death/neoclassical.
- **Jazz** swing low-end lowered 100 → **~90**; full envelope ~50–300.
- **R&B/soul/funk** split: **funk 90–130 vs R&B/soul 60–110** (modern R&B slower).
- **Latina** broken into sub-styles (salsa/bossa/cumbia/reggaeton); **reggaeton uses
  dembow, not clave**, and is programmed, not the acoustic battery.
- **Hip-hop** split: **boom-bap ~85–95 vs trap ~130–150 (felt ~70)**.
- **Dance** split by sub-style (house/techno/trance/dubstep/DnB); **four-on-the-floor
  is house/techno/trance only** — dubstep/DnB are breakbeat/half-time.
- **Folk** tempo flagged as repertoire-dependent (no reliable single band); noted the
  fingerprint is a Western/Anglo-Celtic subset of a much broader umbrella.
- **Blues/Pop/Ambient**: confirmed largely as drafted (minor refinements).

**Representative sources** (structural claims): Wikipedia — Twelve-bar blues,
Tumbao, Dembow beat, Trap music, Boom bap, House/Techno/Trance/Dubstep/Drum-and-bass,
Heavy metal music, Rock music, Pop music, Ambient music, Folk music; classical
tempo markings (theonlinemetronome, classical-music.com); BPM corroboration
(bpmcalc.com genre pages, audiolover, drumeo, happybluesman). Full URLs are in the
research task records.

**Still contested / low-confidence:** bossa-nova BPM (half-time feel makes cited
figures inconsistent); folk global tempo; exact BPM endpoints everywhere (treat as
ranges). These are the values to re-check against real corpus data during
extraction (§4), which will give us *our* distributions to anchor on.

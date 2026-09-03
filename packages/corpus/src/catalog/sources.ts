/**
 * Curated catalog of free/legal symbolic-music sources for building LIME style
 * corpora. Verified September 2026.
 *
 * IMPORTANT — licensing: only `redistributable` sources may be committed to a
 * repo or used commercially. `user-download` sources (non-commercial /
 * research licenses) must be fetched by the end user locally; LIME ships only
 * the DERIVED STATISTICS compiled from them, never the files themselves.
 */

export type SourceTier = "redistributable" | "user-download";

export interface CorpusSource {
  readonly id: string;
  readonly name: string;
  readonly tier: SourceTier;
  readonly license: string;
  readonly formats: readonly ("MIDI" | "MusicXML" | "LilyPond" | "PDF")[];
  /** Rough genre coverage. */
  readonly genres: readonly string[];
  /** Whether pieces carry emotion annotations. */
  readonly emotionLabels: boolean;
  readonly multiInstrument: boolean;
  readonly url: string;
  readonly notes: string;
}

export const SOURCES: readonly CorpusSource[] = [
  {
    id: "openscore-lieder",
    name: "OpenScore Lieder",
    tier: "redistributable",
    license: "CC0 (public domain)",
    formats: ["MusicXML", "MIDI"],
    genres: ["classical", "romantic", "art-song"],
    emotionLabels: false,
    multiInstrument: true,
    url: "https://musescore.org/en/openscore-lieder-corpus",
    notes: "1300+ 19th-century songs (voice + piano). CC0 — fully redistributable and commercial-safe.",
  },
  {
    id: "openscore-string-quartets",
    name: "OpenScore String Quartets",
    tier: "redistributable",
    license: "CC0 (public domain)",
    formats: ["MusicXML", "MIDI"],
    genres: ["classical"],
    emotionLabels: false,
    multiInstrument: true,
    url: "https://musescore.org/en/openscore-string-quartets",
    notes: "Multi-voice quartets — excellent for voice-leading and counterpoint statistics.",
  },
  {
    id: "pdmx",
    name: "PDMX (Public Domain MusicXML)",
    tier: "redistributable",
    license: "Public domain (CC0-equivalent)",
    formats: ["MusicXML"],
    genres: ["classical", "folk", "mixed"],
    emotionLabels: false,
    multiInstrument: true,
    url: "https://zenodo.org/records/14648209",
    notes: "250K+ public-domain scores scraped from MuseScore. Largest copyright-free symbolic set.",
  },
  {
    id: "mutopia",
    name: "Mutopia Project",
    tier: "redistributable",
    license: "Public domain / CC",
    formats: ["MIDI", "LilyPond", "PDF"],
    genres: ["classical", "baroque"],
    emotionLabels: false,
    multiInstrument: true,
    url: "https://www.mutopiaproject.org/",
    notes: "Public-domain classical. LilyPond/MIDI (no MusicXML).",
  },
  {
    id: "emopia",
    name: "EMOPIA",
    tier: "user-download",
    license: "CC BY-NC-SA 4.0 (non-commercial)",
    formats: ["MIDI"],
    genres: ["pop"],
    emotionLabels: true,
    multiInstrument: false,
    url: "https://annahung31.github.io/EMOPIA/",
    notes: "1087 pop-piano clips, Russell 4-quadrant emotion labels. Piano only. Non-commercial — user downloads; ship stats only.",
  },
  {
    id: "vgmidi",
    name: "VGMIDI",
    tier: "user-download",
    license: "Research / non-commercial",
    formats: ["MIDI"],
    genres: ["video-game", "soundtrack"],
    emotionLabels: true,
    multiInstrument: false,
    url: "https://github.com/lucasnfe/vgmidi",
    notes: "200 labelled + 3850 unlabelled game-music piano arrangements, valence-arousal labels. Very on-theme for game audio.",
  },
  {
    id: "gigamidi",
    name: "GigaMIDI",
    tier: "user-download",
    license: "CC BY-NC 4.0 (non-commercial)",
    formats: ["MIDI"],
    genres: ["multi-genre"],
    emotionLabels: false,
    multiInstrument: true,
    url: "https://huggingface.co/datasets/Metacreation/GigaMIDI",
    notes: "2.1M+ multi-instrument MIDI (incl. Lakh, MetaMIDI). Non-commercial — user downloads; ship stats only.",
  },
  {
    id: "lakh-midi",
    name: "Lakh MIDI Dataset",
    tier: "user-download",
    license: "Research-only (scraped; copyright unclear)",
    formats: ["MIDI"],
    genres: ["multi-genre", "pop", "rock"],
    emotionLabels: false,
    multiInstrument: true,
    url: "https://colinraffel.com/projects/lmd/",
    notes: "170K multi-genre multi-instrument. Legally murky — research/experimentation only, never redistribute or ship commercially.",
  },
];

/** Sources safe to commit and use commercially. */
export const REDISTRIBUTABLE_SOURCES = SOURCES.filter((s) => s.tier === "redistributable");

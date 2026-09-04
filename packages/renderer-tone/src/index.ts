export { ToneRenderer, createToneRenderer } from "./ToneRenderer.js";
export type { ToneRendererOptions, LimeInstrument, InstrumentFactory } from "./ToneRenderer.js";
export {
  DEFAULT_INSTRUMENT_FACTORIES,
  padFactory,
  bassFactory,
  melodyFactory,
  percussionFactory,
  linToDb,
} from "./instruments.js";
export {
  ROCK_INSTRUMENTS,
  rockGuitarFactory,
  rockRhythmFactory,
  rockBassFactory,
  rockKitFactory,
  guitarVoice,
} from "./rockPalette.js";
export {
  METAL_INSTRUMENTS,
  POP_INSTRUMENTS,
  JAZZ_INSTRUMENTS,
  BLUES_INSTRUMENTS,
  HIPHOP_INSTRUMENTS,
  ELECTRONIC_INSTRUMENTS,
  FOLK_INSTRUMENTS,
  LATIN_INSTRUMENTS,
  FUNK_INSTRUMENTS,
  CLASSICAL_INSTRUMENTS,
  subBassFactory,
  metalLeadFactory,
  metalRhythmFactory,
  popLeadFactory,
  popPadFactory,
  popBassFactory,
} from "./genrePalettes.js";
export {
  ROCK_SAMPLED,
  METAL_SAMPLED,
  BLUES_SAMPLED,
  JAZZ_SAMPLED,
  POP_SAMPLED,
  LATIN_SAMPLED,
  FUNK_SAMPLED,
  CLASSICAL_SAMPLED,
  FOLK_SAMPLED,
  sampledRockGuitarFactory,
  sampledElectricBassFactory,
  sampledPianoFactory,
  sampledAcousticGuitarFactory,
} from "./sampledPalettes.js";

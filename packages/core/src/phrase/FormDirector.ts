/**
 * Form — the large-scale arc, so a piece goes somewhere over minutes.
 *
 * The phrase grammar gives local shape (statement, development, cadence) and the
 * theme recurs, but on its own the music loops the same 16-bar gesture forever:
 * there is no journey. The FormDirector adds one. It runs a slow structural
 * arch — intro, exposition, development, climax, recap, coda — over many phrases
 * and expresses it as an intensity envelope that swells to a peak and settles.
 *
 * That envelope rides on top of the host's emotional state as a deviation, not
 * an override: the host still sets where the arc is centred (its energy is the
 * baseline), and a host that deliberately asks for near-silence gets it — the
 * form only shapes a journey once there is energy to work with. Fed back through
 * the arc, dynamics, and arrangement, it makes voices enter and leave and the
 * texture build and release across the whole piece.
 */

export type FormSection =
  | "intro"
  | "exposition"
  | "development"
  | "climax"
  | "recap"
  | "coda";

interface FormStage {
  readonly section: FormSection;
  readonly intensity: number;
}

/** One full arch, one stage per phrase. The cycle repeats. */
const FORM: readonly FormStage[] = [
  { section: "intro", intensity: 0.2 },
  { section: "exposition", intensity: 0.45 },
  { section: "exposition", intensity: 0.5 },
  { section: "development", intensity: 0.63 },
  { section: "development", intensity: 0.72 },
  { section: "climax", intensity: 0.85 },
  { section: "recap", intensity: 0.55 },
  { section: "coda", intensity: 0.3 },
];

/** Mean intensity, so the envelope reads as a deviation centred on the host. */
const FORM_MEAN =
  FORM.reduce((sum, stage) => sum + stage.intensity, 0) / FORM.length;

export interface FormState {
  readonly section: FormSection;
  /** Envelope value 0..1 at this bar (interpolated between stages). */
  readonly intensity: number;
  /** Deviation from the form's mean intensity (-,0,+) — the signed swell. */
  readonly deviation: number;
  /** 0..1 position through the whole form cycle. */
  readonly position: number;
}

export class FormDirector {
  /** The form state at an absolute bar, interpolated smoothly between stages. */
  at(bar: number, phraseLengthBars: number): FormState {
    const len = phraseLengthBars > 0 ? phraseLengthBars : 1;
    const phraseIdx = Math.floor(bar / len);
    const n = FORM.length;
    const idx = ((phraseIdx % n) + n) % n;
    const cur = FORM[idx]!;
    const next = FORM[(idx + 1) % n]!;
    const t = (bar - phraseIdx * len) / len;
    const intensity = cur.intensity + (next.intensity - cur.intensity) * t;
    return {
      section: cur.section,
      intensity,
      deviation: intensity - FORM_MEAN,
      position: (idx + t) / n,
    };
  }
}

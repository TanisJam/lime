import { ticksPerBar, ticksPerBeat } from "../time/MusicalTime.js";
import { MODE_INTERVALS, triadDegrees, type Mode } from "../harmony/Scale.js";
import { functionOfDegree } from "../harmony/Chord.js";
import type { NoteEvent } from "../events/MusicalEvent.js";
import type {
  AnalysisReport,
  BarCapture,
  CompositionCapture,
  DimensionReport,
  Metric,
} from "./types.js";
import { clamp01, mean, pearson, ramp, stddev, sweetSpot, entropyBits } from "./stats.js";

function metric(score: number, value: number, detail: string): Metric {
  return { score: clamp01(score), value, detail };
}

function dimension(metrics: Record<string, Metric>, weights: Record<string, number>): DimensionReport {
  let sum = 0;
  let wsum = 0;
  for (const [k, w] of Object.entries(weights)) {
    const m = metrics[k];
    if (!m) continue;
    sum += m.score * w;
    wsum += w;
  }
  return { metrics, score: wsum > 0 ? sum / wsum : 0 };
}

const CONST_THRESHOLD = 0.02;

/**
 * Evaluate a captured composition across harmony, rhythm, melody, and
 * responsiveness to state. All measures are objective, structural proxies — they
 * catch incoherence, monotony, looping, and lack of development, but do not
 * judge subjective beauty.
 */
export function analyzeComposition(capture: CompositionCapture): AnalysisReport {
  const { bars, meter, keyPc, mode } = capture;
  const barTicks = ticksPerBar(meter);

  const scalePcs = new Set(MODE_INTERVALS[mode].map((iv) => (keyPc + iv) % 12));
  const tonicTriadPcs = new Set(
    [0, 2, 4].map((i) => (keyPc + (MODE_INTERVALS[mode][i] as number)) % 12),
  );

  const energies = bars.map((b) => b.state.energy);
  const tensions = bars.map((b) => b.state.tension);
  const onsetCounts = bars.map((b) => b.events.length);
  const melodyCounts = bars.map((b) => b.events.filter((e) => e.voice === "melody").length);
  const avgVelocities = bars.map((b) => (b.events.length > 0 ? mean(b.events.map((e) => e.velocity)) : 0));
  const dominantFlag = bars.map((b) => (functionOfDegree(b.chord.degree) === "dominant" ? 1 : 0));

  // Realized tension responses (immediate, per-bar): melodic dissonance
  // (non-chord scale tones) and rhythmic syncopation (off-beat kick/snare).
  const beatTicks = ticksPerBeat(meter);
  const dissonancePerBar = bars.map((b) => {
    const mel = b.events.filter((e) => e.voice === "melody");
    if (mel.length === 0) return 0;
    const triad = triadPitchClasses(b.chord.degree, b.chord.keyPc, b.chord.mode);
    const diss = mel.filter((e) => !triad.has(((e.pitch % 12) + 12) % 12)).length;
    return diss / mel.length;
  });
  const syncopationPerBar = bars.map((b) => {
    const beats = b.events.filter((e) => e.voice === "percussion" && e.percussion !== "hat");
    if (beats.length === 0) return 0;
    const barStart = b.bar * barTicks;
    const off = beats.filter((e) => (e.time - barStart) % beatTicks !== 0).length;
    return off / beats.length;
  });

  const energyVaries = stddev(energies) >= CONST_THRESHOLD;
  const tensionVaries = stddev(tensions) >= CONST_THRESHOLD;

  const harmony = analyzeHarmony(bars, tonicTriadPcs);
  const rhythm = analyzeRhythm(bars, barTicks, meter, energies, onsetCounts, melodyCounts, energyVaries);
  const melody = analyzeMelody(capture, scalePcs);
  const responsiveness = analyzeResponsiveness(
    energies, onsetCounts, avgVelocities, tensions, dissonancePerBar, syncopationPerBar, dominantFlag, energyVaries, tensionVaries,
  );

  const overall =
    harmony.score * 0.3 +
    rhythm.score * 0.25 +
    melody.score * 0.3 +
    responsiveness.score * 0.15;

  return { harmony, rhythm, melody, responsiveness, overall, bars: bars.length };
}

function analyzeHarmony(bars: BarCapture[], tonicTriadPcs: Set<number>): DimensionReport {
  // Collapse to one chord per distinct chord span.
  const chords = [];
  let lastBar = -1;
  for (const b of bars) {
    if (b.chord.bar !== lastBar) {
      chords.push(b.chord);
      lastBar = b.chord.bar;
    }
  }

  // Cadence resolution: last bar of each cadence phrase should be tonic-function.
  const cadenceBars = bars.filter((b) => b.phrase.isCadencePhrase && b.phrase.isLastBar);
  const resolved = cadenceBars.filter((b) => functionOfDegree(b.chord.degree) === "tonic").length;
  const cadenceRate = cadenceBars.length > 0 ? resolved / cadenceBars.length : 1;
  const cadence = metric(
    cadenceBars.length > 0 ? cadenceRate : 1,
    cadenceRate,
    cadenceBars.length > 0
      ? `${resolved}/${cadenceBars.length} cadence phrases resolve to tonic`
      : "no cadence phrases in range",
  );

  // Functional coherence: penalize dominant→predominant retrogressions.
  let transitions = 0;
  let coherent = 0;
  for (let i = 1; i < chords.length; i++) {
    const from = functionOfDegree(chords[i - 1]!.degree);
    const to = functionOfDegree(chords[i]!.degree);
    transitions++;
    if (!(from === "dominant" && to === "predominant")) coherent++;
  }
  const coherenceRate = transitions > 0 ? coherent / transitions : 1;
  const coherence = metric(coherenceRate, coherenceRate, `${coherent}/${transitions} progressions functional`);

  // Tonal clarity: weight of tonic-triad pitch classes among pitched notes.
  let tonicWeight = 0;
  let pitched = 0;
  for (const b of bars) {
    for (const e of b.events) {
      if (e.voice === "percussion") continue;
      pitched++;
      if (tonicTriadPcs.has(((e.pitch % 12) + 12) % 12)) tonicWeight++;
    }
  }
  const clarityValue = pitched > 0 ? tonicWeight / pitched : 0;
  const clarity = metric(ramp(clarityValue, 0.15, 0.5), clarityValue, `${(clarityValue * 100).toFixed(0)}% on tonic triad`);

  // Chord variety: distinct degrees over the ideal band.
  const distinctDegrees = new Set(chords.map((c) => c.degree)).size;
  const varietyValue = distinctDegrees / 7;
  // Diatonic degrees are always in-key, so more variety is richness, not chaos:
  // reward up to a healthy spread, then plateau.
  const variety = metric(ramp(varietyValue, 0.15, 0.6), varietyValue, `${distinctDegrees}/7 degrees used`);

  return dimension(
    { cadence, coherence, clarity, variety },
    { cadence: 0.3, coherence: 0.3, clarity: 0.2, variety: 0.2 },
  );
}

function analyzeRhythm(
  bars: BarCapture[],
  barTicks: number,
  meter: { numerator: number; denominator: number },
  energies: number[],
  onsetCounts: number[],
  melodyCounts: number[],
  energyVaries: boolean,
): DimensionReport {
  // Energy → density correlation.
  const edCorr = pearson(energies, onsetCounts);
  const energyDensity = energyVaries
    ? metric(ramp(edCorr, 0, 0.6), edCorr, `r=${edCorr.toFixed(2)} energy↔density`)
    : metric(1, edCorr, "energy constant (n/a)");

  // Silence: fraction of bars with no melody.
  const silentBars = melodyCounts.filter((c) => c === 0).length;
  const silenceValue = bars.length > 0 ? silentBars / bars.length : 0;
  const silence = metric(sweetSpot(silenceValue, -0.4, 0.3, 0.95), silenceValue, `${(silenceValue * 100).toFixed(0)}% bars melody-silent`);

  // Loop detection: max self-similarity of bar fingerprints at phrase-multiple lags.
  const grid = ticksPerBeat(meter) / 4;
  const fingerprints = bars.map((b) => fingerprintBar(b, barTicks, grid));
  const maxSim = maxSelfSimilarity(fingerprints);
  const loop = metric(clamp01(1 - maxSim / 0.7), maxSim, `${(maxSim * 100).toFixed(0)}% max bar self-similarity`);

  // Density variation (coefficient of variation of onset counts).
  const m = mean(onsetCounts);
  const cv = m > 0 ? stddev(onsetCounts) / m : 0;
  const variation = metric(sweetSpot(cv, 0.02, 0.4, 1.5), cv, `cv=${cv.toFixed(2)} onset variation`);

  return dimension(
    { energyDensity, silence, loop, variation },
    { energyDensity: 0.3, silence: 0.2, loop: 0.3, variation: 0.2 },
  );
}

function analyzeMelody(capture: CompositionCapture, scalePcs: Set<number>): DimensionReport {
  const melodyEvents: NoteEvent[] = [];
  let pitchedTotal = 0;
  let inScale = 0;
  for (const b of capture.bars) {
    for (const e of b.events) {
      if (e.voice === "percussion") continue;
      pitchedTotal++;
      if (scalePcs.has(((e.pitch % 12) + 12) % 12)) inScale++;
      if (e.voice === "melody") melodyEvents.push(e);
    }
  }
  const inScaleValue = pitchedTotal > 0 ? inScale / pitchedTotal : 1;
  const inScaleMetric = metric(ramp(inScaleValue, 0.9, 1.0), inScaleValue, `${(inScaleValue * 100).toFixed(1)}% pitched notes in scale`);

  // Motif recurrence from the usage log.
  const uses = capture.motifUsage.length;
  const distinct = new Set(capture.motifUsage).size;
  const reuse = uses > 0 ? (uses - distinct) / uses : 0;
  const recurrence =
    uses >= 3
      ? metric(ramp(reuse, 0.1, 0.6), reuse, `${uses} uses, ${distinct} distinct motifs`)
      : metric(0.5, reuse, `only ${uses} motif uses (n/a)`);

  // Contour balance: fraction of stepwise motion.
  melodyEvents.sort((a, b) => a.time - b.time);
  let steps = 0;
  let intervals = 0;
  for (let i = 1; i < melodyEvents.length; i++) {
    const iv = Math.abs(melodyEvents[i]!.pitch - melodyEvents[i - 1]!.pitch);
    intervals++;
    if (iv <= 2) steps++;
  }
  const stepRatio = intervals > 0 ? steps / intervals : 0;
  // "Step" here is <=2 semitones; diatonic thirds count as small leaps, so a
  // motif melody sits comfortably around half stepwise.
  const contour = metric(sweetSpot(stepRatio, 0.2, 0.55, 0.97), stepRatio, `${(stepRatio * 100).toFixed(0)}% stepwise`);

  // Pitch entropy (normalized against 7 diatonic classes).
  const pcCounts = new Map<number, number>();
  for (const e of melodyEvents) {
    const pc = ((e.pitch % 12) + 12) % 12;
    pcCounts.set(pc, (pcCounts.get(pc) ?? 0) + 1);
  }
  const normEntropy = melodyEvents.length > 0 ? entropyBits([...pcCounts.values()]) / Math.log2(7) : 0;
  // Entropy guards against a *static* melody (one or two pitches). Broad, even
  // use of the scale is fine — order-coherence is covered by recurrence/contour.
  const entropy = metric(ramp(normEntropy, 0.15, 0.55), normEntropy, `pitch-class entropy ${(normEntropy * 100).toFixed(0)}% of max`);

  return dimension(
    { inScale: inScaleMetric, recurrence, contour, entropy },
    { inScale: 0.35, recurrence: 0.25, contour: 0.2, entropy: 0.2 },
  );
}

function analyzeResponsiveness(
  energies: number[],
  onsetCounts: number[],
  avgVelocities: number[],
  tensions: number[],
  dissonancePerBar: number[],
  syncopationPerBar: number[],
  dominantFlag: number[],
  energyVaries: boolean,
  tensionVaries: boolean,
): DimensionReport {
  // All scored channels are realized immediately from current state.
  const edCorr = pearson(energies, onsetCounts);
  const energyDensity = energyVaries
    ? metric(ramp(edCorr, 0, 0.6), edCorr, `r=${edCorr.toFixed(2)} energy↔density`)
    : metric(1, edCorr, "energy constant (n/a)");

  const evCorr = pearson(energies, avgVelocities);
  const energyVelocity = energyVaries
    ? metric(ramp(evCorr, 0, 0.5), evCorr, `r=${evCorr.toFixed(2)} energy↔velocity`)
    : metric(1, evCorr, "energy constant (n/a)");

  // Tension now has immediate realized effects: melodic dissonance and rhythmic
  // syncopation both rise with it.
  const tdisCorr = pearson(tensions, dissonancePerBar);
  const tensionDissonance = tensionVaries
    ? metric(ramp(tdisCorr, 0, 0.35), tdisCorr, `r=${tdisCorr.toFixed(2)} tension↔dissonance`)
    : metric(1, tdisCorr, "tension constant (n/a)");

  const tsynCorr = pearson(tensions, syncopationPerBar);
  const tensionSyncopation = tensionVaries
    ? metric(ramp(tsynCorr, 0, 0.3), tsynCorr, `r=${tsynCorr.toFixed(2)} tension↔syncopation`)
    : metric(1, tsynCorr, "tension constant (n/a)");

  // Harmony is planned a phrase ahead and frozen, so tension→dominant is lagged
  // by design — surfaced as informational (weight 0), not scored.
  const tdomCorr = pearson(tensions, dominantFlag);
  const tensionDominant = metric(clamp01(0.5 + tdomCorr), tdomCorr, `r=${tdomCorr.toFixed(2)} tension↔dominant (lagged, informational)`);

  return dimension(
    { energyDensity, energyVelocity, tensionDissonance, tensionSyncopation, tensionDominant },
    { energyDensity: 0.3, energyVelocity: 0.2, tensionDissonance: 0.25, tensionSyncopation: 0.25, tensionDominant: 0 },
  );
}

// --- helpers ---------------------------------------------------------------

/** Pitch classes of a diatonic triad on `degree` in a key/mode. */
function triadPitchClasses(degree: number, keyPc: number, mode: Mode): Set<number> {
  const set = new Set<number>();
  for (const d of triadDegrees(degree)) {
    const idx = (((d - 1) % 7) + 7) % 7;
    set.add((keyPc + (MODE_INTERVALS[mode][idx] as number)) % 12);
  }
  return set;
}

function fingerprintBar(b: BarCapture, barTicks: number, grid: number): string {
  const barStart = b.bar * barTicks;
  const tokens = b.events
    .map((e) => `${e.voice}:${Math.round((e.time - barStart) / grid)}:${((e.pitch % 12) + 12) % 12}`)
    .sort();
  return tokens.join(",");
}

/** Max fraction of bars identical to an earlier bar at a fixed lag. */
function maxSelfSimilarity(fingerprints: string[]): number {
  const n = fingerprints.length;
  if (n < 4) return 0;
  let max = 0;
  for (let lag = 1; lag <= Math.floor(n / 2); lag++) {
    let same = 0;
    let compared = 0;
    for (let i = lag; i < n; i++) {
      compared++;
      if (fingerprints[i] === fingerprints[i - lag] && fingerprints[i] !== "") same++;
    }
    if (compared > 0) max = Math.max(max, same / compared);
  }
  return max;
}

/** Human-readable report. */
export function formatReport(report: AnalysisReport): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const lines: string[] = [];
  lines.push(`LIME composition analysis — ${report.bars} bars`);
  lines.push(`OVERALL: ${pct(report.overall)}`);
  lines.push("");
  const dims: [string, DimensionReport][] = [
    ["Harmony", report.harmony],
    ["Rhythm", report.rhythm],
    ["Melody", report.melody],
    ["Responsiveness", report.responsiveness],
  ];
  for (const [name, dim] of dims) {
    lines.push(`${name}: ${pct(dim.score)}`);
    for (const [k, m] of Object.entries(dim.metrics)) {
      lines.push(`  - ${k.padEnd(16)} ${pct(m.score).padStart(4)}  ${m.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

import { XMLParser } from "fast-xml-parser";
import type { CorpusMeta, CorpusNote, CorpusScore } from "../ir.js";

/**
 * MusicXML → corpus IR.
 *
 * Parses `score-partwise` with document order preserved, so `<backup>` /
 * `<forward>` (used to interleave voices and staves within a measure) are
 * handled correctly. Times are normalized to {@link IR_PPQ} ticks regardless of
 * the source `<divisions>`. Grace notes and unpitched notes are skipped; chords
 * share the previous note's onset. Covers the common subset used by OpenScore /
 * PDMX exports.
 */

const IR_PPQ = 480;

const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A preserveOrder node: one tag key (its ordered children array) + optional ":@" attrs. */
type XmlNode = Record<string, unknown> & { ":@"?: Record<string, string> };

const parser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  attributeNamePrefix: "@_",
  trimValues: true,
});

// --- preserveOrder navigation helpers --------------------------------------

function tagOf(node: XmlNode): string {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return "";
}
function childrenOf(node: XmlNode): XmlNode[] {
  const t = tagOf(node);
  return (node[t] as XmlNode[]) ?? [];
}
function attr(node: XmlNode, name: string): string | undefined {
  return node[":@"]?.[`@_${name}`];
}
function firstChild(children: XmlNode[], tag: string): XmlNode | undefined {
  return children.find((c) => tag in c);
}
function hasChild(children: XmlNode[], tag: string): boolean {
  return children.some((c) => tag in c);
}
/** Inner text of the first `tag` element among `children`. */
function childText(children: XmlNode[], tag: string): string | undefined {
  const el = firstChild(children, tag);
  if (!el) return undefined;
  const inner = (el[tag] as XmlNode[]) ?? [];
  const textNode = inner.find((c) => "#text" in c);
  return textNode ? String(textNode["#text"]) : undefined;
}

function pitchToMidi(pitchChildren: XmlNode[]): number | null {
  const step = childText(pitchChildren, "step");
  if (!step || !(step in STEP_SEMITONE)) return null;
  const octave = Number(childText(pitchChildren, "octave") ?? "4");
  const alter = Number(childText(pitchChildren, "alter") ?? "0");
  return (octave + 1) * 12 + (STEP_SEMITONE[step] as number) + alter;
}

export interface ParseMusicXmlOptions {
  readonly id: string;
  readonly meta: Omit<CorpusMeta, "key">;
}

export function parseMusicXml(xml: string, options: ParseMusicXmlOptions): CorpusScore {
  const tree = parser.parse(xml) as XmlNode[];
  const scoreNode = tree.find((n) => "score-partwise" in n);
  if (!scoreNode) {
    throw new Error("parseMusicXml: not a score-partwise document (score-timewise unsupported)");
  }
  const scoreChildren = (scoreNode["score-partwise"] as XmlNode[]) ?? [];
  const partNodes = scoreChildren.filter((n) => "part" in n);

  let tempoBpm = 120;
  let tempoSet = false;
  let tsNum = 4;
  let tsDen = 4;
  let tsSet = false;
  const notes: CorpusNote[] = [];

  partNodes.forEach((partNode, partIndex) => {
    const measures = ((partNode["part"] as XmlNode[]) ?? []).filter((n) => "measure" in n);
    let divisions = IR_PPQ; // updated by <attributes><divisions>
    let cursor = 0; // ticks
    let lastStart = 0; // ticks
    const toTicks = (divs: number) => Math.round((divs * IR_PPQ) / divisions);

    for (const measureNode of measures) {
      const items = (measureNode["measure"] as XmlNode[]) ?? [];
      for (const item of items) {
        const tag = tagOf(item);
        const kids = childrenOf(item);

        if (tag === "attributes") {
          const d = childText(kids, "divisions");
          if (d) divisions = Number(d) || divisions;
          if (!tsSet) {
            const timeEl = firstChild(kids, "time");
            if (timeEl) {
              const tc = (timeEl["time"] as XmlNode[]) ?? [];
              const b = childText(tc, "beats");
              const bt = childText(tc, "beat-type");
              if (b && bt) {
                tsNum = Number(b);
                tsDen = Number(bt);
                tsSet = true;
              }
            }
          }
        } else if (tag === "note") {
          const isGrace = hasChild(kids, "grace");
          if (isGrace) continue; // grace notes carry no timing
          const isChord = hasChild(kids, "chord");
          const isRest = hasChild(kids, "rest");
          const durDivs = Number(childText(kids, "duration") ?? "0");
          const durTicks = toTicks(durDivs);
          const start = isChord ? lastStart : cursor;

          if (!isRest) {
            const pitchEl = firstChild(kids, "pitch");
            if (pitchEl) {
              const midi = pitchToMidi((pitchEl["pitch"] as XmlNode[]) ?? []);
              if (midi !== null && midi >= 0 && midi <= 127) {
                notes.push({
                  start,
                  duration: Math.max(1, durTicks),
                  pitch: midi,
                  velocity: 0.7,
                  track: partIndex,
                });
              }
            }
          }
          if (!isChord) {
            lastStart = start;
            cursor = start + durTicks;
          }
        } else if (tag === "backup") {
          cursor -= toTicks(Number(childText(kids, "duration") ?? "0"));
          if (cursor < 0) cursor = 0;
        } else if (tag === "forward") {
          cursor += toTicks(Number(childText(kids, "duration") ?? "0"));
        } else if (tag === "direction" && !tempoSet) {
          const sound = findSound(kids);
          if (sound) {
            const t = attr(sound, "tempo");
            if (t) {
              tempoBpm = Number(t) || tempoBpm;
              tempoSet = true;
            }
          }
        }
      }
    }
  });

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);

  return {
    id: options.id,
    ppq: IR_PPQ,
    tempoBpm,
    timeSignature: { numerator: tsNum, denominator: tsDen },
    notes,
    meta: options.meta,
  };
}

/** Find a `<sound tempo>` element nested under a `<direction>`. */
function findSound(children: XmlNode[]): XmlNode | undefined {
  const direct = firstChild(children, "sound");
  if (direct) return direct;
  for (const c of children) {
    if ("direction-type" in c) {
      const nested = firstChild(childrenOf(c), "sound");
      if (nested) return nested;
    }
  }
  return undefined;
}

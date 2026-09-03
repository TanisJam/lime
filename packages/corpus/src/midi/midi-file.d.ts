declare module "midi-file" {
  export interface MidiHeader {
    format: number;
    numTracks: number;
    ticksPerBeat?: number;
  }
  export interface MidiEvent {
    deltaTime: number;
    type: string;
    channel?: number;
    noteNumber?: number;
    velocity?: number;
    microsecondsPerBeat?: number;
    numerator?: number;
    denominator?: number;
    programNumber?: number;
    [key: string]: unknown;
  }
  export interface MidiData {
    header: MidiHeader;
    tracks: MidiEvent[][];
  }
  export function parseMidi(data: Uint8Array | number[]): MidiData;
  export function writeMidi(data: MidiData): number[];
}

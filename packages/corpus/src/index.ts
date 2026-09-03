// @lime/corpus — Node-only tooling to ingest free scores/MIDI, extract style
// statistics, and compile StylePacks. Never bundled to the browser; ships
// derived statistics, never corpus files.

export * from "./ir.js";
export * from "./midi/parseMidi.js";
export * from "./musicxml/parseMusicXml.js";
export * from "./musicxml/loadMusicXml.js";
export * from "./score/parseScore.js";
export * from "./analysis/keyDetection.js";
export * from "./analysis/chordify.js";
export * from "./analysis/harmonyStats.js";
export * from "./analysis/melodyStats.js";
export * from "./analysis/rhythmStats.js";
export * from "./analysis/emotionEstimate.js";
export * from "./style/emotionMapping.js";
export * from "./style/compileStylePack.js";
export * from "./build/mergeBuckets.js";
export * from "./catalog/sources.js";

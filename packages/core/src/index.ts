// LIME core — pure TypeScript continuous adaptive composer.
// No audio dependencies live here.

// Foundation
export * from "./random/SeededRandom.js";
export * from "./time/MusicalTime.js";
export * from "./events/MusicalEvent.js";
export * from "./state/MusicalState.js";
export * from "./state/StateManager.js";

// Harmony
export * from "./harmony/Scale.js";
export * from "./harmony/Chord.js";
export * from "./harmony/Voicing.js";
export * from "./harmony/Registers.js";
export * from "./harmony/HarmonyRules.js";
export * from "./harmony/HarmonyPlanner.js";

// Phrase / motif / memory
export * from "./phrase/PhrasePlanner.js";
export * from "./phrase/PhrasePlan.js";
export * from "./motif/Motif.js";
export * from "./motif/MotifGenerator.js";
export * from "./motif/MotifTransformer.js";
export * from "./memory/ComposerMemory.js";

// Voices
export * from "./pad/PadGenerator.js";
export * from "./bass/BassGenerator.js";
export * from "./melody/MelodyGenerator.js";
export * from "./percussion/PercussionGenerator.js";

// Orchestration / scheduling / engine
export * from "./orchestration/BarContext.js";
export * from "./orchestration/Orchestrator.js";
export * from "./scheduler/CompositionScheduler.js";
export * from "./style/StylePack.js";
export * from "./engine/MusicRenderer.js";
export * from "./engine/LimeEngine.js";
export * from "./debug/DebugSnapshot.js";

// Analysis
export * from "./analysis/types.js";
export * from "./analysis/analyze.js";

// Reference / listening baseline
export * from "./reference/showcase.js";

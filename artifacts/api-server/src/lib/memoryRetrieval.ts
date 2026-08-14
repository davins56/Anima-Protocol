/**
 * Smart Memory Retrieval
 *
 * Re-exports the hybrid heuristic + embedding scorer from `@workspace/llm`
 * so promptBuilder and tests keep a stable local import path.
 */

export {
  buildMemorySummaryBlock,
  classifyFact,
  compressMemoriesForContext,
  formatMemoriesForPrompt,
  retrieveRelevantMemories,
  type CompanionMemoryRecord,
  type MemoryFact,
  type MemoryType,
  type ScoredMemory,
} from "@workspace/llm";

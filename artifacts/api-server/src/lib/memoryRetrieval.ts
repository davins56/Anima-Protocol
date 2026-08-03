/**
 * Smart Memory Retrieval
 *
 * Scores and ranks companion memories by relevance (recency + type match)
 * and returns the top-k for injection into the prompt context. Supports
 * memory type classification and natural-language injection formatting.
 */

export type MemoryType =
  | "factual"
  | "emotional"
  | "relational"
  | "resonance"
  | "turn"
  | "crossover_turn"
  | "unknown";

export interface MemoryFact {
  type?: string;
  text?: string;
  created_at?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface CompanionMemoryRecord {
  characterId: string;
  summary?: string | null;
  facts?: MemoryFact[] | unknown[];
  emotionalState?: Record<string, unknown> | null;
  resonanceNotes?: string | null;
  updatedAt?: Date | null;
}

export interface ScoredMemory {
  fact: MemoryFact;
  score: number;
  memoryType: MemoryType;
  characterId: string;
}

// Classification keywords per memory type
const TYPE_SIGNALS: Record<MemoryType, RegExp> = {
  factual: /\b(fact|learned|knows|told|mentioned|said|stated|revealed)\b/i,
  emotional: /\b(felt|emotion|mood|cried|laughed|angry|happy|sad|love|fear|joy|grief|warmth|comfort)\b/i,
  relational: /\b(trust|bond|relationship|closer|distant|betrayed|loyal|devoted|friend|enemy|ally)\b/i,
  resonance: /\b(resonance|attunement|spiritual|primal|sovereign|intimate|connection|depth)\b/i,
  turn: /^(User:|Companion:)/,
  crossover_turn: /crossover/i,
  unknown: /./,
};

function classifyFact(fact: MemoryFact): MemoryType {
  if (fact.type === "turn") return "turn";
  if (fact.type === "crossover_turn") return "crossover_turn";
  if (fact.type && fact.type in TYPE_SIGNALS) return fact.type as MemoryType;

  const text = fact.text || JSON.stringify(fact);
  for (const [type, pattern] of Object.entries(TYPE_SIGNALS)) {
    if (type === "unknown" || type === "turn" || type === "crossover_turn") continue;
    if (pattern.test(text)) return type as MemoryType;
  }
  return "unknown";
}

function recencyScore(createdAt: string | undefined): number {
  if (!createdAt) return 0.3;
  const age = Date.now() - new Date(createdAt).getTime();
  const hoursOld = age / (1000 * 60 * 60);
  // Exponential decay: recent = high score, old = lower but never zero
  return Math.max(0.1, Math.exp(-hoursOld / 168)); // half-life ~1 week
}

function typeRelevanceScore(
  memoryType: MemoryType,
  contextHint?: string,
): number {
  // Base importance by type
  const baseScores: Record<MemoryType, number> = {
    emotional: 0.9,
    relational: 0.85,
    resonance: 0.8,
    factual: 0.7,
    crossover_turn: 0.6,
    turn: 0.4,
    unknown: 0.3,
  };

  let score = baseScores[memoryType] ?? 0.3;

  // Boost if the context hint matches the memory type
  if (contextHint) {
    const lowerHint = contextHint.toLowerCase();
    if (memoryType === "emotional" && /feel|emotion|heart|love|sad|happy/.test(lowerHint)) {
      score += 0.15;
    }
    if (memoryType === "relational" && /trust|relationship|bond|friend/.test(lowerHint)) {
      score += 0.15;
    }
    if (memoryType === "resonance" && /resonance|connection|spiritual|primal/.test(lowerHint)) {
      score += 0.15;
    }
  }

  return Math.min(1.0, score);
}

/**
 * Scores and retrieves the top-k most relevant memories for a given context.
 */
export function retrieveRelevantMemories(
  memories: CompanionMemoryRecord[],
  opts: {
    topK?: number;
    contextHint?: string;
    preferTypes?: MemoryType[];
  } = {},
): ScoredMemory[] {
  const { topK = 12, contextHint, preferTypes } = opts;
  const scored: ScoredMemory[] = [];

  for (const memory of memories) {
    const facts = Array.isArray(memory.facts) ? memory.facts : [];
    for (const rawFact of facts) {
      const fact: MemoryFact =
        typeof rawFact === "object" && rawFact ? (rawFact as MemoryFact) : { text: String(rawFact) };
      const memoryType = classifyFact(fact);
      const recency = recencyScore(fact.created_at);
      const typeScore = typeRelevanceScore(memoryType, contextHint);

      let finalScore = recency * 0.4 + typeScore * 0.6;

      // Boost preferred types
      if (preferTypes?.includes(memoryType)) {
        finalScore += 0.1;
      }

      scored.push({
        fact,
        score: Math.min(1.0, finalScore),
        memoryType,
        characterId: memory.characterId,
      });
    }
  }

  // Sort by score descending, take top-k
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Formats retrieved memories for natural injection into the prompt.
 * Groups by type and uses organic phrasing.
 */
export function formatMemoriesForPrompt(
  memories: ScoredMemory[],
  characterNames: Map<string, string>,
): string {
  if (memories.length === 0) return "";

  const grouped: Record<string, ScoredMemory[]> = {};
  for (const mem of memories) {
    const key = mem.memoryType;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(mem);
  }

  const sections: string[] = [];

  // Emotional memories first — most impactful
  if (grouped.emotional?.length) {
    const lines = grouped.emotional
      .map((m) => `• ${truncateText(m.fact.text || "", 200)}`)
      .join("\n");
    sections.push(`EMOTIONAL MEMORIES (moments that shaped this bond):\n${lines}`);
  }

  // Relational memories
  if (grouped.relational?.length) {
    const lines = grouped.relational
      .map((m) => `• ${truncateText(m.fact.text || "", 200)}`)
      .join("\n");
    sections.push(`RELATIONSHIP HISTORY:\n${lines}`);
  }

  // Resonance memories
  if (grouped.resonance?.length) {
    const lines = grouped.resonance
      .map((m) => `• ${truncateText(m.fact.text || "", 200)}`)
      .join("\n");
    sections.push(`RESONANCE ECHOES:\n${lines}`);
  }

  // Factual memories
  if (grouped.factual?.length) {
    const lines = grouped.factual
      .map((m) => `• ${truncateText(m.fact.text || "", 180)}`)
      .join("\n");
    sections.push(`KNOWN FACTS:\n${lines}`);
  }

  // Recent turn summaries (only include a few for continuity)
  const turns = [...(grouped.turn || []), ...(grouped.crossover_turn || [])];
  if (turns.length) {
    const lines = turns
      .slice(0, 4)
      .map((m) => `• ${truncateText(m.fact.text || "", 160)}`)
      .join("\n");
    sections.push(`RECENT INTERACTION ECHOES:\n${lines}`);
  }

  // Unknown type as general memories
  if (grouped.unknown?.length) {
    const lines = grouped.unknown
      .map((m) => `• ${truncateText(m.fact.text || "", 160)}`)
      .join("\n");
    sections.push(`COMPANION MEMORY:\n${lines}`);
  }

  return sections.join("\n\n");
}

/**
 * Builds the summary/resonance header from a companion memory record.
 */
export function buildMemorySummaryBlock(
  memories: CompanionMemoryRecord[],
  characterNames: Map<string, string>,
): string {
  const blocks: string[] = [];
  for (const memory of memories) {
    const name = characterNames.get(memory.characterId) || memory.characterId;
    const parts: string[] = [];
    if (memory.summary) parts.push(`Summary: ${truncateText(memory.summary, 400)}`);
    if (memory.resonanceNotes) parts.push(`Resonance: ${truncateText(memory.resonanceNotes, 250)}`);
    if (parts.length) {
      blocks.push(`${name}:\n${parts.join("\n")}`);
    }
  }
  return blocks.length ? `LONG-TERM COMPANION MEMORY:\n${blocks.join("\n\n")}` : "";
}

function truncateText(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

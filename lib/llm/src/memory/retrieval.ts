/**
 * Hybrid memory retrieval: heuristic type/recency scoring blended with
 * optional embedding similarity. Pure functions — the api-server supplies
 * records and (optionally) precomputed embeddings.
 */

import { cosineSimilarity, hashEmbed, type EmbeddingVector } from "../embeddings";

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
  /** Optional precomputed embedding (JSON array). */
  embedding?: EmbeddingVector;
  fact_id?: string;
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
  semanticScore?: number;
  heuristicScore?: number;
}

const TYPE_SIGNALS: Record<MemoryType, RegExp> = {
  factual: /\b(fact|learned|knows|told|mentioned|said|stated|revealed)\b/i,
  emotional: /\b(felt|emotion|mood|cried|laughed|angry|happy|sad|love|fear|joy|grief|warmth|comfort)\b/i,
  relational: /\b(trust|bond|relationship|closer|distant|betrayed|loyal|devoted|friend|enemy|ally)\b/i,
  resonance: /\b(resonance|attunement|spiritual|primal|sovereign|intimate|connection|depth)\b/i,
  turn: /^(User:|Companion:)/,
  crossover_turn: /crossover/i,
  unknown: /./,
};

export function classifyFact(fact: MemoryFact): MemoryType {
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
  return Math.max(0.1, Math.exp(-hoursOld / 168));
}

function typeRelevanceScore(memoryType: MemoryType, contextHint?: string): number {
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

function heuristicScore(
  memoryType: MemoryType,
  fact: MemoryFact,
  contextHint?: string,
  preferTypes?: MemoryType[],
): number {
  const recency = recencyScore(fact.created_at);
  const typeScore = typeRelevanceScore(memoryType, contextHint);
  let finalScore = recency * 0.4 + typeScore * 0.6;
  if (preferTypes?.includes(memoryType)) finalScore += 0.1;
  return Math.min(1.0, finalScore);
}

function lexicalOverlap(query: string, text: string): number {
  const q = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  if (q.size === 0) return 0;
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 0;
  let hits = 0;
  for (const t of tokens) {
    if (q.has(t)) hits += 1;
  }
  return Math.min(1, hits / Math.max(3, q.size));
}

/**
 * Scores and retrieves the top-k most relevant memories.
 *
 * When `queryEmbedding` is provided (or can be derived from `contextHint`),
 * semantic similarity is blended with heuristic scores:
 *   final = 0.45 * heuristic + 0.55 * semantic  (when embeddings present)
 *   final = heuristic + 0.2 * lexical overlap   (fallback)
 */
export function retrieveRelevantMemories(
  memories: CompanionMemoryRecord[],
  opts: {
    topK?: number;
    contextHint?: string;
    preferTypes?: MemoryType[];
    queryEmbedding?: EmbeddingVector;
    /** Weight for semantic vs heuristic when embeddings exist (0–1). Default 0.55. */
    semanticWeight?: number;
  } = {},
): ScoredMemory[] {
  const {
    topK = 12,
    contextHint,
    preferTypes,
    semanticWeight = 0.55,
  } = opts;

  const queryEmbedding =
    opts.queryEmbedding ||
    (contextHint ? hashEmbed(contextHint) : undefined);

  const scored: ScoredMemory[] = [];

  for (const memory of memories) {
    const facts = Array.isArray(memory.facts) ? memory.facts : [];
    for (const rawFact of facts) {
      const fact: MemoryFact =
        typeof rawFact === "object" && rawFact
          ? (rawFact as MemoryFact)
          : { text: String(rawFact) };
      const memoryType = classifyFact(fact);
      const hScore = heuristicScore(memoryType, fact, contextHint, preferTypes);

      let semanticScore: number | undefined;
      let finalScore = hScore;

      const text = fact.text || "";
      if (queryEmbedding && Array.isArray(fact.embedding) && fact.embedding.length > 0) {
        semanticScore = Math.max(0, cosineSimilarity(queryEmbedding, fact.embedding));
        const w = Math.min(1, Math.max(0, semanticWeight));
        finalScore = hScore * (1 - w) + semanticScore * w;
      } else if (contextHint && text) {
        // Cheap lexical boost when no stored embedding is available.
        finalScore = Math.min(1, hScore + 0.25 * lexicalOverlap(contextHint, text));
      }

      scored.push({
        fact,
        score: Math.min(1.0, finalScore),
        memoryType,
        characterId: memory.characterId,
        semanticScore,
        heuristicScore: hScore,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

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

  if (grouped.emotional?.length) {
    const lines = grouped.emotional
      .map((m) => `• ${truncateText(m.fact.text || "", 200)}`)
      .join("\n");
    sections.push(`EMOTIONAL MEMORIES (moments that shaped this bond):\n${lines}`);
  }

  if (grouped.relational?.length) {
    const lines = grouped.relational
      .map((m) => `• ${truncateText(m.fact.text || "", 200)}`)
      .join("\n");
    sections.push(`RELATIONSHIP HISTORY:\n${lines}`);
  }

  if (grouped.resonance?.length) {
    const lines = grouped.resonance
      .map((m) => `• ${truncateText(m.fact.text || "", 200)}`)
      .join("\n");
    sections.push(`RESONANCE ECHOES:\n${lines}`);
  }

  if (grouped.factual?.length) {
    const lines = grouped.factual
      .map((m) => `• ${truncateText(m.fact.text || "", 180)}`)
      .join("\n");
    sections.push(`KNOWN FACTS:\n${lines}`);
  }

  const turns = [...(grouped.turn || []), ...(grouped.crossover_turn || [])];
  if (turns.length) {
    const lines = turns
      .slice(0, 4)
      .map((m) => `• ${truncateText(m.fact.text || "", 160)}`)
      .join("\n");
    sections.push(`RECENT INTERACTION ECHOES:\n${lines}`);
  }

  if (grouped.unknown?.length) {
    const lines = grouped.unknown
      .map((m) => `• ${truncateText(m.fact.text || "", 160)}`)
      .join("\n");
    sections.push(`COMPANION MEMORY:\n${lines}`);
  }

  void characterNames;
  return sections.join("\n\n");
}

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

/**
 * Compress a list of scored memories into a short state block the main model
 * can consume — used when a specialist summarizer is unavailable.
 */
export function compressMemoriesForContext(
  memories: ScoredMemory[],
  maxChars = 1200,
): string {
  if (memories.length === 0) return "";
  const lines: string[] = ["[Retrieved long-term memory]"];
  let used = lines[0]!.length;
  for (const m of memories) {
    const line = `- (${m.memoryType}) ${truncateText(m.fact.text || "", 160)}`;
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

function truncateText(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

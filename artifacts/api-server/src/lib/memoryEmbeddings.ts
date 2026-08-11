/**
 * Memory embedding write / search helpers.
 *
 * Stores vectors in `memory_embeddings` (JSON number[]) and merges them onto
 * companion memory facts before retrieval. Falls back to hash embeddings when
 * no remote embedding endpoint is configured.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, memoryEmbeddings } from "@workspace/db";
import {
  classifyFact,
  compressMemoriesForContext,
  embedTexts,
  hashEmbed,
  retrieveRelevantMemories,
  type CompanionMemoryRecord,
  type MemoryFact,
  type ScoredMemory,
} from "@workspace/llm";
import { createHash } from "node:crypto";

export function factIdFor(text: string, explicitId?: string): string {
  if (explicitId?.trim()) return explicitId.trim();
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 24);
}

/** Upsert embeddings for a batch of memory facts. */
export async function upsertMemoryEmbeddings(opts: {
  userId: string;
  characterId: string;
  facts: MemoryFact[];
}): Promise<number> {
  const { userId, characterId, facts } = opts;
  const texts = facts
    .map((f) => (f.text || "").trim())
    .filter(Boolean);
  if (texts.length === 0) return 0;

  const embedded = await embedTexts(texts);
  let written = 0;

  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i]!;
    const text = (fact.text || "").trim();
    if (!text) continue;
    const embedding = embedded.embeddings[i] || hashEmbed(text);
    const factId = factIdFor(text, fact.fact_id ? String(fact.fact_id) : undefined);
    const memoryType = classifyFact(fact);

    await db
      .insert(memoryEmbeddings)
      .values({
        userId,
        characterId,
        factId,
        text,
        memoryType,
        embedding,
        model: embedded.model,
        metadata: {
          source_type: fact.type || null,
          session_id: fact.session_id || null,
        },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          memoryEmbeddings.userId,
          memoryEmbeddings.characterId,
          memoryEmbeddings.factId,
        ],
        set: {
          text,
          memoryType,
          embedding,
          model: embedded.model,
          metadata: {
            source_type: fact.type || null,
            session_id: fact.session_id || null,
          },
          updatedAt: new Date(),
        },
      });
    written += 1;
  }

  return written;
}

/** Load stored embeddings for a character and attach them onto fact objects. */
export async function attachStoredEmbeddings(
  userId: string,
  memories: CompanionMemoryRecord[],
): Promise<CompanionMemoryRecord[]> {
  if (memories.length === 0) return memories;

  const characterIds = [...new Set(memories.map((m) => m.characterId).filter(Boolean))];
  if (characterIds.length === 0) return memories;

  const rows = await db
    .select()
    .from(memoryEmbeddings)
    .where(
      and(
        eq(memoryEmbeddings.userId, userId),
        inArray(memoryEmbeddings.characterId, characterIds),
      ),
    );

  const byChar = new Map<string, Map<string, number[]>>();
  for (const row of rows) {
    if (!byChar.has(row.characterId)) byChar.set(row.characterId, new Map());
    byChar.get(row.characterId)!.set(row.factId, row.embedding || []);
    // Also index by text hash for facts without fact_id
    byChar.get(row.characterId)!.set(factIdFor(row.text), row.embedding || []);
  }

  return memories.map((memory) => {
    const map = byChar.get(memory.characterId);
    if (!map) return memory;
    const facts = (Array.isArray(memory.facts) ? memory.facts : []).map((raw) => {
      const fact: MemoryFact =
        typeof raw === "object" && raw ? (raw as MemoryFact) : { text: String(raw) };
      if (Array.isArray(fact.embedding) && fact.embedding.length) return fact;
      const text = (fact.text || "").trim();
      if (!text) return fact;
      const id = factIdFor(text, fact.fact_id ? String(fact.fact_id) : undefined);
      const embedding = map.get(id);
      return embedding?.length ? { ...fact, embedding, fact_id: id } : fact;
    });
    return { ...memory, facts };
  });
}

/**
 * Lightweight retrieval step for a user turn: attach embeddings, score, and
 * return both structured scores and a compressed injection block.
 */
export async function retrieveMemoriesForTurn(opts: {
  userId: string;
  memories: CompanionMemoryRecord[];
  query: string;
  topK?: number;
}): Promise<{
  scored: ScoredMemory[];
  injection: string;
}> {
  const enriched = await attachStoredEmbeddings(opts.userId, opts.memories);
  const queryEmbedding = (await embedTexts([opts.query])).embeddings[0];
  const scored = retrieveRelevantMemories(enriched, {
    topK: opts.topK ?? 12,
    contextHint: opts.query,
    queryEmbedding,
  });
  return {
    scored,
    injection: compressMemoriesForContext(scored),
  };
}

/** Semantic search used by the `searchMemoriesSemantically` invoke stub. */
export async function searchMemoriesSemantically(opts: {
  userId: string;
  characterId?: string;
  query: string;
  topK?: number;
}): Promise<Array<{ text: string; score: number; memoryType: string; characterId: string }>> {
  const { userId, characterId, query, topK = 12 } = opts;

  const rows = characterId
    ? await db
        .select()
        .from(memoryEmbeddings)
        .where(
          and(
            eq(memoryEmbeddings.userId, userId),
            eq(memoryEmbeddings.characterId, characterId),
          ),
        )
    : await db
        .select()
        .from(memoryEmbeddings)
        .where(eq(memoryEmbeddings.userId, userId));

  if (rows.length === 0) return [];

  // Group into companion memory records for the shared scorer.
  const byChar = new Map<string, MemoryFact[]>();
  for (const row of rows) {
    const list = byChar.get(row.characterId) || [];
    list.push({
      fact_id: row.factId,
      text: row.text,
      type: row.memoryType,
      embedding: row.embedding,
    });
    byChar.set(row.characterId, list);
  }

  const memories: CompanionMemoryRecord[] = [...byChar.entries()].map(
    ([cid, facts]) => ({ characterId: cid, facts }),
  );

  const queryEmbedding = (await embedTexts([query])).embeddings[0];
  const scored = retrieveRelevantMemories(memories, {
    topK,
    contextHint: query,
    queryEmbedding,
  });

  return scored.map((s) => ({
    text: String(s.fact.text || ""),
    score: s.score,
    memoryType: s.memoryType,
    characterId: s.characterId,
  }));
}

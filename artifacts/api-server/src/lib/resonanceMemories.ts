import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { resonanceMemories } from "../db/schema";
import type { ResonanceVector } from "./resonanceState";

export type ResonanceMemoryInput = {
  userId: string;
  animaId: string;
  sessionId?: string | null;
  title: string;
  body: string;
  resonanceSnapshot: ResonanceVector;
  emotionalTone?: string;
  tags?: string[];
  intensity?: number;
};

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isMissingRelationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /relation .* does not exist/i.test(msg) ||
    /Failed query:[\s\S]*resonance_memories/i.test(msg)
  );
}

/**
 * Crystallize a high-resonance moment so it can be recalled later
 * with its full emotional/physical state vector.
 */
export async function crystallizeResonanceMemory(input: ResonanceMemoryInput) {
  try {
    const id = makeId();
    const row = {
      id,
      userId: input.userId,
      animaId: input.animaId,
      sessionId: input.sessionId ?? null,
      title: input.title,
      body: input.body,
      resonanceSnapshot: input.resonanceSnapshot,
      emotionalTone: input.emotionalTone ?? "neutral",
      tags: input.tags ?? [],
      intensity: Math.max(0, Math.min(100, input.intensity ?? 60)),
      createdAt: new Date(),
      lastRecalledAt: null as Date | null,
    };

    await db.insert(resonanceMemories).values(row);
    return row;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

/**
 * Load strongest / most recent resonance memories for prompt injection
 * or Memory Palace visualization.
 */
export async function loadResonanceMemories(params: {
  userId: string;
  animaId: string;
  limit?: number;
}) {
  try {
    const limit = Math.min(Math.max(params.limit ?? 12, 1), 50);
    const rows = await db
      .select()
      .from(resonanceMemories)
      .where(
        and(
          eq(resonanceMemories.userId, params.userId),
          eq(resonanceMemories.animaId, params.animaId),
        ),
      )
      .orderBy(desc(resonanceMemories.intensity), desc(resonanceMemories.createdAt))
      .limit(limit);

    return rows;
  } catch (err) {
    if (isMissingRelationError(err)) return [];
    throw err;
  }
}

/**
 * Mark a memory as recalled (updates lastRecalledAt for ranking).
 */
export async function markResonanceMemoryRecalled(id: string, userId: string) {
  try {
    await db
      .update(resonanceMemories)
      .set({ lastRecalledAt: new Date() })
      .where(and(eq(resonanceMemories.id, id), eq(resonanceMemories.userId, userId)));
  } catch (err) {
    if (isMissingRelationError(err)) return;
    throw err;
  }
}

/**
 * Heuristic: should we crystallize this turn?
 * High intimacy + significant shift or strong emotional language.
 */
export function shouldCrystallize(
  intimacy: number,
  lastShift?: string,
  userMessage?: string,
): boolean {
  if (intimacy < 55) return false;
  if (lastShift && /intimacy|primal|spiritual/.test(lastShift)) return true;
  if (userMessage) {
    const m = userMessage.toLowerCase();
    if (/\b(never forget|remember this|this moment|i love|soul|sacred)\b/.test(m)) return true;
  }
  return intimacy >= 80 && Math.random() < 0.18;
}

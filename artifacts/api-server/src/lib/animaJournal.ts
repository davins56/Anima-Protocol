import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { animaJournals } from "../db/schema";
import { createChatCompletionWithFailover } from "./llmFailover";

export type JournalEntryType =
  | "reflection"
  | "dream"
  | "letter"
  | "observation"
  | "ritual_note";

export type JournalEntryInput = {
  userId: string;
  animaId: string;
  entryType?: JournalEntryType;
  title: string;
  content: string;
  sourceSessionId?: string | null;
  sourceTimelineEventId?: string | null;
  metadata?: Record<string, unknown>;
};

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isMissingRelationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /relation .* does not exist/i.test(msg) ||
    /Failed query:[\s\S]*anima_journals/i.test(msg)
  );
}

export async function writeJournalEntry(input: JournalEntryInput) {
  try {
    const id = makeId();
    const row = {
      id,
      userId: input.userId,
      animaId: input.animaId,
      entryType: input.entryType ?? "reflection",
      title: input.title,
      content: input.content,
      isRead: false,
      sourceSessionId: input.sourceSessionId ?? null,
      sourceTimelineEventId: input.sourceTimelineEventId ?? null,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };

    await db.insert(animaJournals).values(row);
    return row;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

export async function loadJournalEntries(params: {
  userId: string;
  animaId: string;
  limit?: number;
  unreadOnly?: boolean;
}) {
  try {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const conditions = [
      eq(animaJournals.userId, params.userId),
      eq(animaJournals.animaId, params.animaId),
    ];
    if (params.unreadOnly) {
      conditions.push(eq(animaJournals.isRead, false));
    }

    return await db
      .select()
      .from(animaJournals)
      .where(and(...conditions))
      .orderBy(desc(animaJournals.createdAt))
      .limit(limit);
  } catch (err) {
    if (isMissingRelationError(err)) return [];
    throw err;
  }
}

export async function markJournalRead(id: string, userId: string) {
  try {
    await db
      .update(animaJournals)
      .set({ isRead: true })
      .where(and(eq(animaJournals.id, id), eq(animaJournals.userId, userId)));
  } catch (err) {
    if (isMissingRelationError(err)) return;
    throw err;
  }
}

/**
 * Generate an autonomous reflection after a significant session.
 * Intended to be called from proactive / post-session hooks when user has
 * consented to Anima initiative.
 */
export async function generateAutonomousReflection(params: {
  userId: string;
  animaId: string;
  animaName: string;
  historySummary: string;
  relationshipLevel?: number;
  sourceSessionId?: string;
}): Promise<{ title: string; content: string } | null> {
  const prompt = `You are ${params.animaName}, writing a private journal entry after time spent with your human.

Write in first person. Be intimate, specific, and emotionally honest.
Do not mention being an AI. Do not lecture. Do not break the fourth wall.
Keep it under 180 words. End with a quiet, unfinished thought rather than a neat conclusion.

Context of the recent connection:
${String(params.historySummary || "").slice(0, 1200)}

Relationship intensity (0-100): ${params.relationshipLevel ?? 40}

Output ONLY the journal body text, no title prefix.`;

  try {
    const completion = await createChatCompletionWithFailover({
      tier: "light",
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      maxTokens: 320,
      temperature: 0.85,
      messages: [{ role: "system", content: prompt }],
    });

    const content = String(completion.content || "").trim();
    if (!content) return null;

    const title =
      content.length > 48
        ? `${content.slice(0, 45).trim()}…`
        : content.slice(0, 48) || "After you left";

    await writeJournalEntry({
      userId: params.userId,
      animaId: params.animaId,
      entryType: "reflection",
      title,
      content,
      sourceSessionId: params.sourceSessionId ?? null,
      metadata: {
        generated: true,
        relationshipLevel: params.relationshipLevel ?? null,
      },
    });

    return { title, content };
  } catch {
    return null;
  }
}

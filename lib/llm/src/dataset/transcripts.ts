/**
 * Export chat_messages (+ companion context) into TrainingExample transcripts.
 *
 * Uses the shared pg pool from `@workspace/db` (raw SQL) so this package does
 * not pull a second drizzle-orm copy. Requires DATABASE_URL.
 */

import { getPool } from "@workspace/db";
import type { CharacterCard, TrainingExample } from "./types";

export interface ExportTranscriptOptions {
  userId?: string;
  sessionIds?: string[];
  /** Minimum messages in a session to export (default 4). */
  minTurns?: number;
  /** Max sessions to export (default 200). */
  limit?: number;
  source?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function characterFromEntity(data: Record<string, unknown>): CharacterCard {
  return {
    name: String(data.name || "Companion"),
    universe: data.universe ? String(data.universe) : undefined,
    personality: data.personality ? String(data.personality) : undefined,
    backstory: data.backstory ? String(data.backstory) : undefined,
    speakingStyle: data.speaking_style
      ? String(data.speaking_style)
      : data.speakingStyle
        ? String(data.speakingStyle)
        : undefined,
    voice: data.voice ? String(data.voice) : undefined,
    systemPrompt: data.system_prompt
      ? String(data.system_prompt)
      : data.systemPrompt
        ? String(data.systemPrompt)
        : undefined,
  };
}

function memoryLines(facts: unknown, summary?: string | null): string[] {
  const lines: string[] = [];
  if (summary?.trim()) lines.push(summary.trim());
  if (!Array.isArray(facts)) return lines;
  for (const raw of facts) {
    if (typeof raw === "string" && raw.trim()) {
      lines.push(raw.trim());
      continue;
    }
    const obj = asObject(raw);
    const text = obj.text ? String(obj.text) : "";
    if (text.trim()) lines.push(text.trim());
  }
  return lines.slice(0, 24);
}

type SessionRow = {
  id: string;
  user_id: string;
  title: string;
  mode: string;
  character_ids: unknown;
  is_crossover: boolean;
};

type MessageRow = {
  role: string;
  content: string;
  character_name: string | null;
};

/**
 * Pull multi-turn sessions from Postgres and shape them as TrainingExamples.
 */
export async function exportTranscripts(
  opts: ExportTranscriptOptions = {},
): Promise<TrainingExample[]> {
  const minTurns = opts.minTurns ?? 4;
  const limit = opts.limit ?? 200;
  const source = opts.source || "anima-chat";
  const pool = getPool();

  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.userId) {
    params.push(opts.userId);
    where.push(`user_id = $${params.length}`);
  }
  if (opts.sessionIds?.length) {
    params.push(opts.sessionIds);
    where.push(`id = ANY($${params.length}::text[])`);
  }
  params.push(limit);
  const limitParam = `$${params.length}`;

  const sessionSql = `
    SELECT id, user_id, title, mode, character_ids, is_crossover
    FROM chat_sessions
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY created_at ASC
    LIMIT ${limitParam}
  `;
  const { rows: sessions } = await pool.query<SessionRow>(sessionSql, params);

  const examples: TrainingExample[] = [];

  for (const session of sessions) {
    const { rows: messages } = await pool.query<MessageRow>(
      `SELECT role, content, character_name
       FROM chat_messages
       WHERE session_id = $1 AND user_id = $2
       ORDER BY created_at ASC`,
      [session.id, session.user_id],
    );

    const conversation = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
        name: m.character_name || undefined,
      }));

    if (conversation.length < minTurns) continue;

    const characterIds = Array.isArray(session.character_ids)
      ? session.character_ids.map(String)
      : [];
    const primaryCharacterId = characterIds[0];

    let character: CharacterCard = {
      name: messages.find((m) => m.character_name)?.character_name || "Companion",
    };

    if (primaryCharacterId) {
      const { rows: entities } = await pool.query<{ data: unknown }>(
        `SELECT data FROM user_entities
         WHERE user_id = $1
           AND entity_name = ANY($2::text[])
           AND entity_id = $3
         LIMIT 1`,
        [session.user_id, ["Character", "Anima"], primaryCharacterId],
      );
      if (entities[0]) {
        character = characterFromEntity(asObject(entities[0].data));
      }
    }

    let memory: string[] = [];
    if (primaryCharacterId) {
      const { rows: memRows } = await pool.query<{
        summary: string;
        facts: unknown;
      }>(
        `SELECT summary, facts FROM companion_memories
         WHERE user_id = $1 AND character_id = $2
         LIMIT 1`,
        [session.user_id, primaryCharacterId],
      );
      if (memRows[0]) {
        memory = memoryLines(memRows[0].facts, memRows[0].summary);
      }
    }

    examples.push({
      id: `session-${session.id}`,
      source,
      character,
      scenario: {
        id: session.id,
        label: session.title,
        mode: session.mode,
        notes: session.is_crossover ? "crossover" : undefined,
      },
      memory,
      conversation,
      tags: [
        session.mode,
        session.is_crossover ? "crossover" : "solo",
        character.name.toLowerCase().replace(/\s+/g, "-"),
      ],
      instruction:
        "Respond as the companion with multi-turn consistency, emotional continuity, and memory-aware depth.",
    });
  }

  return examples;
}

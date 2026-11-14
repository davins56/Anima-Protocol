import { and, eq, sql } from "drizzle-orm";
import { db, userEntities, CHAT_MESSAGE, CHAT_SESSION, sessionIdEq } from "@workspace/db";
import { parseJsonLoose } from "./exploreInsights";
import { logger } from "./logger";

// Session Recap (SessionRecapModal / ChapterRecap) posts only `{ session_id }`.
// The old invoke case summarised `data.messages` (never sent), so the model saw
// "No messages yet.", and it returned a bare string where the modal reads
// `result.data.summary` / `result.data.emotional_arc`, so every recap fell back
// to "A narrative journey unfolds..." and "Undefined". This module loads the
// session's real messages for the signed-in user and returns a structured recap.

export type RecapMessage = {
  role?: unknown;
  content?: unknown;
  character_name?: unknown;
};

export type SessionRecap = {
  generated: boolean;
  error?: string;
  title: string;
  summary: string;
  key_moments: string[];
  characters_involved: string[];
  emotional_arc: string;
  journal_entry: string;
  reflections: string[];
  message_count: number;
};

/** Per-message cap so one pasted wall of text cannot crowd out the session. */
export const RECAP_MESSAGE_CHARS = 600;
/** Total transcript budget sent to the model. */
export const RECAP_TRANSCRIPT_CHARS = 16_000;
/** Recap is user-started and reads a whole session; give it more than the 12s default. */
export const RECAP_LLM_TIMEOUT_MS = 45_000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Visible chat lines only: no typing placeholders, system rows or empty content. */
export function recapLines(messages: RecapMessage[]): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = text(m.role);
    const name = text(m.character_name);
    const content = text(m.content);
    if (!content || name === "__typing__") continue;
    if (role === "system") continue;
    const speaker = role === "user" ? "User" : name || "Companion";
    const body =
      content.length > RECAP_MESSAGE_CHARS
        ? `${content.slice(0, RECAP_MESSAGE_CHARS)}…`
        : content;
    lines.push(`${speaker}: ${body.replace(/\s+/g, " ")}`);
  }
  return lines;
}

/**
 * Whole-session transcript within a character budget. When it does not fit,
 * keep the opening, the ending, and evenly spaced lines from the middle, with
 * a marker where lines were left out, so the recap covers the whole arc and
 * not just the last 20 messages.
 */
export function buildRecapTranscript(
  messages: RecapMessage[],
  budget = RECAP_TRANSCRIPT_CHARS,
): string {
  const lines = recapLines(messages);
  const total = lines.reduce((n, l) => n + l.length + 1, 0);
  if (total <= budget) return lines.join("\n");

  const keep = new Set<number>();
  let used = 0;
  const take = (i: number) => {
    if (keep.has(i) || i < 0 || i >= lines.length) return false;
    if (used + lines[i].length + 1 > budget) return false;
    keep.add(i);
    used += lines[i].length + 1;
    return true;
  };
  // Opening (about a fifth of the budget).
  for (let i = 0; i < lines.length && used < budget * 0.2; i++) take(i);
  // Ending (up to about two thirds of the budget in total).
  for (let i = lines.length - 1; i >= 0 && used < budget * 0.65; i--) take(i);
  // Evenly spaced middle lines with what is left.
  const middle = lines.map((_, i) => i).filter((i) => !keep.has(i));
  if (middle.length > 0) {
    const avg = Math.max(1, Math.floor(total / lines.length));
    const slots = Math.max(1, Math.floor((budget - used) / avg));
    const step = Math.max(1, middle.length / slots);
    for (let k = 0; k < middle.length; k += step) take(middle[Math.floor(k)]);
  }

  const out: string[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (skipped) out.push(`[… ${skipped} message${skipped === 1 ? "" : "s"} omitted …]`);
      skipped = 0;
      out.push(lines[i]);
    } else {
      skipped++;
    }
  }
  if (skipped) out.push(`[… ${skipped} message${skipped === 1 ? "" : "s"} omitted …]`);
  return out.join("\n");
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, max);
}

/** Model output -> recap fields. Prose that is not JSON becomes the summary. */
export function parseRecapResponse(
  raw: string,
): Pick<
  SessionRecap,
  "title" | "summary" | "key_moments" | "characters_involved" | "emotional_arc" | "journal_entry" | "reflections"
> {
  const parsed = parseJsonLoose<Record<string, unknown> | null>(raw, null);
  const obj = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  const trimmed = text(raw);
  // Output that looks like JSON but does not parse is a broken reply, not a
  // summary; leave summary empty so the caller reports a failure.
  const looksJson = /^(```|\{|\[)/.test(trimmed);
  if (!obj) {
    return {
      title: "",
      summary: looksJson ? "" : trimmed,
      key_moments: [],
      characters_involved: [],
      emotional_arc: "",
      journal_entry: "",
      reflections: [],
    };
  }
  return {
    title: text(obj.title),
    summary: text(obj.summary),
    key_moments: stringList(obj.key_moments, 8),
    characters_involved: stringList(obj.characters_involved, 12),
    emotional_arc: text(obj.emotional_arc),
    journal_entry: text(obj.journal_entry),
    reflections: stringList(obj.reflections, 6),
  };
}

export const RECAP_SYSTEM_PROMPT = [
  "You are a narrative chronicler writing a recap of ONE chat session between a user and their companion(s).",
  "Use only what happens in the transcript. Do not invent events, names or feelings that are not there.",
  "Lines marked [… omitted …] were left out for length; do not guess what they said.",
  "Reply with ONLY a JSON object with these keys:",
  '"title": a short evocative title (max 8 words);',
  '"summary": 3-5 sentences on what actually happened in the session, start to finish;',
  '"key_moments": 3-6 short strings, the concrete turning points in order;',
  '"characters_involved": names of the people in the conversation;',
  '"emotional_arc": 2-3 sentences on how the mood moved from the opening to the end (e.g. "guarded -> playful -> tender");',
  '"journal_entry": a 2-4 sentence reflective journal entry about the session;',
  '"reflections": 0-3 short reflections or open threads to pick up next time.',
].join("\n");

export type RecapDeps = {
  loadMessages: (userId: string, sessionId: string) => Promise<RecapMessage[]>;
  complete: (system: string, user: string) => Promise<string>;
};

/**
 * Messages stored as ChatMessage rows (by seq), plus any legacy
 * ChatSession.messages blob entries not yet migrated, appended after them the
 * same way migrateSessionsMessages would (blob ids already stored as rows are
 * skipped). Read-only: the recap never runs the migration itself.
 */
export async function loadRecapMessages(
  userId: string,
  sessionId: string,
): Promise<RecapMessage[]> {
  const rows = await db
    .select({ entityId: userEntities.entityId, data: userEntities.data })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_MESSAGE),
        sessionIdEq(sessionId),
      ),
    )
    .orderBy(sql`(${userEntities.data} ->> 'seq')::numeric asc`);
  const messages = rows.map((r) => (r.data ?? {}) as RecapMessage);

  const legacy = await db
    .select({ data: userEntities.data })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_SESSION),
        eq(userEntities.entityId, sessionId),
      ),
    )
    .limit(1);
  const session = (legacy[0]?.data ?? {}) as { messages?: unknown; messages_migrated?: unknown };
  if (session.messages_migrated || !Array.isArray(session.messages)) return messages;

  const seen = new Set(rows.map((r) => String(r.entityId)));
  for (const raw of session.messages as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const msg = raw as RecapMessage & { id?: unknown };
    if (msg.id != null) {
      const id = String(msg.id);
      if (seen.has(id)) continue;
      seen.add(id);
    }
    messages.push(msg);
  }
  return messages;
}

function emptyRecap(messageCount: number, error: string): SessionRecap {
  return {
    generated: false,
    error,
    title: "",
    summary: "",
    key_moments: [],
    characters_involved: [],
    emotional_arc: "",
    journal_entry: "",
    reflections: [],
    message_count: messageCount,
  };
}

export async function generateSessionRecap(
  userId: string,
  sessionId: string,
  deps: RecapDeps,
): Promise<SessionRecap> {
  if (!sessionId) return emptyRecap(0, "No session selected.");
  const messages = await deps.loadMessages(userId, sessionId);
  const lines = recapLines(messages);
  if (lines.length === 0) {
    return emptyRecap(0, "This session has no messages to recap yet.");
  }
  const transcript = buildRecapTranscript(messages);
  let raw = "";
  try {
    raw = await deps.complete(
      RECAP_SYSTEM_PROMPT,
      `Session transcript (${lines.length} messages):\n\n${transcript}`,
    );
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), sessionId },
      "session recap model call failed",
    );
    raw = "";
  }
  const parsed = parseRecapResponse(raw);
  if (!parsed.summary) {
    return emptyRecap(
      lines.length,
      "The recap model did not answer. Please try again in a moment.",
    );
  }
  return { generated: true, ...parsed, message_count: lines.length };
}

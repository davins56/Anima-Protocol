/**
 * Rolling conversation summary. The prompt replays only the last N
 * exchanges verbatim; everything older is folded into one summary that is
 * re-written (previous summary + newly aged-out messages) every few turns.
 * Stored as an append-only memory_events note (payload.kind
 * `session_summary`, payload.through_seq) — the newest row wins.
 */
import { getPool } from "@workspace/db";
import { appendMemoryEvent } from "../memoryCore/memoryCore";
import { extractJsonPayload } from "./userFacts";

export const SESSION_SUMMARY_KIND = "session_summary";
/** Re-summarise once this many messages have aged out since the last one. */
export const SUMMARY_STEP_MESSAGES = 12;
export const SUMMARY_MAX_CHARS = 2_400;

export type SummaryMessage = { seq: number; role: "user" | "assistant"; content: string };

export type SessionSummary = { id?: string; text: string; throughSeq: number };

export type SummaryPlan = {
  /** Messages to fold in (seq > previous.throughSeq and outside the window). */
  messages: SummaryMessage[];
  throughSeq: number;
};

/**
 * Decide whether to roll the summary forward. `messages` is the recent tail
 * (ascending seq). The newest `windowMessages` stay verbatim in the prompt;
 * older ones not yet covered by `previous` are folded in once at least
 * `step` of them have accumulated.
 */
export function planSummaryRollover(args: {
  messages: SummaryMessage[];
  previous: SessionSummary | null;
  windowMessages: number;
  step?: number;
}): SummaryPlan | null {
  const step = args.step ?? SUMMARY_STEP_MESSAGES;
  const sorted = [...args.messages]
    .filter((m) => Number.isFinite(m.seq) && String(m.content || "").trim())
    .sort((a, b) => a.seq - b.seq);
  if (sorted.length <= args.windowMessages) return null;
  const aged = sorted.slice(0, sorted.length - args.windowMessages);
  const covered = args.previous?.throughSeq ?? -1;
  const fresh = aged.filter((m) => m.seq > covered);
  if (fresh.length < step) return null;
  return { messages: fresh, throughSeq: fresh[fresh.length - 1]!.seq };
}

export function buildSummaryMessages(args: {
  previous: string;
  messages: SummaryMessage[];
  userName?: string;
  companionName?: string;
}): Array<{ role: "system" | "user"; content: string }> {
  const user = String(args.userName || "").trim() || "User";
  const comp = String(args.companionName || "").trim() || "Companion";
  const transcript = args.messages
    .map((m) => `${m.role === "user" ? user : comp}: ${m.content.replace(/\s+/g, " ").slice(0, 700)}`)
    .join("\n");
  return [
    {
      role: "system",
      content:
        `You keep a running summary of a conversation between ${user} and ${comp}, written for ${comp} to read later. ` +
        "Merge the previous summary with the new messages into ONE updated summary of at most 180 words, past tense, third person. " +
        "Keep: names, facts, promises, plans, open questions, emotional turning points, running jokes, and where the scene/topic stands. " +
        "Drop greetings and filler. Never invent anything. " +
        'Reply with JSON only: {"summary":"..."}',
    },
    {
      role: "user",
      content: `Previous summary:\n${args.previous.trim() || "(none)"}\n\nNew messages:\n${transcript}`,
    },
  ];
}

export function parseSummary(raw: string): string {
  const payload = extractJsonPayload(raw);
  let text =
    payload && typeof payload === "object" && typeof (payload as { summary?: unknown }).summary === "string"
      ? String((payload as { summary: string }).summary)
      : "";
  if (!text) {
    // Some models ignore the JSON instruction; accept plain prose that is
    // not itself an attempt at JSON.
    const plain = String(raw || "").replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "").trim();
    if (plain && !/^[[{]/.test(plain)) text = plain;
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…` : text;
}

export async function loadSessionSummary(
  userId: string,
  characterId: string,
  sessionId: string,
): Promise<SessionSummary | null> {
  const { rows } = await getPool().query<{ id: string; content: string; payload: Record<string, unknown> | null }>(
    `SELECT id, content, payload FROM memory_events
      WHERE user_id = $1 AND character_id = $2 AND conversation_id = $3
        AND event_type = 'note' AND payload ->> 'kind' = $4
        AND NOT EXISTS (
          SELECT 1 FROM memory_events r
           WHERE r.event_type = 'retraction' AND r.user_id = memory_events.user_id
             AND r.payload ->> 'target_event_id' = memory_events.id::text)
      ORDER BY (payload ->> 'through_seq')::numeric DESC NULLS LAST, occurred_at DESC
      LIMIT 1`,
    [userId, characterId, sessionId, SESSION_SUMMARY_KIND],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, text: row.content, throughSeq: Number(row.payload?.through_seq ?? -1) };
}

export async function storeSessionSummary(args: {
  userId: string;
  characterId: string;
  sessionId: string;
  summary: string;
  throughSeq: number;
}): Promise<string | null> {
  if (!args.summary.trim()) return null;
  return appendMemoryEvent(
    {
      userId: args.userId,
      characterId: args.characterId,
      eventType: "note",
      content: args.summary,
      payload: { kind: SESSION_SUMMARY_KIND, through_seq: args.throughSeq, session_id: args.sessionId },
      emotionalWeight: 0.6,
      conversationId: args.sessionId,
      dedupeKey: `summary:${args.characterId}:${args.sessionId}:${args.throughSeq}`,
      source: "mind",
    },
    // Summaries are read by session, not by vector search.
    { embed: false },
  );
}

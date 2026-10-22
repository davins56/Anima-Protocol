/**
 * Resting mode (B8). When the local model / Ollama tunnel is unreachable, the
 * companion is "resting": the user's message is queued server-side
 * (append-only chat_resting_queue) and the client shows an in-character
 * state instead of an error. The hourly proactive cron (and the Worker
 * scheduled handler through runProactiveMessageBatch) calls
 * deliverRestingQueue(), which answers each queued turn once the model is
 * back and records the outcome in chat_resting_deliveries (append-only).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { chatMessages, companionMemories, db, getPool, userEntities, asObject } from "@workspace/db";
import { createChatCompletionWithFailover } from "./llmFailover";
import { localChatActivityActive } from "./localLlmPriority";
import { acquireLocalLlmBackground } from "./localLlmSlot";
import { routeModel } from "./modelRouter";
import { buildCompanionPrompt, type CharacterData } from "./promptBuilder";
import { persistCompanionMessage, type Candidate } from "./proactiveMessages";
import { logger } from "./logger";

export const RESTING_EXPIRE_HOURS = 48;
export const RESTING_MAX_ATTEMPTS = 6;
export const RESTING_BATCH = 5;

const AUTH_OR_CONFIG_CODES = new Set(["authentication_error", "model_not_found", "invalid_api_key", "insufficient_quota"]);
const RESTING_RE =
  /ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|fetch failed|socket hang up|network error|connect(ion)? (refused|reset|failed)|ollama model server is not running|ollama\s*\/api\/chat|tunnel|cloudflared|error code:? ?(1033|530|502|503|504)|\b(502|503|504|530)\b.*(bad gateway|unavailable|gateway|origin)|service unavailable|bad gateway|model (is )?(down|unavailable|offline|not loaded)/i;

function blob(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i += 1) {
    if (cur instanceof Error) parts.push(`${cur.name}: ${cur.message}`, String((cur as { code?: unknown }).code ?? ""));
    else parts.push(String(cur));
    cur = cur && typeof cur === "object" ? (cur as { cause?: unknown }).cause : null;
  }
  return parts.join(" | ");
}

/**
 * True when the failure means "the model is not reachable right now" (tunnel
 * down, Ollama stopped, 502/503/530/1033), and nothing was generated yet.
 * Auth/config/quota/safety failures are NOT resting — they stay errors.
 */
export function isModelResting(err: unknown, generatedChars = 0): boolean {
  if (generatedChars > 0 || !err) return false;
  const code = err && typeof err === "object" ? String((err as { code?: unknown }).code ?? "") : "";
  if (AUTH_OR_CONFIG_CODES.has(code)) return false;
  const status = err && typeof err === "object" ? Number((err as { status?: unknown }).status) : NaN;
  if ([502, 503, 504, 530].includes(status)) return true;
  if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) return true;
  return RESTING_RE.test(blob(err));
}

/** In-character copy for the HUD. No host, model, or tunnel detail. */
export function restingLine(name?: string | null): string {
  const who = String(name || "").trim() || "She";
  return `${who} is resting right now. Your message is safe with her — she'll answer as soon as she wakes.`;
}

export type RestingQueueInput = {
  userId: string;
  sessionId: string;
  characterId: string;
  turnId?: string | null;
  content: string;
  reason?: string;
};

/** Append one queued turn (idempotent per user+turn). Returns the queue id. */
export async function queueRestingMessage(input: RestingQueueInput): Promise<string | null> {
  const content = String(input.content || "").trim().slice(0, 8000);
  if (!input.userId || !input.sessionId || !input.characterId || !content) return null;
  const { rows } = await getPool().query<{ id: string }>(
    `WITH ins AS (
       INSERT INTO chat_resting_queue (user_id, session_id, character_id, turn_id, content, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id
     )
     SELECT id FROM ins
     UNION ALL
     SELECT id FROM chat_resting_queue WHERE user_id = $1 AND turn_id = $4 AND $4 IS NOT NULL
     LIMIT 1`,
    [input.userId, input.sessionId, input.characterId, input.turnId ?? null, content, input.reason || "model_unavailable"],
  );
  return rows[0]?.id ?? null;
}

type PendingRow = {
  id: string;
  user_id: string;
  session_id: string;
  character_id: string;
  content: string;
  created_at: Date;
  failed_attempts: string | number;
};

async function recordOutcome(queueId: string, status: "delivered" | "failed" | "expired", extra: { messageId?: string; error?: string } = {}) {
  await getPool().query(
    `INSERT INTO chat_resting_deliveries (queue_id, status, message_id, error) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [queueId, status, extra.messageId ?? null, extra.error ? extra.error.slice(0, 500) : null],
  );
}

/** Pure: what to do with a pending row. */
export function restingDisposition(row: { created_at: Date | string; failed_attempts: number | string }, now = Date.now()): "deliver" | "expire" {
  const age = now - new Date(row.created_at).getTime();
  if (age > RESTING_EXPIRE_HOURS * 3600_000) return "expire";
  if (Number(row.failed_attempts) >= RESTING_MAX_ATTEMPTS) return "expire";
  return "deliver";
}

async function loadSessionCandidate(userId: string, sessionId: string, characterId: string): Promise<Candidate | null> {
  const [characterRow] = await db
    .select()
    .from(userEntities)
    .where(and(eq(userEntities.userId, userId), inArray(userEntities.entityName, ["Character", "Anima"]), eq(userEntities.entityId, characterId)))
    .limit(1);
  if (!characterRow) return null;
  const data = asObject(characterRow.data);
  const name = String(data.name || "").trim();
  if (!name) return null;
  const newestFirst = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), eq(chatMessages.sessionId, sessionId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(24);
  return {
    sessionId,
    character: {
      ...data,
      id: String(data.id || characterId),
      name,
      ...(characterRow.entityName === "Anima" ? { _isAnima: true, universe: data.universe || "Anima" } : {}),
    } as CharacterData,
    recentMessages: newestFirst.reverse().map((m) => ({
      role: m.role,
      content: m.content,
      character_name: m.characterName || undefined,
      timestamp: m.createdAt.toISOString(),
    })),
  };
}

async function generateRestingReply(userId: string, candidate: Candidate, queued: string, signal: AbortSignal, maxTokens: number): Promise<string> {
  const [memory] = await db
    .select()
    .from(companionMemories)
    .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, String(candidate.character.id))))
    .limit(1);
  const memories = memory
    ? [{ characterId: memory.characterId, summary: memory.summary, facts: memory.facts, emotionalState: memory.emotionalState, resonanceNotes: memory.resonanceNotes, updatedAt: memory.updatedAt }]
    : [];
  const prompt = buildCompanionPrompt({
    systemPrompt:
      "You were resting and could not answer for a while. Now reply, in character, to the person's last message. " +
      "You may briefly and warmly acknowledge the delay once. Do not mention servers, models, apps or being an AI.",
    characters: [candidate.character],
    activeCharacter: candidate.character,
    memories,
    recentMessages: candidate.recentMessages,
    mode: "solo",
    content: queued,
    isCrossover: false,
  });
  const routed = routeModel(queued, { deepMode: false, conversationDepth: candidate.recentMessages.length });
  const completion = await createChatCompletionWithFailover({
    tier: "light",
    model: routed.model,
    maxTokens,
    temperature: 0.8,
    messages: [{ role: "system", content: prompt }],
    signal,
    localOnly: true,
  });
  return String(completion.content ?? "")
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .slice(0, 4000);
}

export type RestingDrainSummary = { attempted: number; delivered: number; failed: number; expired: number; stoppedEarly: boolean };

/** Cron: deliver queued replies oldest-first; stop at the first "still resting" failure. */
export async function deliverRestingQueue(limit = RESTING_BATCH): Promise<RestingDrainSummary> {
  const summary: RestingDrainSummary = { attempted: 0, delivered: 0, failed: 0, expired: 0, stoppedEarly: false };
  const { rows } = await getPool().query<PendingRow>(
    `SELECT id, user_id, session_id, character_id, content, created_at, failed_attempts
       FROM chat_resting_pending ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  for (const row of rows) {
    if (restingDisposition(row) === "expire") {
      await recordOutcome(row.id, "expired");
      summary.expired += 1;
      continue;
    }
    if (await localChatActivityActive()) {
      summary.stoppedEarly = true;
      break;
    }
    const background = await acquireLocalLlmBackground(`resting:${row.id}`, { job: "proactive" });
    if (!background) {
      summary.stoppedEarly = true;
      break;
    }
    summary.attempted += 1;
    try {
      const candidate = await loadSessionCandidate(row.user_id, row.session_id, row.character_id);
      if (!candidate) {
        await recordOutcome(row.id, "expired", { error: "companion or session missing" });
        summary.expired += 1;
        continue;
      }
      const reply = await generateRestingReply(row.user_id, candidate, row.content, background.signal, background.maxTokens(240));
      if (!reply) throw new Error("empty reply");
      await persistCompanionMessage(row.user_id, candidate, reply, { source: "resting_delivery", resting_queue_id: row.id }, { resting_reply: true });
      await recordOutcome(row.id, "delivered");
      summary.delivered += 1;
    } catch (err) {
      await recordOutcome(row.id, "failed", { error: err instanceof Error ? err.message : String(err) }).catch(() => {});
      summary.failed += 1;
      if (isModelResting(err)) {
        // Still down: later rows would fail the same way.
        summary.stoppedEarly = true;
        break;
      }
      logger.warn({ err, queueId: row.id }, "Resting delivery failed");
    } finally {
      await background.release();
    }
  }
  return summary;
}

/** Pending count for one session (HUD: "she'll answer when she wakes"). */
export async function restingPendingForSession(userId: string, sessionId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM chat_resting_pending WHERE user_id = $1 AND session_id = $2`,
    [userId, sessionId],
  );
  return Number(rows[0]?.n || 0);
}

/**
 * Reply ratings (C7): thumbs up/down per reply + an optional better version.
 * Stored append-only in reply_ratings (latest row per message wins). Exported
 * as preference pairs compatible with:
 *   - @workspace/llm dataset `PreferencePairExport` ({prompt, chosen, rejected, system})
 *   - modelTutor `lessonsToDpoJsonl` ({prompt_messages, chosen, rejected})
 * Pairs: 👎 + better version → chosen = better, rejected = her reply.
 *        👍 reply A and 👎 reply B to the same turn → chosen = A, rejected = B.
 *        👍 alone → SFT-only (chosen with no rejected).
 */
import type { PreferencePairExport } from "@workspace/llm/dataset";
import { getPool } from "@workspace/db";
import { lessonsToDpoJsonl, type LessonTurn, type ModelLesson } from "./modelTutor";

export const RATING_CONTEXT_MAX = 12;
export const RATING_REPLY_MAX = 8000;
export const RATING_BETTER_MAX = 4000;

export class RatingInputError extends Error {}

export type RatingInput = {
  session_id: string;
  message_id: string;
  turn_id: string | null;
  character_id: string | null;
  character_name: string | null;
  rating: -1 | 0 | 1;
  reply: string;
  better_reply: string | null;
  context: LessonTurn[];
};

export type RatingRow = RatingInput & { id: string; user_id: string; created_at: string };

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

export function parseRatingInput(body: unknown): RatingInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const rating = Number(b.rating);
  if (rating !== 1 && rating !== -1 && rating !== 0) throw new RatingInputError("rating must be 1, -1 or 0");
  const session_id = str(b.session_id, 200);
  const message_id = str(b.message_id, 200);
  const reply = str(b.reply, RATING_REPLY_MAX);
  if (!session_id || !message_id) throw new RatingInputError("session_id and message_id are required");
  if (!reply) throw new RatingInputError("reply is required");
  const better = str(b.better_reply, RATING_BETTER_MAX);
  const context = (Array.isArray(b.context) ? b.context : [])
    .slice(-RATING_CONTEXT_MAX)
    .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .map((t) => ({ role: t.role as "user" | "assistant", content: String(t.content).slice(0, 2000) }));
  return {
    session_id,
    message_id,
    turn_id: str(b.turn_id, 200) || null,
    character_id: str(b.character_id, 200) || null,
    character_name: str(b.character_name, 120) || null,
    rating: rating as -1 | 0 | 1,
    reply,
    // A better version only makes sense with a thumbs down and must differ.
    better_reply: rating === -1 && better && better !== reply ? better : null,
    context,
  };
}

export async function appendRating(userId: string, input: RatingInput): Promise<RatingRow> {
  const { rows } = await getPool().query<RatingRow>(
    `INSERT INTO reply_ratings (user_id, session_id, message_id, turn_id, character_id, character_name, rating, reply, better_reply, context)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING id, user_id, session_id, message_id, turn_id, character_id, character_name, rating, reply, better_reply, context, created_at`,
    [userId, input.session_id, input.message_id, input.turn_id, input.character_id, input.character_name, input.rating, input.reply, input.better_reply, JSON.stringify(input.context)],
  );
  return rows[0]!;
}

export async function latestRatings(userId: string | null, limit = 2000): Promise<RatingRow[]> {
  const { rows } = await getPool().query<RatingRow>(
    `SELECT id, user_id, session_id, message_id, turn_id, character_id, character_name, rating, reply, better_reply, context, created_at
       FROM reply_ratings_latest
      WHERE ($1::text IS NULL OR user_id = $1) AND rating <> 0
      ORDER BY created_at ASC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

export type RatingPair = { prompt_messages: LessonTurn[]; chosen: string; rejected: string | null; character_name: string | null; source: "better_version" | "thumbs_pair" | "thumbs_up" };

function promptKey(r: Pick<RatingRow, "session_id" | "turn_id" | "context">): string {
  if (r.turn_id) return `${r.session_id}|turn:${r.turn_id}`;
  const lastUser = [...(r.context || [])].reverse().find((t) => t.role === "user");
  return `${r.session_id}|ctx:${lastUser?.content || ""}`;
}

/** Pure: latest ratings → chosen/rejected pairs (see header). */
export function ratingsToPairs(rows: RatingRow[]): RatingPair[] {
  const out: RatingPair[] = [];
  const groups = new Map<string, RatingRow[]>();
  for (const r of rows) {
    if (r.rating === 0) continue;
    if (r.rating === -1 && r.better_reply) {
      out.push({ prompt_messages: r.context, chosen: r.better_reply, rejected: r.reply, character_name: r.character_name, source: "better_version" });
      continue;
    }
    const k = promptKey(r);
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  for (const list of groups.values()) {
    const ups = list.filter((r) => r.rating === 1);
    const downs = list.filter((r) => r.rating === -1);
    for (const up of ups) {
      if (downs.length) {
        for (const down of downs) {
          if (down.reply.trim() === up.reply.trim()) continue;
          out.push({ prompt_messages: up.context, chosen: up.reply, rejected: down.reply, character_name: up.character_name, source: "thumbs_pair" });
        }
      } else {
        out.push({ prompt_messages: up.context, chosen: up.reply, rejected: null, character_name: up.character_name, source: "thumbs_up" });
      }
    }
  }
  return out;
}

/** `@workspace/llm` PreferencePairExport rows (DPO/ORPO/SimPO); pairs with a rejected reply only. */
export function pairsToPreferenceExport(pairs: RatingPair[]): PreferencePairExport[] {
  return pairs
    .filter((p) => p.rejected)
    .map((p) => {
      const lastUserIdx = p.prompt_messages.map((t) => t.role).lastIndexOf("user");
      const prior = p.prompt_messages.slice(0, Math.max(0, lastUserIdx)).filter((t) => t.role === "user");
      const last = lastUserIdx >= 0 ? p.prompt_messages[lastUserIdx] : null;
      const prompt = [...prior.map((t) => `user: ${t.content}`), last ? `user: ${last.content}` : ""].filter(Boolean).join("\n");
      return {
        prompt,
        chosen: p.chosen,
        rejected: p.rejected as string,
        system: p.character_name ? `You are ${p.character_name}.` : "",
      };
    });
}

/** modelTutor-compatible DPO JSONL (same writer as /api/tutor/export?format=dpo). */
export function pairsToTutorDpoJsonl(pairs: RatingPair[]): string {
  const now = new Date().toISOString();
  const lessons = pairs.map(
    (p, i) =>
      ({
        id: `rating-${i}`,
        context: p.prompt_messages,
        chosen: p.chosen,
        rejected: p.rejected,
        note: p.source,
        session_id: null,
        message_id: null,
        part: null,
        source_brand: null,
        taught_by: "ratings",
        source: "auto",
        created_date: now,
        updated_date: now,
        status: "saved",
        attempts: 0,
        version: null,
        loss_before: null,
        loss_after: null,
        steps: null,
        after_reply: null,
        error: null,
      }) satisfies ModelLesson,
  );
  return lessonsToDpoJsonl(lessons);
}

/**
 * What the mind forgets when the user deletes one chat message.
 *
 * - The message row itself is gone, so it is never replayed in the prompt
 *   (history is read from the ChatMessage rows).
 * - A deleted USER message: the facts learned from that turn (user_fact
 *   notes with the same turn_id in this conversation) are retracted. They came
 *   from what the user said, and the user took it back.
 * - A deleted COMPANION reply: learned facts are kept. They are the user's own
 *   statements, which still stand in the user's message.
 * - Either way, a rolling summary that already covered the message
 *   (through_seq >= its seq) is retracted, so the mind falls back to an older
 *   summary and rebuilds forward without it.
 *
 * memory_events is append-only, so forgetting is a retraction event
 * (reason "message_deleted", message_id). Undo re-appends fresh copies of
 * exactly those events (the table forbids DELETE). Everything here is best effort: a missing memory table
 * must never fail the delete itself.
 */
import { getPool } from "@workspace/db";
import { USER_FACT_KIND } from "./userFacts";
import { SESSION_SUMMARY_KIND } from "./rollingSummary";

export type DeletedMessage = {
  id: string;
  role?: unknown;
  seq?: unknown;
  turnId?: string | null;
};

export const MESSAGE_DELETED_REASON = "message_deleted";

/** Memory events derived from `message` that a delete should retract. */
export async function findDerivedMemory(userId: string, sessionId: string, message: DeletedMessage): Promise<string[]> {
  const seq = Number(message.seq);
  const turnId = message.role === "user" && message.turnId ? message.turnId : null;
  if (!turnId && !Number.isFinite(seq)) return [];
  const { rows } = await getPool().query<{ id: string }>(
    `SELECT e.id FROM memory_events e
      WHERE e.user_id = $1 AND e.conversation_id = $2 AND e.event_type = 'note'
        AND (
          ($3::text IS NOT NULL AND e.payload ->> 'kind' = $4 AND e.payload ->> 'turn_id' = $3)
          OR ($5::numeric IS NOT NULL AND e.payload ->> 'kind' = $6
              AND (e.payload ->> 'through_seq')::numeric >= $5::numeric)
        )
        AND NOT EXISTS (
          SELECT 1 FROM memory_events r
           WHERE r.event_type = 'retraction' AND r.user_id = e.user_id
             AND r.payload ->> 'target_event_id' = e.id::text)`,
    [userId, sessionId, turnId, USER_FACT_KIND, Number.isFinite(seq) ? seq : null, SESSION_SUMMARY_KIND],
  );
  return rows.map((r) => r.id);
}

export async function forgetDeletedMessage(args: {
  userId: string;
  sessionId: string;
  message: DeletedMessage;
}): Promise<number> {
  const targets = await findDerivedMemory(args.userId, args.sessionId, args.message);
  if (!targets.length) return 0;
  // One retraction per derived event, copied from the target's own
  // character_id. The dedupe key matches the superseded-fact retraction, so a
  // fact is never retracted twice.
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO memory_events (user_id, character_id, conversation_id, message_id, event_type, content, payload, dedupe_key, source)
     SELECT e.user_id, e.character_id, e.conversation_id, $3, 'retraction',
            'Forgotten: the message it came from was deleted',
            jsonb_build_object('target_event_id', e.id::text, 'reason', $4::text, 'message_id', $3::text),
            'retract:' || e.id::text, 'mind'
       FROM memory_events e
      WHERE e.user_id = $1 AND e.id::text = ANY($2::text[])
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [args.userId, targets, args.message.id, MESSAGE_DELETED_REASON],
  );
  return rows.length;
}

/**
 * Undo of a delete. memory_events is append-only (a trigger forbids DELETE),
 * so the forgotten events are re-appended as fresh copies; their dedupe key
 * names the retraction they answer, so a double undo adds nothing.
 */
export async function unforgetDeletedMessage(userId: string, messageId: string): Promise<number> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO memory_events (user_id, character_id, conversation_id, message_id, event_type, content, payload,
                                emotional_weight, identity_version, embedding, embedding_model, dedupe_key, source, occurred_at)
     SELECT e.user_id, e.character_id, e.conversation_id, e.message_id, e.event_type, e.content,
            e.payload || jsonb_build_object('restored_from', e.id::text),
            e.emotional_weight, e.identity_version, e.embedding, e.embedding_model,
            'restore:' || r.id::text, e.source, e.occurred_at
       FROM memory_events r
       JOIN memory_events e ON e.user_id = r.user_id AND e.id::text = r.payload ->> 'target_event_id'
      WHERE r.user_id = $1 AND r.event_type = 'retraction'
        AND r.payload ->> 'reason' = $2 AND r.payload ->> 'message_id' = $3
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [userId, MESSAGE_DELETED_REASON, messageId],
  );
  return rows.length;
}

import { and, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "./client";
import { userEntities } from "./schema";

// Chat messages used to live as one big JSONB `messages` array on each
// ChatSession record. They now live as their own rows (entity_name
// 'ChatMessage') keyed by `session_id` and ordered by a per-session integer
// `seq`. The primitives below are the single source of truth for that storage
// model so the api-server store routes AND the one-time backfill share identical
// migration semantics (no drift).
export const CHAT_MESSAGE = "ChatMessage";
export const CHAT_SESSION = "ChatSession";

export type MsgData = Record<string, unknown>;

// A drizzle transaction handle, derived from the shared db so callers in other
// packages don't have to name drizzle's transaction type.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function asObject(m: unknown): MsgData {
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as MsgData)
    : { content: m == null ? "" : String(m) };
}

// `data ->> 'session_id' = '<id>'` — scope a ChatMessage to exactly one session.
// session_id is always a string, so this text comparison is equivalent to the
// jsonb equality used by the generic filter, and it deliberately mirrors the
// text projection of user_entities_session_seq_idx so seq-ordered message reads
// stay index-accelerated.
export function sessionIdEq(sessionId: string): SQL {
  return sql`(${userEntities.data} ->> 'session_id') = ${sessionId}`;
}

// Lazily split multiple legacy ChatSession.messages blobs into ChatMessage rows
// in batch, then clear the blobs and flag the sessions migrated.
// Runs inside the caller's transaction so it is atomic, and is idempotent.
export async function migrateSessionsMessages(
  tx: DbTransaction,
  userId: string,
  sessionIds: string[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(sessionIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  // Serialize everything that touches these sessions' message streams within
  // the transaction. Acquire locks in strict lexicographical order to prevent deadlocks.
  const sortedIds = [...uniqueIds].sort();
  for (const sid of sortedIds) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${sid}))`,
    );
  }

  const sessions = await tx
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_SESSION),
        inArray(userEntities.entityId, uniqueIds),
      ),
    );

  const unmigratedSessions = sessions.filter((s) => {
    const data = s.data as MsgData;
    return !data.messages_migrated;
  });

  if (unmigratedSessions.length === 0) return;

  const unmigratedSids = unmigratedSessions.map((s) => s.entityId);

  const existingRows = await tx
    .select({
      sid: sql<string>`(${userEntities.data} ->> 'session_id')`,
    })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_MESSAGE),
        inArray(sql`(${userEntities.data} ->> 'session_id')`, unmigratedSids),
      ),
    );

  const sessionsWithExistingMessages = new Set(
    existingRows.map((r) => String(r.sid)),
  );

  const now = new Date().toISOString();
  const toInsert: Array<{
    userId: string;
    entityName: string;
    entityId: string;
    data: MsgData;
  }> = [];

  for (const session of unmigratedSessions) {
    const sid = session.entityId;
    if (sessionsWithExistingMessages.has(sid)) continue;

    const data = session.data as MsgData;
    const blob = Array.isArray(data.messages) ? (data.messages as unknown[]) : [];
    if (blob.length > 0) {
      let i = 0;
      for (const raw of blob) {
        const msg = asObject(raw);
        const id = String(msg.id ?? makeId());
        toInsert.push({
          userId,
          entityName: CHAT_MESSAGE,
          entityId: id,
          data: {
            ...msg,
            id,
            session_id: sid,
            seq: i,
            created_date: msg.created_date ?? msg.timestamp ?? now,
            updated_date: now,
          },
        });
        i += 1;
      }
    }
  }

  if (toInsert.length > 0) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
      const chunk = toInsert.slice(i, i + CHUNK_SIZE);
      await tx.insert(userEntities).values(chunk);
    }
  }

  for (const session of unmigratedSessions) {
    const data = session.data as MsgData;
    const { messages: _omit, ...rest } = data;
    await tx
      .update(userEntities)
      .set({
        data: { ...rest, messages: [], messages_migrated: true },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_SESSION),
          eq(userEntities.entityId, session.entityId),
        ),
      );
  }
}

// Lazily split a legacy ChatSession.messages blob into ChatMessage rows the
// first time a session's messages are touched, then clear the blob and flag the
// session migrated. Delegates to migrateSessionsMessages.
export async function migrateSessionMessages(
  tx: DbTransaction,
  userId: string,
  sessionId: string,
): Promise<void> {
  return migrateSessionsMessages(tx, userId, [sessionId]);
}

export interface BackfillResult {
  scanned: number;
  migrated: number;
}

// One-time backfill: proactively migrate EVERY user's legacy ChatSession blobs
// to ChatMessage rows so metadata-only session lists stop shipping the full
// message history over the wire, without waiting for each chat to be reopened.
//
// It reuses migrateSessionMessages (same logic as the lazy on-access path) so
// backfilled sessions are byte-for-byte indistinguishable from lazily-migrated
// ones, and it is safe to run repeatedly: an already-migrated session carries
// `messages_migrated:true` and is skipped by both the scan filter and the
// migration's own short-circuit.
//
// Rows are processed in id-ordered batches with a forward-only cursor so memory
// stays bounded and a session is never re-scanned (already-migrated rows also
// drop out of the not-migrated filter), regardless of how large the table is.
export async function backfillChatMessages(
  database: typeof db = db,
  opts: { batchSize?: number } = {},
): Promise<BackfillResult> {
  const batchSize = Math.max(1, opts.batchSize ?? 200);
  let cursor = 0;
  let scanned = 0;
  let migrated = 0;

  for (;;) {
    const rows = await database
      .select({ id: userEntities.id, userId: userEntities.userId, entityId: userEntities.entityId })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.entityName, CHAT_SESSION),
          gt(userEntities.id, cursor),
          // Not yet migrated: the flag is absent or anything other than true.
          sql`(${userEntities.data} ->> 'messages_migrated') is distinct from 'true'`,
        ),
      )
      .orderBy(userEntities.id)
      .limit(batchSize);

    if (rows.length === 0) break;

    for (const row of rows) {
      cursor = row.id;
      scanned += 1;
      await database.transaction((tx) =>
        migrateSessionMessages(tx, row.userId, row.entityId),
      );
      migrated += 1;
    }
  }

  return { scanned, migrated };
}

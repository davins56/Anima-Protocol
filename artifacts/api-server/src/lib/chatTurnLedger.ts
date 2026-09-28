import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  chatTurns,
  db,
  makeId,
  withTransientDbRetry,
  type ChatTurn,
} from "@workspace/db";

export type ChatTurnStatus = "pending" | "generated" | "committed" | "failed";
export type PersistenceOwner = "server" | "client";

const TURN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/;

export function normalizeTurnId(value: unknown): string {
  const requested = String(value || "").trim();
  return TURN_ID_RE.test(requested) ? requested : `turn_${makeId()}`;
}

export function turnMessageIds(turnId: string): {
  userMessageId: string;
  assistantMessageId: string;
} {
  return {
    userMessageId: `${turnId}:user`,
    assistantMessageId: `${turnId}:assistant`,
  };
}

export function chatTurnUserContentMatches(
  existing: { userContent?: string | null },
  userContent: string,
): boolean {
  return String(existing.userContent ?? "") === String(userContent ?? "");
}

export type ChatTurnReuse = "replay" | "conflict" | "in_flight";

/**
 * How long a generating isolate may hold a turn before another isolate can
 * claim it. Heartbeats renew this while the generate is alive. A dead Worker
 * stops renewing, so the turn cannot stay pending forever.
 */
export const CHAT_TURN_LEASE_MS = 45_000;

/**
 * A pending row whose lease expired this long ago is abandoned. The chat
 * page must not keep a "..." bubble for it.
 */
export const STALE_PENDING_LEASE_MS = 3 * 60 * 1000;

export function pendingTurnLeaseIsStale(
  turn: { status?: string | null; leaseExpiresAt?: Date | string | null },
  now = Date.now(),
): boolean {
  if (turn.status !== "pending") return false;
  if (!turn.leaseExpiresAt) return false;
  const at =
    turn.leaseExpiresAt instanceof Date
      ? turn.leaseExpiresAt.getTime()
      : Date.parse(String(turn.leaseExpiresAt));
  return Number.isFinite(at) && at <= now - STALE_PENDING_LEASE_MS;
}

export type DurableTurnJoin = "replay" | "join" | "claim" | "conflict";

export function chatTurnLeaseActive(
  turn: { leaseExpiresAt?: Date | string | null },
  now = Date.now(),
): boolean {
  if (!turn.leaseExpiresAt) return false;
  const at =
    turn.leaseExpiresAt instanceof Date
      ? turn.leaseExpiresAt.getTime()
      : Date.parse(String(turn.leaseExpiresAt));
  return Number.isFinite(at) && at > now;
}

/**
 * Cross-isolate retry join. Same user text plus a live lease waits on the
 * durable row. An expired lease is claimable so a dead owner does not leave
 * the turn pending. A finished reply replays. Different text never replays.
 */
export function decideDurableTurnJoin(
  existing: Pick<ChatTurn, "status" | "assistantContent" | "userContent"> & {
    leaseExpiresAt?: Date | string | null;
  },
  userContent: string,
  now = Date.now(),
): DurableTurnJoin {
  if (!chatTurnUserContentMatches(existing, userContent)) return "conflict";
  if (
    String(existing.assistantContent || "").trim() &&
    (existing.status === "generated" || existing.status === "committed")
  ) {
    return "replay";
  }
  if (chatTurnLeaseActive(existing, now)) return "join";
  return "claim";
}

/**
 * How to treat a `turn_id` that already exists.
 *
 * Replay is only safe when this POST is the same user text (Safari / retry of
 * the same body). A colliding id with different content must not stream the
 * prior assistant reply.
 */
export function classifyChatTurnReuse(
  existing: Pick<ChatTurn, "status" | "assistantContent" | "userContent">,
  userContent: string,
): ChatTurnReuse {
  if (!chatTurnUserContentMatches(existing, userContent)) {
    return "conflict";
  }
  if (
    existing.assistantContent &&
    (existing.status === "generated" || existing.status === "committed")
  ) {
    return "replay";
  }
  return "in_flight";
}

export async function beginChatTurn(input: {
  id: string;
  sessionId: string;
  userId: string;
  userContent: string;
  persistenceOwner: PersistenceOwner;
  metadata?: Record<string, unknown>;
}): Promise<{ turn: ChatTurn; created: boolean }> {
  const ids = turnMessageIds(input.id);
  const inserted = await withTransientDbRetry(() =>
    db
      .insert(chatTurns)
      .values({
        id: input.id,
        sessionId: input.sessionId,
        userId: input.userId,
        userMessageId: ids.userMessageId,
        assistantMessageId: ids.assistantMessageId,
        persistenceOwner: input.persistenceOwner,
        status: "pending",
        userContent: input.userContent,
        metadata: input.metadata ?? {},
        updatedAt: new Date(),
      })
      .onConflictDoNothing({ target: chatTurns.id })
      .returning(),
  );
  if (inserted[0]) return { turn: inserted[0], created: true };

  const [existing] = await withTransientDbRetry(() =>
    db
      .select()
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.id, input.id),
          eq(chatTurns.userId, input.userId),
          eq(chatTurns.sessionId, input.sessionId),
        ),
      )
      .limit(1),
  );
  if (!existing) {
    throw new Error("turn_id is already in use");
  }
  return { turn: existing, created: false };
}

export async function checkpointGeneratedTurn(input: {
  id: string;
  userId: string;
  assistantContent: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await withTransientDbRetry(() =>
    db
      .update(chatTurns)
      .set({
        status: "generated",
        assistantContent: input.assistantContent,
        metadata: input.metadata ?? {},
        lastError: null,
        leaseExpiresAt: null,
        waitingUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(chatTurns.id, input.id), eq(chatTurns.userId, input.userId))),
  );
}

export async function markTurnCommitted(
  id: string,
  userId: string,
): Promise<void> {
  const now = new Date();
  await withTransientDbRetry(() =>
    db
      .update(chatTurns)
      .set({
        status: "committed",
        lastError: null,
        leaseExpiresAt: null,
        waitingUntil: null,
        committedAt: now,
        updatedAt: now,
      })
      .where(and(eq(chatTurns.id, id), eq(chatTurns.userId, userId))),
  );
}

export async function markTurnFailed(
  id: string,
  userId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withTransientDbRetry(() =>
    db
      .update(chatTurns)
      .set({
        status: "failed",
        retryCount: sql`${chatTurns.retryCount} + 1`,
        lastError: message.slice(0, 1000),
        leaseExpiresAt: null,
        waitingUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(chatTurns.id, id), eq(chatTurns.userId, userId))),
  );
}

export async function readChatTurn(
  id: string,
  userId: string,
): Promise<ChatTurn | null> {
  const [turn] = await withTransientDbRetry(() =>
    db
      .select()
      .from(chatTurns)
      .where(and(eq(chatTurns.id, id), eq(chatTurns.userId, userId)))
      .limit(1),
  );
  return turn ?? null;
}

/**
 * Newest pending or generated turn for this session, if the reply is not
 * committed yet. Abandoned pending rows (lease, or before any lease the last
 * update, older than `STALE_PENDING_LEASE_MS`) are marked failed first, so
 * reopening the chat does not show a "..." bubble for a dead generate. Both
 * steps filter in SQL, so a run of abandoned rows cannot hide a live one.
 */
export async function latestOpenChatTurn(
  userId: string,
  sessionId: string,
  now = new Date(),
): Promise<ChatTurn | null> {
  const staleBefore = new Date(now.getTime() - STALE_PENDING_LEASE_MS);
  const scope = and(eq(chatTurns.userId, userId), eq(chatTurns.sessionId, sessionId));
  await withTransientDbRetry(() =>
    db
      .update(chatTurns)
      .set({
        status: "failed",
        retryCount: sql`${chatTurns.retryCount} + 1`,
        lastError: "Companion turn lease expired",
        leaseExpiresAt: null,
        waitingUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          scope,
          eq(chatTurns.status, "pending"),
          or(
            lt(chatTurns.leaseExpiresAt, staleBefore),
            and(isNull(chatTurns.leaseExpiresAt), lt(chatTurns.updatedAt, staleBefore)),
          ),
        ),
      ),
  );
  const [turn] = await withTransientDbRetry(() =>
    db
      .select()
      .from(chatTurns)
      .where(and(scope, inArray(chatTurns.status, ["pending", "generated"])))
      .orderBy(desc(chatTurns.createdAt))
      .limit(1),
  );
  return turn ?? null;
}

/**
 * Another pending turn for this user is waiting on the model. A long-expired
 * lease does not count — that row is abandoned, not queued.
 */
export async function userHasOtherPendingChatTurn(
  userId: string,
  exceptTurnId: string,
  now = new Date(),
): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - STALE_PENDING_LEASE_MS);
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ id: chatTurns.id })
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.userId, userId),
          eq(chatTurns.status, "pending"),
          ne(chatTurns.id, exceptTurnId),
          or(isNull(chatTurns.leaseExpiresAt), gt(chatTurns.leaseExpiresAt, staleBefore)),
        ),
      )
      .limit(1),
  );
  return Boolean(row);
}

/**
 * Server-owned turns that still need their reply written, and only when they
 * are newer than the session's last committed turn.
 *
 * Client-owned turns are persisted by the browser. An older generated turn
 * must not be rewritten at the end of the transcript after a later turn
 * already committed.
 */
export async function retryableChatTurns(
  userId: string,
  sessionId: string,
  limit = 3,
): Promise<ChatTurn[]> {
  const [latestCommitted] = await withTransientDbRetry(() =>
    db
      .select({ createdAt: chatTurns.createdAt })
      .from(chatTurns)
      .where(
        and(
          eq(chatTurns.userId, userId),
          eq(chatTurns.sessionId, sessionId),
          eq(chatTurns.status, "committed"),
        ),
      )
      .orderBy(desc(chatTurns.createdAt))
      .limit(1),
  );

  const filters = [
    eq(chatTurns.userId, userId),
    eq(chatTurns.sessionId, sessionId),
    eq(chatTurns.persistenceOwner, "server"),
    or(
      eq(chatTurns.status, "generated"),
      and(
        eq(chatTurns.status, "failed"),
        sql`char_length(btrim(${chatTurns.assistantContent})) > 0`,
      ),
    ),
    lt(chatTurns.retryCount, 5),
  ];
  if (latestCommitted?.createdAt) {
    filters.push(gt(chatTurns.createdAt, latestCommitted.createdAt));
  }

  return withTransientDbRetry(() =>
    db
      .select()
      .from(chatTurns)
      .where(and(...filters))
      .orderBy(asc(chatTurns.createdAt))
      .limit(Math.max(1, Math.min(limit, 10))),
  );
}

/** Take the running lease if nobody else still holds it. */
export async function claimChatTurnLease(
  id: string,
  userId: string,
  ttlMs = CHAT_TURN_LEASE_MS,
  now = new Date(),
): Promise<boolean> {
  const expires = new Date(now.getTime() + ttlMs);
  const updated = await withTransientDbRetry(() =>
    db
      .update(chatTurns)
      .set({
        leaseExpiresAt: expires,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatTurns.id, id),
          eq(chatTurns.userId, userId),
          or(isNull(chatTurns.leaseExpiresAt), lt(chatTurns.leaseExpiresAt, now)),
        ),
      )
      .returning({ id: chatTurns.id }),
  );
  return updated.length > 0;
}

/** Extend the lease while this isolate is still generating. */
export async function renewChatTurnLease(
  id: string,
  userId: string,
  ttlMs = CHAT_TURN_LEASE_MS,
  now = new Date(),
): Promise<void> {
  const expires = new Date(now.getTime() + ttlMs);
  await withTransientDbRetry(() =>
    db
      .update(chatTurns)
      .set({
        leaseExpiresAt: expires,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatTurns.id, id),
          eq(chatTurns.userId, userId),
          eq(chatTurns.status, "pending"),
        ),
      ),
  );
}

/** A retry on any isolate is waiting for this turn's reply. */
export async function markChatTurnWaiting(
  id: string,
  userId: string,
  ttlMs: number,
  now = new Date(),
): Promise<void> {
  const until = new Date(now.getTime() + ttlMs);
  await withTransientDbRetry(() =>
    db
      .update(chatTurns)
      .set({
        waitingUntil: until,
        updatedAt: now,
      })
      .where(and(eq(chatTurns.id, id), eq(chatTurns.userId, userId))),
  );
}

export async function chatTurnHasRemoteWaiter(
  id: string,
  userId: string,
  now = new Date(),
): Promise<boolean> {
  const turn = await readChatTurn(id, userId);
  if (!turn?.waitingUntil) return false;
  return turn.waitingUntil.getTime() > now.getTime();
}

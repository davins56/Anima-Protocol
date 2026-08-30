import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { chatTurns, db, makeId, type ChatTurn } from "@workspace/db";

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

export async function beginChatTurn(input: {
  id: string;
  sessionId: string;
  userId: string;
  userContent: string;
  persistenceOwner: PersistenceOwner;
  metadata?: Record<string, unknown>;
}): Promise<{ turn: ChatTurn; created: boolean }> {
  const ids = turnMessageIds(input.id);
  const inserted = await db
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
    .returning();
  if (inserted[0]) return { turn: inserted[0], created: true };

  const [existing] = await db
    .select()
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.id, input.id),
        eq(chatTurns.userId, input.userId),
        eq(chatTurns.sessionId, input.sessionId),
      ),
    )
    .limit(1);
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
  await db
    .update(chatTurns)
    .set({
      status: "generated",
      assistantContent: input.assistantContent,
      metadata: input.metadata ?? {},
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(chatTurns.id, input.id), eq(chatTurns.userId, input.userId)));
}

export async function markTurnCommitted(
  id: string,
  userId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(chatTurns)
    .set({
      status: "committed",
      lastError: null,
      committedAt: now,
      updatedAt: now,
    })
    .where(and(eq(chatTurns.id, id), eq(chatTurns.userId, userId)));
}

export async function markTurnFailed(
  id: string,
  userId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db
    .update(chatTurns)
    .set({
      status: "failed",
      retryCount: sql`${chatTurns.retryCount} + 1`,
      lastError: message.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(and(eq(chatTurns.id, id), eq(chatTurns.userId, userId)));
}

export async function readChatTurn(
  id: string,
  userId: string,
): Promise<ChatTurn | null> {
  const [turn] = await db
    .select()
    .from(chatTurns)
    .where(and(eq(chatTurns.id, id), eq(chatTurns.userId, userId)))
    .limit(1);
  return turn ?? null;
}

export async function retryableChatTurns(
  userId: string,
  sessionId: string,
  limit = 3,
): Promise<ChatTurn[]> {
  return db
    .select()
    .from(chatTurns)
    .where(
      and(
        eq(chatTurns.userId, userId),
        eq(chatTurns.sessionId, sessionId),
        inArray(chatTurns.status, ["generated", "failed"]),
        lt(chatTurns.retryCount, 5),
      ),
    )
    .orderBy(asc(chatTurns.createdAt))
    .limit(Math.max(1, Math.min(limit, 10)));
}

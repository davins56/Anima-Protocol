/**
 * Remove the companion reply a retry or edit is replacing.
 *
 * The client trims its thread first. A late persist of the original turn
 * can insert that reply again after the trim, and the next prompt and
 * memory policy would treat it as a real turn. This retires the ledger
 * row and deletes the stored reply before the new generate reads history.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  asObject,
  chatMessages,
  chatTurns,
  companionMemories,
  db,
  memoryEmbeddings,
  sessionIdEq,
  userEntities,
  withTransientDbRetry,
} from "@workspace/db";
import { markChatTurnReplaced, readChatTurn } from "./chatTurnLedger";
import { factIdFor } from "./memoryEmbeddings";
import { factsWithoutTurn } from "./memoryPolicy";
import {
  messageSeq,
  messageTurnId,
  shouldDiscardStoredMessage,
  type ReplyAction,
} from "./replyReplacement";

type ReplyKind = ReplyAction;

function characterIdsFromMetadata(metadata: Record<string, unknown> | null | undefined): string[] {
  const ids = new Set<string>();
  const listed = metadata?.character_ids;
  if (Array.isArray(listed)) {
    for (const id of listed) {
      const value = String(id || "").trim();
      if (value) ids.add(value);
    }
  }
  const active = metadata?.active_character_id;
  if (typeof active === "string" && active.trim()) ids.add(active.trim());
  return [...ids];
}

export type ReplacedReplyPlan = {
  turnId: string;
  turnIds: string[];
  messageIds: string[];
  fromMessageId: string;
  fromSeq: number | null;
};

type SessionChatRow = {
  id: number;
  entityId: string;
  data: unknown;
};

function storedChatMessage(row: SessionChatRow): Record<string, unknown> {
  const data = asObject(row.data);
  return { ...data, id: data.id || row.entityId };
}

async function loadSessionChatRows(userId: string, sessionId: string): Promise<SessionChatRow[]> {
  return withTransientDbRetry(() =>
    db
      .select({
        id: userEntities.id,
        entityId: userEntities.entityId,
        data: userEntities.data,
      })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          sessionIdEq(sessionId),
        ),
      ),
  );
}

function addTurn(ids: string[], turnId: string, replacingTurnId: string) {
  const value = turnId.trim();
  if (!value || value === replacingTurnId || ids.includes(value)) return;
  ids.push(value);
}

/**
 * Which reply this retry or edit is retiring.
 *
 * An explicit turn id wins when it belongs to this session. Otherwise the
 * anchor message's own turn id, or a single turn shared by the listed ids.
 * Identical user text selects a turn only when exactly one non-replaced
 * turn has it. Several matches stay untouched.
 */
export async function inspectReplacedReply(input: {
  userId: string;
  sessionId: string;
  replacingTurnId: string;
  replyAction: ReplyKind;
  userContent: string;
  replacedTurnId?: string | null;
  messageIds?: string[];
  fromMessageId?: string | null;
}): Promise<ReplacedReplyPlan> {
  const messageIds = [
    ...new Set((input.messageIds || []).map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  const fromMessageId = String(input.fromMessageId || "").trim();
  const requested = String(input.replacedTurnId || "").trim();
  const rows = await loadSessionChatRows(input.userId, input.sessionId);
  const stored = rows.map((row) => ({ row, message: storedChatMessage(row) }));
  const anchor = fromMessageId
    ? stored.find((item) => String(item.message.id || "") === fromMessageId)
    : undefined;
  const fromSeq = anchor ? messageSeq(anchor.message) : null;
  const anchorTurn = anchor ? messageTurnId(anchor.message) : "";
  const turnIds: string[] = [];

  if (fromSeq != null) {
    for (const item of stored) {
      const seq = messageSeq(item.message);
      if (seq == null || seq < fromSeq) continue;
      addTurn(turnIds, messageTurnId(item.message), input.replacingTurnId);
    }
  } else if (anchorTurn) {
    addTurn(turnIds, anchorTurn, input.replacingTurnId);
  }

  let turnId = "";
  if (requested && requested !== input.replacingTurnId) {
    const turn = await readChatTurn(requested, input.userId);
    if (turn && turn.sessionId === input.sessionId) turnId = turn.id;
  }
  if (!turnId && anchorTurn && anchorTurn !== input.replacingTurnId) {
    const turn = await readChatTurn(anchorTurn, input.userId);
    if (!turn || turn.sessionId === input.sessionId) turnId = anchorTurn;
  }
  if (!turnId) {
    const listedTurns = new Set<string>();
    for (const id of messageIds) {
      const hit = stored.find((item) => String(item.message.id || "") === id);
      if (!hit) continue;
      const idTurn = messageTurnId(hit.message);
      if (idTurn && idTurn !== input.replacingTurnId) listedTurns.add(idTurn);
    }
    if (listedTurns.size === 1) turnId = [...listedTurns][0] || "";
  }
  if (!turnId && input.replyAction === "retry") {
    const needle = input.userContent.trim();
    if (needle) {
      const matches = await withTransientDbRetry(() =>
        db
          .select({ id: chatTurns.id })
          .from(chatTurns)
          .where(
            and(
              eq(chatTurns.userId, input.userId),
              eq(chatTurns.sessionId, input.sessionId),
              eq(chatTurns.userContent, needle),
              ne(chatTurns.id, input.replacingTurnId),
              sql`coalesce(${chatTurns.metadata}->>'replaced', '') <> 'true'`,
            ),
          )
          .limit(2),
      );
      if (matches.length === 1) turnId = matches[0]?.id ?? "";
    }
  }
  addTurn(turnIds, turnId, input.replacingTurnId);
  return {
    turnId,
    turnIds,
    messageIds,
    fromMessageId: anchor ? fromMessageId : "",
    fromSeq,
  };
}

export async function resolveReplacedTurnId(input: {
  userId: string;
  sessionId: string;
  replacingTurnId: string;
  replyAction: ReplyKind;
  userContent: string;
  replacedTurnId?: string | null;
  messageIds?: string[];
  fromMessageId?: string | null;
}): Promise<string> {
  const plan = await inspectReplacedReply(input);
  return plan.turnId;
}

async function forgetTurnMemories(
  userId: string,
  characterIds: string[],
  turnId: string,
): Promise<void> {
  for (const characterId of [...characterIds].sort()) {
    await withTransientDbRetry(() =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${characterId}`}))`,
        );
        const [existing] = await tx
          .select()
          .from(companionMemories)
          .where(
            and(
              eq(companionMemories.userId, userId),
              eq(companionMemories.characterId, characterId),
            ),
          )
          .limit(1);
        if (!existing) return;
        const facts = Array.isArray(existing.facts) ? existing.facts : [];
        const kept = factsWithoutTurn(facts, turnId) as Record<string, unknown>[];
        if (kept.length === facts.length) return;
        const removed = facts.filter((item) => !kept.includes(item));
        const factIds = removed
          .map((item) => {
            if (!item || typeof item !== "object") return "";
            const fact = item as { text?: unknown; fact_id?: unknown };
            const text = String(fact.text || "").trim();
            if (!text && !fact.fact_id) return "";
            return factIdFor(text, fact.fact_id ? String(fact.fact_id) : undefined);
          })
          .filter(Boolean);
        await tx
          .update(companionMemories)
          .set({ facts: kept, updatedAt: new Date() })
          .where(eq(companionMemories.id, existing.id));
        if (factIds.length > 0) {
          await tx
            .delete(memoryEmbeddings)
            .where(
              and(
                eq(memoryEmbeddings.userId, userId),
                eq(memoryEmbeddings.characterId, characterId),
                inArray(memoryEmbeddings.factId, factIds),
              ),
            );
        }
      }),
    );
  }
}

async function stripSharedTurnFact(
  userId: string,
  sessionId: string,
  turnId: string,
): Promise<void> {
  await withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(userEntities)
        .where(
          and(
            eq(userEntities.userId, userId),
            eq(userEntities.entityName, CHAT_SESSION),
            eq(userEntities.entityId, sessionId),
          ),
        )
        .limit(1);
      if (!row) return;
      const data = asObject(row.data);
      const shared = Array.isArray(data.shared_memory) ? data.shared_memory : [];
      const kept = factsWithoutTurn(shared, turnId);
      if (kept.length === shared.length) return;
      await tx
        .update(userEntities)
        .set({
          data: { ...data, shared_memory: kept },
          updatedAt: new Date(),
        })
        .where(eq(userEntities.id, row.id));
    }),
  );
}

async function deleteReplacedMessages(input: {
  userId: string;
  sessionId: string;
  turnIds: string[];
  messageIds: string[];
  fromSeq: number | null;
}): Promise<void> {
  const target = {
    turnId: input.turnIds[0] || "",
    turnIds: input.turnIds,
    messageIds: input.messageIds,
    fromSeq: input.fromSeq,
  };
  if (input.turnIds.length === 0 && input.messageIds.length === 0 && input.fromSeq == null) return;
  await withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      for (const turnId of [...input.turnIds].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chat-turn:${turnId}`}))`);
      }
      const rows = await tx
        .select({
          id: userEntities.id,
          entityId: userEntities.entityId,
          data: userEntities.data,
        })
        .from(userEntities)
        .where(
          and(
            eq(userEntities.userId, input.userId),
            eq(userEntities.entityName, CHAT_MESSAGE),
            sessionIdEq(input.sessionId),
          ),
        );
      const dropRowIds: number[] = [];
      const dropEntityIds: string[] = [];
      for (const row of rows) {
        const data = asObject(row.data);
        const stored = { ...data, id: data.id || row.entityId };
        if (!shouldDiscardStoredMessage(stored, target)) continue;
        dropRowIds.push(row.id);
        dropEntityIds.push(row.entityId);
      }
      if (dropRowIds.length > 0) {
        await tx.delete(userEntities).where(inArray(userEntities.id, dropRowIds));
      }
      for (const turnId of input.turnIds) {
        await tx
          .delete(chatMessages)
          .where(
            and(
              eq(chatMessages.userId, input.userId),
              eq(chatMessages.sessionId, input.sessionId),
              sql`(
                ${chatMessages.role} <> 'user'
                AND (
                  ${chatMessages.metadata}->>'turn_id' = ${turnId}
                  OR ${chatMessages.id} like ${`${turnId}:%`}
                )
                AND ${chatMessages.id} not like ${`${turnId}:user%`}
              )`,
            ),
          );
      }
      if (dropEntityIds.length > 0) {
        await tx
          .delete(chatMessages)
          .where(
            and(
              eq(chatMessages.userId, input.userId),
              eq(chatMessages.sessionId, input.sessionId),
              inArray(chatMessages.id, [...new Set(dropEntityIds)]),
            ),
          );
      }
    }),
  );
}

/** Remove memories already stored for a turn the user replaced. */
export async function forgetReplacedTurnMemory(turn: {
  id: string;
  userId: string;
  sessionId: string;
  metadata: unknown;
}): Promise<void> {
  const metadata =
    turn.metadata && typeof turn.metadata === "object" && !Array.isArray(turn.metadata)
      ? (turn.metadata as Record<string, unknown>)
      : {};
  const characterIds = characterIdsFromMetadata(metadata);
  if (!turn.id || characterIds.length === 0) return;
  await forgetTurnMemories(turn.userId, characterIds, turn.id);
  await stripSharedTurnFact(turn.userId, turn.sessionId, turn.id);
}

/**
 * Retire the previous reply. Safe to call once the new turn id is known
 * and this send is going to generate. Returns every turn the suffix
 * retired so the prompt can drop them even if a row delete is still catching up.
 */
export async function discardReplacedCompanionReply(input: {
  userId: string;
  sessionId: string;
  replacingTurnId: string;
  replyAction: ReplyKind;
  userContent: string;
  replacedTurnId?: string | null;
  messageIds?: string[];
  fromMessageId?: string | null;
  characterIds?: string[];
}): Promise<ReplacedReplyPlan> {
  const plan = await inspectReplacedReply(input);
  if (plan.turnIds.length === 0 && plan.messageIds.length === 0 && plan.fromSeq == null) {
    return plan;
  }
  const retired: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  for (const turnId of plan.turnIds) {
    const replaced = await markChatTurnReplaced(turnId, input.userId, input.replacingTurnId);
    retired.push({ id: turnId, metadata: replaced?.metadata ?? {} });
  }
  await deleteReplacedMessages({
    userId: input.userId,
    sessionId: input.sessionId,
    turnIds: plan.turnIds,
    messageIds: plan.messageIds,
    fromSeq: plan.fromSeq,
  });
  const fallbackCharacters = (input.characterIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  for (const turn of retired) {
    const characterIds = [
      ...new Set([...characterIdsFromMetadata(turn.metadata), ...fallbackCharacters]),
    ];
    if (characterIds.length === 0) continue;
    await forgetTurnMemories(input.userId, characterIds, turn.id);
    await stripSharedTurnFact(input.userId, input.sessionId, turn.id);
  }
  return plan;
}

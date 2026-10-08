/**
 * Remove the companion reply a retry or edit is replacing.
 *
 * The client trims its thread first. A late persist of the original turn
 * can insert that reply again after the trim, and the next prompt and
 * memory policy would treat it as a real turn. This retires the ledger
 * row and deletes the stored reply before the new generate reads history.
 */

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
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
import { shouldDiscardStoredMessage, type ReplyAction } from "./replyReplacement";

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

export async function resolveReplacedTurnId(input: {
  userId: string;
  sessionId: string;
  replacingTurnId: string;
  replyAction: ReplyKind;
  userContent: string;
  replacedTurnId?: string | null;
}): Promise<string> {
  const requested = String(input.replacedTurnId || "").trim();
  if (requested && requested !== input.replacingTurnId) {
    const turn = await readChatTurn(requested, input.userId);
    if (turn && turn.sessionId === input.sessionId) return turn.id;
  }
  if (input.replyAction !== "retry") return "";
  const needle = input.userContent.trim();
  if (!needle) return "";
  const [prior] = await withTransientDbRetry(() =>
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
      .orderBy(desc(chatTurns.createdAt))
      .limit(1),
  );
  return prior?.id ?? "";
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
  turnId: string;
  messageIds: string[];
}): Promise<void> {
  const target = { turnId: input.turnId, messageIds: input.messageIds };
  if (!input.turnId && input.messageIds.length === 0) return;
  await withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      if (input.turnId) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`chat-turn:${input.turnId}`}))`,
        );
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
      const typedIds = [...new Set([...dropEntityIds, ...input.messageIds])];
      if (input.turnId) {
        await tx
          .delete(chatMessages)
          .where(
            and(
              eq(chatMessages.userId, input.userId),
              eq(chatMessages.sessionId, input.sessionId),
              sql`(
                ${chatMessages.role} <> 'user'
                AND (
                  ${chatMessages.metadata}->>'turn_id' = ${input.turnId}
                  OR ${chatMessages.id} like ${`${input.turnId}:%`}
                )
                AND ${chatMessages.id} not like ${`${input.turnId}:user%`}
              )`,
            ),
          );
      }
      if (typedIds.length > 0) {
        await tx
          .delete(chatMessages)
          .where(
            and(
              eq(chatMessages.userId, input.userId),
              eq(chatMessages.sessionId, input.sessionId),
              inArray(chatMessages.id, typedIds),
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

export type DiscardedReply = {
  turnId: string;
  messageIds: string[];
};

/**
 * Retire the previous reply. Safe to call once the new turn id is known
 * and this send is going to generate. Returns the turn that was retired
 * so the prompt can drop it even if a row delete is still catching up.
 */
export async function discardReplacedCompanionReply(input: {
  userId: string;
  sessionId: string;
  replacingTurnId: string;
  replyAction: ReplyKind;
  userContent: string;
  replacedTurnId?: string | null;
  messageIds?: string[];
  characterIds?: string[];
}): Promise<DiscardedReply> {
  const messageIds = (input.messageIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  const turnId = await resolveReplacedTurnId({
    userId: input.userId,
    sessionId: input.sessionId,
    replacingTurnId: input.replacingTurnId,
    replyAction: input.replyAction,
    userContent: input.userContent,
    replacedTurnId: input.replacedTurnId,
  });
  if (!turnId && messageIds.length === 0) {
    return { turnId: "", messageIds };
  }
  let metadata: Record<string, unknown> = {};
  if (turnId) {
    const replaced = await markChatTurnReplaced(turnId, input.userId, input.replacingTurnId);
    metadata = replaced?.metadata ?? {};
  }
  await deleteReplacedMessages({
    userId: input.userId,
    sessionId: input.sessionId,
    turnId,
    messageIds,
  });
  const characterIds = [
    ...new Set([
      ...characterIdsFromMetadata(metadata),
      ...(input.characterIds || []).map((id) => String(id || "").trim()).filter(Boolean),
    ]),
  ];
  if (turnId && characterIds.length > 0) {
    await forgetTurnMemories(input.userId, characterIds, turnId);
    await stripSharedTurnFact(input.userId, input.sessionId, turnId);
  }
  return { turnId, messageIds };
}

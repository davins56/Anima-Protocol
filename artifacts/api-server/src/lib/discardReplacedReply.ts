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
  migrateSessionMessages,
  sessionIdEq,
  userEntities,
  withTransientDbRetry,
} from "@workspace/db";
import { markChatTurnReplacedOn, readChatTurn } from "./chatTurnLedger";
import { deferLocalLlmJob } from "./deferredLocalLlm";
import { logger } from "./logger";
import { factIdFor } from "./memoryEmbeddings";
import {
  buildUserOnlyMemoryPolicyJob,
  factsWithoutTurn,
  userTurnNeedsPolicySave,
  type TurnFactRetention,
} from "./memoryPolicy";
import {
  messageSeq,
  messageTurnId,
  replyActionOf,
  shouldDiscardStoredMessage,
  turnMetadataReplaced,
  type ReplyAction,
} from "./replyReplacement";

/** Same cap as the deferred user-fact walk. A longer chain is still replaced. */
const MAX_REPLACEMENT_HOPS = 8;

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
  replacedTurnIds?: string[];
  messageIds?: string[];
  fromMessageId?: string | null;
}): Promise<ReplacedReplyPlan> {
  const messageIds = [
    ...new Set((input.messageIds || []).map((id) => String(id || "").trim()).filter(Boolean)),
  ];
  const fromMessageId = String(input.fromMessageId || "").trim();
  const requested = String(input.replacedTurnId || "").trim();
  // Legacy sessions still keep the thread on the ChatSession blob. Migrate
  // it first so the anchor seq and the suffix are rows this delete can see.
  // A later history read must not copy the old reply back after we remove it.
  await withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      await migrateSessionMessages(tx, input.userId, input.sessionId);
    }),
  );
  const rows = await loadSessionChatRows(input.userId, input.sessionId);
  const stored = rows.map((row) => ({ row, message: storedChatMessage(row) }));
  const anchor = fromMessageId
    ? stored.find((item) => String(item.message.id || "") === fromMessageId)
    : undefined;
  const fromSeq = anchor ? messageSeq(anchor.message) : null;
  const anchorTurn = anchor ? messageTurnId(anchor.message) : "";
  const turnIds: string[] = [];
  const replacedIds = [
    ...new Set(
      (input.replacedTurnIds || [])
        .map((id) => String(id || "").trim())
        .filter((id) => id && id !== input.replacingTurnId),
    ),
  ];
  if (replacedIds.length > 0) {
    const turns = await withTransientDbRetry(() =>
      db
        .select({ id: chatTurns.id })
        .from(chatTurns)
        .where(
          and(
            eq(chatTurns.userId, input.userId),
            eq(chatTurns.sessionId, input.sessionId),
            inArray(chatTurns.id, replacedIds),
          ),
        ),
    );
    const found = new Set(turns.map((turn) => turn.id));
    for (const id of replacedIds) {
      if (found.has(id)) addTurn(turnIds, id, input.replacingTurnId);
    }
  }

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
    fromMessageId,
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
  replacedTurnIds?: string[];
  messageIds?: string[];
  fromMessageId?: string | null;
}): Promise<string> {
  const plan = await inspectReplacedReply(input);
  return plan.turnId;
}

function embeddingIdOf(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const fact = item as { text?: unknown; fact_id?: unknown; source_text?: unknown };
  const explicit = fact.fact_id ? String(fact.fact_id).trim() : "";
  const text = String(fact.text || fact.source_text || "").trim();
  if (!text && !explicit) return "";
  return factIdFor(text, explicit || undefined);
}

function embeddingIdsDropped(before: unknown[], after: unknown[]): string[] {
  const kept = new Set(after.map(embeddingIdOf).filter(Boolean));
  const dropped: string[] = [];
  for (const item of before) {
    const id = embeddingIdOf(item);
    if (!id || kept.has(id) || dropped.includes(id)) continue;
    dropped.push(id);
  }
  return dropped;
}

function companionNameFromMetadata(metadata: Record<string, unknown>): string {
  return typeof metadata.active_character_name === "string"
    ? metadata.active_character_name.trim()
    : "";
}

function activeCharacterId(metadata: Record<string, unknown>, characterIds: string[]): string {
  const requested =
    typeof metadata.active_character_id === "string" ? metadata.active_character_id.trim() : "";
  if (requested && characterIds.includes(requested)) return requested;
  return characterIds[0] || requested;
}

function asMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return metadata as Record<string, unknown>;
}

/**
 * Newest turn that should receive facts from a Retry.
 * Starts at the successor this cleanup was given. Follows later retries.
 * An edit, a broken link, or a chain that is still replaced after the hop
 * cap returns "" so this pass does not retag onto a dead turn.
 */
async function liveRetrySuccessor(startId: string, userId: string): Promise<string> {
  let current = startId.trim();
  if (!current) return "";
  for (let hop = 0; hop < MAX_REPLACEMENT_HOPS; hop += 1) {
    const turn = await readChatTurn(current, userId);
    if (!turn || !turnMetadataReplaced(turn.metadata)) return current;
    const next = String(asMetadata(turn.metadata).superseded_by || "").trim();
    if (!next || next === current) return "";
    const successor = await readChatTurn(next, userId);
    if (!successor || replyActionOf(asMetadata(successor.metadata).reply_action) !== "retry") {
      return "";
    }
    current = next;
  }
  const landed = await readChatTurn(current, userId);
  if (!landed || turnMetadataReplaced(landed.metadata)) return "";
  return current;
}

async function rewriteCharacterFacts(
  userId: string,
  characterId: string,
  turnId: string,
  retention: TurnFactRetention,
): Promise<unknown[]> {
  let keptFacts: unknown[] = [];
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
      const kept = factsWithoutTurn(facts, turnId, retention) as Record<string, unknown>[];
      keptFacts = kept;
      if (JSON.stringify(kept) === JSON.stringify(facts)) return;
      const factIds = embeddingIdsDropped(facts, kept);
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
  return keptFacts;
}

async function forgetTurnMemories(
  userId: string,
  characterIds: string[],
  turnId: string,
  retention: TurnFactRetention,
): Promise<Map<string, unknown[]>> {
  const keptByCharacter = new Map<string, unknown[]>();
  for (const characterId of [...characterIds].sort()) {
    keptByCharacter.set(
      characterId,
      await rewriteCharacterFacts(userId, characterId, turnId, retention),
    );
  }
  return keptByCharacter;
}

async function stripSharedTurnFact(
  userId: string,
  sessionId: string,
  turnId: string,
  retention: TurnFactRetention,
): Promise<void> {
  await withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${sessionId}))`,
      );
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
      const kept = factsWithoutTurn(shared, turnId, retention);
      // A retry can retag a fact without changing the array length.
      if (JSON.stringify(kept) === JSON.stringify(shared)) return;
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
  replacingTurnId: string;
  turnIds: string[];
  messageIds: string[];
  fromSeq: number | null;
  beforeDelete?: () => Promise<void>;
}): Promise<Array<{ id: string; metadata: Record<string, unknown> }>> {
  const target = {
    turnId: input.turnIds[0] || "",
    turnIds: input.turnIds,
    messageIds: input.messageIds,
    fromSeq: input.fromSeq,
  };
  if (input.turnIds.length === 0 && input.messageIds.length === 0 && input.fromSeq == null) {
    return [];
  }
  return withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      // Session lock first, then turn locks. The same order as append and
      // replace, so this delete cannot deadlock with a message write.
      await migrateSessionMessages(tx, input.userId, input.sessionId);
      const retired: Array<{ id: string; metadata: Record<string, unknown> }> = [];
      for (const turnId of [...input.turnIds].sort()) {
        const replaced = await markChatTurnReplacedOn(
          tx,
          turnId,
          input.userId,
          input.replacingTurnId,
        );
        retired.push({ id: turnId, metadata: replaced?.metadata ?? {} });
      }
      if (input.beforeDelete) await input.beforeDelete();
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
                  OR strpos(${chatMessages.id}, ${`${turnId}:`}) = 1
                )
                AND strpos(${chatMessages.id}, ${`${turnId}:user`}) <> 1
              )`,
            ),
          );
      }
      const typedIds = [
        ...new Set([
          ...dropEntityIds,
          ...(input.fromSeq == null ? input.messageIds : []),
        ]),
      ];
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
      return retired;
    }),
  );
}

async function retainReplacedTurnMemory(input: {
  userId: string;
  sessionId: string;
  turnId: string;
  characterIds: string[];
  metadata: Record<string, unknown>;
  replyAction: ReplyAction;
  userContent: string;
  replacingTurnId: string;
}): Promise<void> {
  const characterIds = [...input.characterIds];
  const requestedActive =
    typeof input.metadata.active_character_id === "string"
      ? input.metadata.active_character_id.trim()
      : "";
  if (requestedActive && !characterIds.includes(requestedActive)) characterIds.push(requestedActive);
  if (!input.turnId) return;
  let replacingTurnId = input.replacingTurnId.trim();
  if (input.replyAction === "retry" && replacingTurnId) {
    // A newer retry may already have replaced this successor. Retag to the
    // live turn, not the one this cleanup was originally handed.
    replacingTurnId = await liveRetrySuccessor(replacingTurnId, input.userId);
  }
  const retention: TurnFactRetention = {
    replyAction: input.replyAction,
    userContent: input.userContent,
    companionName: companionNameFromMetadata(input.metadata),
    replacingTurnId,
  };
  const keptByCharacter =
    characterIds.length > 0
      ? await forgetTurnMemories(input.userId, characterIds, input.turnId, retention)
      : new Map<string, unknown[]>();
  await stripSharedTurnFact(input.userId, input.sessionId, input.turnId, retention);
  if (input.replyAction !== "retry" || !replacingTurnId) return;
  const activeId = activeCharacterId(input.metadata, characterIds);
  if (!activeId) return;
  const facts = keptByCharacter.get(activeId) ?? [];
  if (!userTurnNeedsPolicySave(facts, input.userContent, retention.companionName || "")) return;
  const job = buildUserOnlyMemoryPolicyJob({
    userId: input.userId,
    characterId: activeId,
    sessionId: input.sessionId,
    turnId: replacingTurnId,
    companionName: retention.companionName || "",
    userContent: input.userContent,
  });
  if (!job) return;
  try {
    await deferLocalLlmJob(job);
  } catch (error) {
    logger.warn({ error, turnId: replacingTurnId }, "Could not queue user memory after retry");
  }
}

/**
 * Remove what a replaced turn stored, after the reply is already gone.
 * This is the late second pass. It runs only when the successor's reply
 * action can be read. A missing row or a failed read skips the pass: guessing
 * edit would delete his facts on a retry.
 */
export async function forgetReplacedTurnMemory(turn: {
  id: string;
  userId: string;
  sessionId: string;
  metadata: unknown;
  userContent?: string;
}): Promise<void> {
  const metadata = asMetadata(turn.metadata);
  const replacingTurnId =
    typeof metadata.superseded_by === "string" ? metadata.superseded_by.trim() : "";
  if (!replacingTurnId) return;
  const next = await readChatTurn(replacingTurnId, turn.userId);
  const replyAction = replyActionOf(asMetadata(next?.metadata).reply_action);
  if (!replyAction) return;
  const stored = turn.userContent ?? (await readChatTurn(turn.id, turn.userId))?.userContent ?? "";
  await retainReplacedTurnMemory({
    userId: turn.userId,
    sessionId: turn.sessionId,
    turnId: turn.id,
    characterIds: characterIdsFromMetadata(metadata),
    metadata,
    replyAction,
    userContent: stored,
    replacingTurnId,
  });
}

/**
 * Retire the previous reply. Safe to call once the new turn id is known
 * and this send is going to generate. Returns every turn the suffix
 * retired. The mark and the row delete commit together, so a failed delete
 * leaves the old reply usable.
 */
export async function discardReplacedCompanionReply(
  input: {
    userId: string;
    sessionId: string;
    replacingTurnId: string;
    replyAction: ReplyKind;
    userContent: string;
    replacedTurnId?: string | null;
    replacedTurnIds?: string[];
    messageIds?: string[];
    fromMessageId?: string | null;
    characterIds?: string[];
  },
  hooks?: {
    forgetMemory?: (userId: string, sessionId: string, turnId: string) => Promise<void>;
    plan?: ReplacedReplyPlan;
    beforeDelete?: () => Promise<void>;
  },
): Promise<ReplacedReplyPlan> {
  const plan = hooks?.plan ?? (await inspectReplacedReply(input));
  if (plan.turnIds.length === 0 && plan.messageIds.length === 0 && plan.fromSeq == null) {
    return plan;
  }
  const retired = await deleteReplacedMessages({
    userId: input.userId,
    sessionId: input.sessionId,
    replacingTurnId: input.replacingTurnId,
    turnIds: plan.turnIds,
    messageIds: plan.messageIds,
    fromSeq: plan.fromSeq,
    beforeDelete: hooks?.beforeDelete,
  });
  // Mark and delete committed together. A later memory failure must not
  // reject the send: the old reply is gone, and a 503 would leave the
  // conversation with neither that reply nor the new one.
  // The replaced flag still blocks a deferred memory job from writing it back.
  const fallbackCharacters = (input.characterIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  for (const turn of retired) {
    const characterIds = [
      ...new Set([...characterIdsFromMetadata(turn.metadata), ...fallbackCharacters]),
    ];
    try {
      if (hooks?.forgetMemory) {
        await hooks.forgetMemory(input.userId, input.sessionId, turn.id);
      } else {
        await retainReplacedTurnMemory({
          userId: input.userId,
          sessionId: input.sessionId,
          turnId: turn.id,
          characterIds,
          metadata: turn.metadata,
          replyAction: input.replyAction,
          userContent: input.userContent,
          replacingTurnId: input.replacingTurnId,
        });
      }
    } catch (error) {
      logger.warn(
        { error, turnId: turn.id, replacingTurnId: input.replacingTurnId },
        "Could not forget memory for a replaced reply; the reply is already removed",
      );
    }
  }
  return plan;
}

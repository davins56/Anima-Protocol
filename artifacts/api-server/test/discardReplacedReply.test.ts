import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  chatMessages,
  chatTurns,
  companionMemories,
  db,
  ensureSchemaOnce,
  memoryEmbeddings,
  userEntities,
} from "@workspace/db";
import { beginChatTurn, checkpointGeneratedTurn, readChatTurn } from "../src/lib/chatTurnLedger";
import {
  discardReplacedCompanionReply,
  inspectReplacedReply,
} from "../src/lib/discardReplacedReply";
import { factIdFor } from "../src/lib/memoryEmbeddings";

const prefix = `discard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userId = `${prefix}_user`;
const sessionId = `${prefix}_session`;
const characterId = `${prefix}_character`;
const oldTurnId = `turn_${prefix}_old`;
const newTurnId = `turn_${prefix}_new`;
const factText = "User: hello | Companion: the old reply";

beforeAll(async () => {
  await ensureSchemaOnce();
});

afterAll(async () => {
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.userId, userId));
  await db.delete(companionMemories).where(eq(companionMemories.userId, userId));
  await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  await db.delete(chatTurns).where(eq(chatTurns.userId, userId));
  await db.delete(userEntities).where(eq(userEntities.userId, userId));
});

describe("discardReplacedCompanionReply", () => {
  it("removes the retried reply from the thread and from memory, and keeps his line", async () => {
    await beginChatTurn({
      id: oldTurnId,
      sessionId,
      userId,
      userContent: "hello",
      persistenceOwner: "client",
      metadata: { character_ids: [characterId], active_character_id: characterId },
    });
    await checkpointGeneratedTurn({
      id: oldTurnId,
      userId,
      assistantContent: "the old reply",
      metadata: { character_ids: [characterId], active_character_id: characterId },
    });
    await db.insert(userEntities).values([
      {
        userId,
        entityName: CHAT_SESSION,
        entityId: sessionId,
        data: {
          id: sessionId,
          shared_memory: [
            { turn_id: oldTurnId, text: "old shared", type: "crossover_turn" },
            { turn_id: "turn_keep", text: "still true", type: "crossover_turn" },
          ],
        },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `${oldTurnId}:user`,
        data: {
          id: `${oldTurnId}:user`,
          session_id: sessionId,
          role: "user",
          content: "hello",
          turn_id: oldTurnId,
        },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `${oldTurnId}:assistant`,
        data: {
          id: `${oldTurnId}:assistant`,
          session_id: sessionId,
          role: "assistant",
          content: "the old reply",
          turn_id: oldTurnId,
        },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `${oldTurnId}:assistant:1`,
        data: {
          id: `${oldTurnId}:assistant:1`,
          session_id: sessionId,
          role: "assistant",
          content: "and the other speaker",
          turn_id: oldTurnId,
        },
      },
    ]);
    await db.insert(chatMessages).values([
      {
        id: `${oldTurnId}:user`,
        sessionId,
        userId,
        role: "user",
        content: "hello",
        metadata: { turn_id: oldTurnId },
      },
      {
        id: `${oldTurnId}:assistant`,
        sessionId,
        userId,
        role: "assistant",
        content: "the old reply",
        metadata: { turn_id: oldTurnId },
      },
    ]);
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "",
      facts: [
        { type: "turn", turn_id: oldTurnId, text: factText },
        { type: "factual", text: "likes tea" },
      ],
      emotionalState: {},
      resonanceNotes: "",
    });
    await db.insert(memoryEmbeddings).values({
      userId,
      characterId,
      factId: factIdFor(factText),
      text: factText,
      memoryType: "turn",
      embedding: [0.1],
    });

    const discarded = await discardReplacedCompanionReply({
      userId,
      sessionId,
      replacingTurnId: newTurnId,
      replyAction: "retry",
      userContent: "hello",
      replacedTurnId: oldTurnId,
      characterIds: [characterId],
    });
    expect(discarded.turnId).toBe(oldTurnId);

    await checkpointGeneratedTurn({
      id: oldTurnId,
      userId,
      assistantContent: "the old reply",
      metadata: { provider: "late" },
    });
    const turn = await readChatTurn(oldTurnId, userId);
    expect(turn?.assistantContent).toBe("");
    expect(turn?.metadata).toMatchObject({ replaced: true, superseded_by: newTurnId });

    const rows = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_MESSAGE)));
    const contents = rows.map((row) => (row.data as { content?: string }).content);
    expect(contents).toEqual(["hello"]);

    const typed = await db.select().from(chatMessages).where(eq(chatMessages.userId, userId));
    expect(typed.map((row) => row.role)).toEqual(["user"]);

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.userId, userId));
    expect(memory?.facts).toEqual([{ type: "factual", text: "likes tea" }]);
    const embeddings = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.userId, userId));
    expect(embeddings).toHaveLength(0);

    const [session] = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_SESSION)));
    expect((session?.data as { shared_memory?: unknown[] }).shared_memory).toEqual([
      { turn_id: "turn_keep", text: "still true", type: "crossover_turn" },
    ]);
  });

  it("deletes the whole suffix from the anchor seq, past the forty-id list", async () => {
    const session = `${sessionId}_long`;
    const turnId = `${oldTurnId}_long`;
    await beginChatTurn({
      id: turnId,
      sessionId: session,
      userId,
      userContent: "trim me",
      persistenceOwner: "client",
    });
    const rows = [
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: "keep-user",
        data: {
          id: "keep-user",
          session_id: session,
          role: "user",
          content: "trim me",
          seq: 0,
          turn_id: turnId,
        },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: "anchor",
        data: {
          id: "anchor",
          session_id: session,
          role: "assistant",
          content: "old",
          seq: 1,
          turn_id: turnId,
        },
      },
    ];
    for (let seq = 2; seq <= 46; seq += 1) {
      rows.push({
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `extra-${seq}`,
        data: {
          id: `extra-${seq}`,
          session_id: session,
          role: seq % 2 === 0 ? "user" : "assistant",
          content: `extra ${seq}`,
          seq,
          turn_id: `${turnId}_later`,
        },
      });
    }
    await db.insert(userEntities).values(rows);
    await discardReplacedCompanionReply({
      userId,
      sessionId: session,
      replacingTurnId: `${newTurnId}_long`,
      replyAction: "edit",
      userContent: "rewritten",
      replacedTurnId: turnId,
      fromMessageId: "anchor",
      messageIds: rows.slice(1, 41).map((row) => row.entityId),
    });
    const left = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_MESSAGE)));
    const contents = left
      .map((row) => row.data as { content?: string; session_id?: string })
      .filter((data) => data.session_id === session)
      .map((data) => data.content);
    expect(contents).toEqual(["trim me"]);
  });

  it("does not retire a different turn that only shares the same text", async () => {
    const session = `${sessionId}_same`;
    const older = `${oldTurnId}_same_old`;
    const newer = `${oldTurnId}_same_new`;
    await beginChatTurn({
      id: older,
      sessionId: session,
      userId,
      userContent: "echo",
      persistenceOwner: "client",
    });
    await beginChatTurn({
      id: newer,
      sessionId: session,
      userId,
      userContent: "echo",
      persistenceOwner: "client",
    });
    await db.insert(userEntities).values([
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: "older-user",
        data: { id: "older-user", session_id: session, role: "user", content: "echo", seq: 0, turn_id: older },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: "older-assistant",
        data: {
          id: "older-assistant",
          session_id: session,
          role: "assistant",
          content: "first echo",
          seq: 1,
          turn_id: older,
        },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: "newer-user",
        data: { id: "newer-user", session_id: session, role: "user", content: "echo", seq: 2, turn_id: newer },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: "newer-assistant",
        data: {
          id: "newer-assistant",
          session_id: session,
          role: "assistant",
          content: "second echo",
          seq: 3,
          turn_id: newer,
        },
      },
    ]);
    const ambiguous = await inspectReplacedReply({
      userId,
      sessionId: session,
      replacingTurnId: `${newTurnId}_same`,
      replyAction: "retry",
      userContent: "echo",
    });
    expect(ambiguous.turnId).toBe("");

    await discardReplacedCompanionReply({
      userId,
      sessionId: session,
      replacingTurnId: `${newTurnId}_same`,
      replyAction: "retry",
      userContent: "echo",
      replacedTurnId: newer,
      fromMessageId: "newer-assistant",
      messageIds: ["newer-assistant"],
    });
    const olderTurn = await readChatTurn(older, userId);
    expect(olderTurn?.metadata).not.toMatchObject({ replaced: true });
    const left = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_MESSAGE)));
    const contents = left
      .map((row) => row.data as { content?: string; session_id?: string })
      .filter((data) => data.session_id === session)
      .map((data) => data.content);
    expect(contents).toEqual(["echo", "first echo", "echo"]);
  });

  it("keeps an embedding another fact still uses after the replaced turn is forgotten", async () => {
    const session = `${sessionId}_embed`;
    const turnId = `${oldTurnId}_embed`;
    const shared = "likes tea";
    await beginChatTurn({
      id: turnId,
      sessionId: session,
      userId,
      userContent: "tea",
      persistenceOwner: "client",
      metadata: { character_ids: [characterId] },
    });
    await db.insert(companionMemories).values({
      userId,
      characterId: `${characterId}_embed`,
      summary: "",
      facts: [
        { type: "turn", turn_id: turnId, text: shared, fact_id: "tea" },
        { type: "factual", text: shared, fact_id: "tea" },
      ],
      emotionalState: {},
      resonanceNotes: "",
    });
    await db.insert(memoryEmbeddings).values({
      userId,
      characterId: `${characterId}_embed`,
      factId: factIdFor(shared, "tea"),
      text: shared,
      memoryType: "factual",
      embedding: [0.2],
    });
    await discardReplacedCompanionReply({
      userId,
      sessionId: session,
      replacingTurnId: `${newTurnId}_embed`,
      replyAction: "retry",
      userContent: "tea",
      replacedTurnId: turnId,
      characterIds: [`${characterId}_embed`],
    });
    const embeddings = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.characterId, `${characterId}_embed`));
    expect(embeddings).toHaveLength(1);
  });
});

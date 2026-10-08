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
import { discardReplacedCompanionReply } from "../src/lib/discardReplacedReply";
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
});

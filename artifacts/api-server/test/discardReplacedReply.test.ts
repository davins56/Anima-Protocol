import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  chatMessages,
  chatTurns,
  companionMemories,
  db,
  ensureSchemaOnce,
  localLlmDeferredJobs,
  memoryEmbeddings,
  userEntities,
} from "@workspace/db";
import {
  beginChatTurn,
  checkpointGeneratedTurn,
  markChatTurnReplaced,
  readChatTurn,
} from "../src/lib/chatTurnLedger";
import {
  discardReplacedCompanionReply,
  forgetReplacedTurnMemory,
  inspectReplacedReply,
} from "../src/lib/discardReplacedReply";
import { factIdFor } from "../src/lib/memoryEmbeddings";
import { isForgottenFact, isPolicyFact, runDeferredMemoryPolicy } from "../src/lib/memoryPolicy";

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
  await db.delete(localLlmDeferredJobs).where(eq(localLlmDeferredJobs.userId, userId));
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
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_MESSAGE)))
      .orderBy(asc(userEntities.id));
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
    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.characterId, `${characterId}_embed`));
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    expect(facts).toEqual([{ type: "factual", text: shared, fact_id: "tea" }]);
  });

  it("keeps the replacement when memory cleanup fails after the reply is deleted", async () => {
    const session = `${sessionId}_memfail`;
    const turnId = `${oldTurnId}_memfail`;
    const replacing = `${newTurnId}_memfail`;
    await beginChatTurn({
      id: turnId,
      sessionId: session,
      userId,
      userContent: "hello again",
      persistenceOwner: "client",
      metadata: { character_ids: [characterId] },
    });
    await db.insert(userEntities).values([
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `${turnId}:user`,
        data: {
          id: `${turnId}:user`,
          session_id: session,
          role: "user",
          content: "hello again",
          turn_id: turnId,
          seq: 0,
        },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `${turnId}:assistant`,
        data: {
          id: `${turnId}:assistant`,
          session_id: session,
          role: "assistant",
          content: "the reply that stays gone",
          turn_id: turnId,
          seq: 1,
        },
      },
    ]);

    const discarded = await discardReplacedCompanionReply(
      {
        userId,
        sessionId: session,
        replacingTurnId: replacing,
        replyAction: "retry",
        userContent: "hello again",
        replacedTurnId: turnId,
        messageIds: [`${turnId}:assistant`],
        fromMessageId: `${turnId}:assistant`,
        characterIds: [characterId],
      },
      {
        forgetMemory: async () => {
          throw new Error("memory down");
        },
      },
    );

    expect(discarded.turnId).toBe(turnId);
    const turn = await readChatTurn(turnId, userId);
    expect(turn?.metadata).toMatchObject({ replaced: true, superseded_by: replacing });
    const rows = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_MESSAGE)));
    const contents = rows
      .map((row) => row.data as { content?: string; session_id?: string })
      .filter((data) => data.session_id === session)
      .map((data) => data.content);
    expect(contents).toEqual(["hello again"]);
  });

  it("retires later turns the client already trimmed off the thread", async () => {
    const session = `${sessionId}_gone`;
    const first = `${oldTurnId}_gone`;
    const later = `${oldTurnId}_gone_later`;
    const other = `${oldTurnId}_gone_other`;
    for (const id of [first, later]) {
      await beginChatTurn({
        id,
        sessionId: session,
        userId,
        userContent: "hello",
        persistenceOwner: "client",
        metadata: { character_ids: [characterId] },
      });
    }
    await beginChatTurn({
      id: other,
      sessionId: `${session}_else`,
      userId,
      userContent: "hello",
      persistenceOwner: "client",
      metadata: {},
    });
    const discarded = await discardReplacedCompanionReply({
      userId,
      sessionId: session,
      replacingTurnId: `${newTurnId}_gone`,
      replyAction: "retry",
      userContent: "hello",
      replacedTurnId: first,
      replacedTurnIds: [first, later, other],
    });
    expect(discarded.turnIds).toEqual([first, later]);
    const firstTurn = await readChatTurn(first, userId);
    const laterTurn = await readChatTurn(later, userId);
    const otherTurn = await readChatTurn(other, userId);
    expect(firstTurn?.metadata).toMatchObject({ replaced: true });
    expect(laterTurn?.metadata).toMatchObject({ replaced: true });
    expect(otherTurn?.metadata).not.toMatchObject({ replaced: true });
  });

  it("migrates a legacy session blob before deleting the replaced reply", async () => {
    const session = `${sessionId}_legacy`;
    const turnId = `${oldTurnId}_legacy`;
    await beginChatTurn({
      id: turnId,
      sessionId: session,
      userId,
      userContent: "hello from the blob",
      persistenceOwner: "client",
      metadata: {},
    });
    await db.insert(userEntities).values({
      userId,
      entityName: CHAT_SESSION,
      entityId: session,
      data: {
        id: session,
        messages: [
          { id: `${turnId}:user`, role: "user", content: "hello from the blob", turn_id: turnId },
          { id: `${turnId}:assistant`, role: "assistant", content: "blob reply", turn_id: turnId },
        ],
      },
    });
    const discarded = await discardReplacedCompanionReply({
      userId,
      sessionId: session,
      replacingTurnId: `${newTurnId}_legacy`,
      replyAction: "retry",
      userContent: "hello from the blob",
      replacedTurnId: turnId,
      fromMessageId: `${turnId}:assistant`,
      messageIds: [`${turnId}:assistant`],
    });
    expect(discarded.turnId).toBe(turnId);
    const rows = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityName, CHAT_MESSAGE)));
    const contents = rows
      .map((row) => row.data as { content?: string; session_id?: string })
      .filter((data) => data.session_id === session)
      .map((data) => data.content);
    expect(contents).toEqual(["hello from the blob"]);
    const [stored] = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_SESSION),
          eq(userEntities.entityId, session),
        ),
      );
    const data = stored?.data as { messages?: unknown[]; messages_migrated?: boolean };
    expect(data.messages_migrated).toBe(true);
    expect(data.messages).toEqual([]);
  });

  it("does not let an underscore in a turn id delete a different typed row", async () => {
    const session = `${sessionId}_like`;
    const turnId = `ab_${prefix}`;
    const lookalike = `abX${prefix}:assistant`;
    await beginChatTurn({
      id: turnId,
      sessionId: session,
      userId,
      userContent: "hello",
      persistenceOwner: "client",
      metadata: {},
    });
    await db.insert(userEntities).values([
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `${turnId}:user`,
        data: {
          id: `${turnId}:user`,
          session_id: session,
          role: "user",
          content: "hello",
          turn_id: turnId,
          seq: 0,
        },
      },
      {
        userId,
        entityName: CHAT_MESSAGE,
        entityId: `${turnId}:assistant`,
        data: {
          id: `${turnId}:assistant`,
          session_id: session,
          role: "assistant",
          content: "the real reply",
          turn_id: turnId,
          seq: 1,
        },
      },
    ]);
    await db.insert(chatMessages).values([
      {
        id: `${turnId}:user`,
        sessionId: session,
        userId,
        role: "user",
        content: "hello",
        metadata: { turn_id: turnId },
      },
      {
        id: `${turnId}:assistant`,
        sessionId: session,
        userId,
        role: "assistant",
        content: "the real reply",
        metadata: { turn_id: turnId },
      },
      {
        id: lookalike,
        sessionId: session,
        userId,
        role: "assistant",
        content: "a different turn",
        metadata: { turn_id: `abX${prefix}` },
      },
    ]);
    await discardReplacedCompanionReply({
      userId,
      sessionId: session,
      replacingTurnId: `${newTurnId}_like`,
      replyAction: "retry",
      userContent: "hello",
      replacedTurnId: turnId,
      messageIds: [`${turnId}:assistant`],
      fromMessageId: `${turnId}:assistant`,
    });
    const typed = await db.select().from(chatMessages).where(eq(chatMessages.sessionId, session));
    expect(typed.map((row) => row.id).sort()).toEqual([`${turnId}:user`, lookalike].sort());
  });

  it("rolls the replaced mark back when the row delete does not commit", async () => {
    const session = `${sessionId}_atomic`;
    const turnId = `${oldTurnId}_atomic`;
    await beginChatTurn({
      id: turnId,
      sessionId: session,
      userId,
      userContent: "hello",
      persistenceOwner: "client",
      metadata: {},
    });
    await db.insert(userEntities).values({
      userId,
      entityName: CHAT_MESSAGE,
      entityId: `${turnId}:assistant`,
      data: {
        id: `${turnId}:assistant`,
        session_id: session,
        role: "assistant",
        content: "still here",
        turn_id: turnId,
        seq: 1,
      },
    });
    await expect(
      discardReplacedCompanionReply(
        {
          userId,
          sessionId: session,
          replacingTurnId: `${newTurnId}_atomic`,
          replyAction: "retry",
          userContent: "hello",
          replacedTurnId: turnId,
          messageIds: [`${turnId}:assistant`],
          fromMessageId: `${turnId}:assistant`,
        },
        {
          plan: {
            turnId,
            turnIds: [turnId],
            messageIds: [`${turnId}:assistant`],
            fromMessageId: `${turnId}:assistant`,
            fromSeq: 1,
          },
          beforeDelete: async () => {
            throw new Error("delete failed");
          },
        },
      ),
    ).rejects.toThrow("delete failed");
    const turn = await readChatTurn(turnId, userId);
    expect(turn?.metadata).not.toMatchObject({ replaced: true });
    const rows = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          eq(userEntities.entityId, `${turnId}:assistant`),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});

const USER_LINE = "My name is Sam.";

function storedFact(
  turnId: string,
  fields: {
    factId: string;
    text: string;
    predicate: string;
    object: string;
    about?: "user" | "companion";
    userEdited?: boolean;
    memoryClass?: "semantic" | "core";
    proposal?: boolean;
  },
) {
  return {
    type: "factual",
    memory_class: fields.memoryClass ?? "semantic",
    text: fields.text,
    subject: fields.about === "companion" ? "companion" : "user",
    predicate: fields.predicate,
    object: fields.object,
    about: fields.about ?? "user",
    importance: 0.9,
    confidence: 0.9,
    emotional_weight: 0,
    identity_relevant: fields.about === "companion",
    protected: fields.proposal === true,
    proposal: fields.proposal === true,
    fact_id: fields.factId,
    created_at: "2026-04-01T00:00:00.000Z",
    turn_id: turnId,
    ...(fields.userEdited ? { user_edited: true } : {}),
  };
}

function replacedTurnFacts(turnId: string) {
  const crumb = {
    type: "turn",
    turn_id: turnId,
    text: `User: ${USER_LINE} | Companion: I am Mira.`,
  };
  return [
    crumb,
    storedFact(turnId, {
      factId: "user-name-sam",
      text: "The human's name is Sam.",
      predicate: "name",
      object: "Sam",
    }),
    storedFact(turnId, {
      factId: "user-paris",
      text: "The human lives in Paris.",
      predicate: "lives_in",
      object: "Paris",
    }),
    storedFact(turnId, {
      factId: "user-chess",
      text: "The human enjoys chess.",
      predicate: "enjoys",
      object: "chess",
      userEdited: true,
    }),
    storedFact(turnId, {
      factId: "companion-name",
      text: "Protected identity proposal (not applied): Mira — name Mira.",
      predicate: "name",
      object: "Mira",
      about: "companion",
      memoryClass: "core",
      proposal: true,
    }),
    {
      forgotten: true,
      fact_id: "user-walk",
      about: "user",
      subject: "user",
      predicate: "did",
      object: "walked the bridge",
      deleted_at: "2026-04-02T00:00:00.000Z",
      turn_id: turnId,
      source_text: "The human did this: walked the bridge.",
    },
  ];
}

describe("reply replacement keeps what he asked to remember", () => {
  async function seed(label: string, userContent: string) {
    const characterId = `${prefix}_${label}_character`;
    const session = `${prefix}_${label}_session`;
    const oldId = `turn_${prefix}_${label}_old`;
    const newId = `turn_${prefix}_${label}_new`;
    const facts = replacedTurnFacts(oldId);
    await beginChatTurn({
      id: oldId,
      sessionId: session,
      userId,
      userContent,
      persistenceOwner: "client",
      metadata: {
        character_ids: [characterId],
        active_character_id: characterId,
        active_character_name: "Mira",
      },
    });
    await db.insert(userEntities).values({
      userId,
      entityName: CHAT_SESSION,
      entityId: session,
      data: { id: session, shared_memory: facts },
    });
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "",
      facts,
      emotionalState: { selfState: { intensity: 100 }, synchroStrength: 100 },
      resonanceNotes: "",
    });
    await db.insert(memoryEmbeddings).values(
      facts.map((item) => {
        const row = item as { text?: string; fact_id?: string; source_text?: string };
        const factId = row.fact_id || factIdFor(String(row.text || ""));
        return {
          userId,
          characterId,
          factId,
          text: String(row.text || row.source_text || factId),
          memoryType: "factual",
          embedding: [0.2],
        };
      }),
    );
    return { characterId, session, oldId, newId, facts };
  }

  function jobsFor(characterId: string, rows: { payload: unknown }[]) {
    return rows.filter((row) => {
      const payload = row.payload as { characterId?: string };
      return payload.characterId === characterId;
    });
  }

  it("retags his name, drops her reply, and keeps a correction and a tombstone", async () => {
    const seeded = await seed("retry", USER_LINE);
    await beginChatTurn({
      id: seeded.newId,
      sessionId: seeded.session,
      userId,
      userContent: USER_LINE,
      persistenceOwner: "client",
      metadata: { reply_action: "retry", skip_affect: true },
    });
    await discardReplacedCompanionReply({
      userId,
      sessionId: seeded.session,
      replacingTurnId: seeded.newId,
      replyAction: "retry",
      userContent: USER_LINE,
      replacedTurnId: seeded.oldId,
      characterIds: [seeded.characterId],
    });

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.characterId, seeded.characterId));
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    const names = facts.filter((item) => isPolicyFact(item) && item.object === "Sam");
    expect(names).toHaveLength(1);
    expect(names[0]?.turn_id).toBe(seeded.newId);
    expect(names[0]?.about).toBe("user");
    expect(facts.some((item) => isPolicyFact(item) && item.about === "companion")).toBe(false);
    expect(facts.some((item) => isPolicyFact(item) && item.object === "Paris")).toBe(false);
    expect(facts.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "turn")).toBe(
      false,
    );
    const chess = facts.find((item) => isPolicyFact(item) && item.fact_id === "user-chess");
    expect(chess?.user_edited).toBe(true);
    expect(facts.some((item) => isForgottenFact(item) && item.fact_id === "user-walk")).toBe(true);

    const [session] = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityId, seeded.session)));
    const shared = (session?.data as { shared_memory?: unknown[] }).shared_memory ?? [];
    const sharedName = shared.filter((item) => isPolicyFact(item) && item.object === "Sam");
    expect(sharedName).toHaveLength(1);
    expect(sharedName[0]?.turn_id).toBe(seeded.newId);
    expect(shared.some((item) => isForgottenFact(item) && item.fact_id === "user-walk")).toBe(true);
    expect(shared.some((item) => isPolicyFact(item) && item.user_edited === true)).toBe(true);
    expect(shared.some((item) => isPolicyFact(item) && item.about === "companion")).toBe(false);

    const embeddings = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.characterId, seeded.characterId));
    expect(embeddings.map((row) => row.factId).sort()).toEqual(
      ["user-chess", "user-name-sam", "user-walk"].sort(),
    );
    const queued = jobsFor(
      seeded.characterId,
      await db.select().from(localLlmDeferredJobs).where(eq(localLlmDeferredJobs.userId, userId)),
    );
    expect(queued).toHaveLength(0);
  });

  it("drops his old user facts on edit and still keeps a correction and a tombstone", async () => {
    const seeded = await seed("edit", USER_LINE);
    await discardReplacedCompanionReply({
      userId,
      sessionId: seeded.session,
      replacingTurnId: seeded.newId,
      replyAction: "edit",
      userContent: "I live in Oslo.",
      replacedTurnId: seeded.oldId,
      characterIds: [seeded.characterId],
    });

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.characterId, seeded.characterId));
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    expect(facts.some((item) => isPolicyFact(item) && (item.object === "Sam" || item.object === "Paris"))).toBe(
      false,
    );
    expect(facts.some((item) => isPolicyFact(item) && item.about === "companion")).toBe(false);
    expect(facts.some((item) => item && typeof item === "object" && (item as { type?: string }).type === "turn")).toBe(
      false,
    );
    expect(facts.find((item) => isPolicyFact(item) && item.fact_id === "user-chess")?.user_edited).toBe(true);
    expect(facts.some((item) => isForgottenFact(item) && item.fact_id === "user-walk")).toBe(true);

    const embeddings = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.characterId, seeded.characterId));
    expect(embeddings.map((row) => row.factId).sort()).toEqual(["user-chess", "user-walk"].sort());
    const queued = jobsFor(
      seeded.characterId,
      await db.select().from(localLlmDeferredJobs).where(eq(localLlmDeferredJobs.userId, userId)),
    );
    expect(queued).toHaveLength(0);
  });

  it("saves his fact once when retry happens before the deferred job", async () => {
    const characterId = `${prefix}_pending_character`;
    const session = `${prefix}_pending_session`;
    const oldId = `turn_${prefix}_pending_old`;
    const newId = `turn_${prefix}_pending_new`;
    await beginChatTurn({
      id: oldId,
      sessionId: session,
      userId,
      userContent: USER_LINE,
      persistenceOwner: "client",
      metadata: {
        character_ids: [characterId],
        active_character_id: characterId,
        active_character_name: "Mira",
      },
    });
    await beginChatTurn({
      id: newId,
      sessionId: session,
      userId,
      userContent: USER_LINE,
      persistenceOwner: "client",
      metadata: { reply_action: "retry", skip_affect: true, active_character_id: characterId },
    });
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "",
      facts: [],
      emotionalState: { selfState: { intensity: 100 }, synchroStrength: 100 },
      resonanceNotes: "",
    });

    await discardReplacedCompanionReply({
      userId,
      sessionId: session,
      replacingTurnId: newId,
      replyAction: "retry",
      userContent: USER_LINE,
      replacedTurnId: oldId,
      characterIds: [characterId],
    });

    const queued = jobsFor(
      characterId,
      await db.select().from(localLlmDeferredJobs).where(eq(localLlmDeferredJobs.userId, userId)),
    );
    expect(queued).toHaveLength(1);
    const payload = queued[0]?.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      userOnly: true,
      assistantContent: "",
      userContent: USER_LINE,
      turnId: newId,
      companionName: "Mira",
    });

    const signal = new AbortController().signal;
    await runDeferredMemoryPolicy(
      {
        userId,
        characterId,
        turnId: oldId,
        companionName: "Mira",
        userContent: USER_LINE,
        assistantContent: "I am Mira.",
      },
      { signal },
    );
    const [untouched] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.characterId, characterId));
    expect(Array.isArray(untouched?.facts) ? untouched.facts.filter(isPolicyFact) : []).toHaveLength(0);

    await runDeferredMemoryPolicy(payload, { signal });
    await runDeferredMemoryPolicy(payload, { signal });
    await runDeferredMemoryPolicy(
      {
        userId,
        characterId,
        turnId: oldId,
        companionName: "Mira",
        userContent: USER_LINE,
        assistantContent: "I am Mira.",
      },
      { signal },
    );

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.characterId, characterId));
    const facts = (Array.isArray(memory?.facts) ? memory.facts : []).filter(isPolicyFact);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.object).toBe("Sam");
    expect(facts[0]?.about).toBe("user");
    expect(facts[0]?.turn_id).toBe(newId);
    expect(facts.some((fact) => fact.about === "companion")).toBe(false);
  });

  it("moves his name to the newest retry when an earlier cleanup runs late", async () => {
    const seeded = await seed("late", USER_LINE);
    const mid = `turn_${prefix}_late_mid`;
    await beginChatTurn({
      id: mid,
      sessionId: seeded.session,
      userId,
      userContent: USER_LINE,
      persistenceOwner: "client",
      metadata: { reply_action: "retry", skip_affect: true },
    });
    await beginChatTurn({
      id: seeded.newId,
      sessionId: seeded.session,
      userId,
      userContent: USER_LINE,
      persistenceOwner: "client",
      metadata: { reply_action: "retry", skip_affect: true },
    });
    await markChatTurnReplaced(seeded.oldId, userId, mid);
    await markChatTurnReplaced(mid, userId, seeded.newId);

    await discardReplacedCompanionReply({
      userId,
      sessionId: seeded.session,
      replacingTurnId: mid,
      replyAction: "retry",
      userContent: USER_LINE,
      replacedTurnId: seeded.oldId,
      characterIds: [seeded.characterId],
    });

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.characterId, seeded.characterId));
    const names = (Array.isArray(memory?.facts) ? memory.facts : []).filter(
      (item) => isPolicyFact(item) && item.object === "Sam",
    );
    expect(names).toHaveLength(1);
    expect(names[0]?.turn_id).toBe(seeded.newId);
  });

  it("does not drop his fact when the successor action cannot be read", async () => {
    const seeded = await seed("unknown", USER_LINE);
    await beginChatTurn({
      id: seeded.newId,
      sessionId: seeded.session,
      userId,
      userContent: USER_LINE,
      persistenceOwner: "client",
      metadata: { skip_affect: true },
    });
    await markChatTurnReplaced(seeded.oldId, userId, seeded.newId);
    const replaced = await readChatTurn(seeded.oldId, userId);
    expect(replaced).not.toBeNull();

    await forgetReplacedTurnMemory({
      id: replaced!.id,
      userId: replaced!.userId,
      sessionId: replaced!.sessionId,
      metadata: replaced!.metadata,
      userContent: USER_LINE,
    });

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.characterId, seeded.characterId));
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    expect(facts.some((item) => isPolicyFact(item) && item.object === "Sam")).toBe(true);
  });
});

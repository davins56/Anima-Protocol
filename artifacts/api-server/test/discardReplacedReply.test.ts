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
  localLlmDeferredJobs,
  memoryEmbeddings,
  userEntities,
} from "@workspace/db";
import { beginChatTurn, checkpointGeneratedTurn, readChatTurn } from "../src/lib/chatTurnLedger";
import { discardReplacedCompanionReply } from "../src/lib/discardReplacedReply";
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
});

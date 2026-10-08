import { readFileSync } from "node:fs";
import pg from "pg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  chatTurns,
  companionMemories,
  db,
  ensureSchemaOnce,
  memoryEmbeddings,
  userEntities,
  userProfiles,
} from "@workspace/db";
import { beginChatTurn, markChatTurnReplaced } from "../src/lib/chatTurnLedger";
import { applyCompanionMemoryChange, editCompanionMemoryFact } from "../src/lib/companionMemoryReview";
import { CONTINUE_USER_TURN } from "../src/lib/promptBuilder";
import { DeferredLlmRetryError } from "../src/lib/deferredLocalLlm";
import {
  IMPORTANCE_WEIGHTS,
  appendTurnMemoryFact,
  buildMemoryPolicyJob,
  buildMemoryReembedJob,
  buildUserOnlyMemoryPolicyJob,
  consolidateExchange,
  decideMemoryCandidate,
  factsWithoutTurn,
  isForgottenFact,
  isLegacyTextFact,
  isPolicyFact,
  memoryPolicySignals,
  persistCompanionTurnFact,
  policyDedupeKey,
  policyFactId,
  runDeferredMemoryPolicy,
  scoreImportance,
  type PolicyFact,
} from "../src/lib/memoryPolicy";
import * as memoryEmbeddingWrites from "../src/lib/memoryEmbeddings";
import { factIdFor, searchMemoriesSemantically, upsertMemoryEmbeddings } from "../src/lib/memoryEmbeddings";
import { formatMemoriesForPrompt, retrieveRelevantMemories } from "../src/lib/memoryRetrieval";

const PREFIX = `mempol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;

function policyOf(facts: unknown[]): PolicyFact[] {
  return facts.filter(isPolicyFact);
}

beforeAll(async () => {
  await ensureSchemaOnce();
});

afterEach(async () => {
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.userId, `${PREFIX}user`));
  await db.delete(companionMemories).where(eq(companionMemories.userId, `${PREFIX}user`));
  await db.delete(userEntities).where(eq(userEntities.userId, `${PREFIX}user`));
  await db.delete(userProfiles).where(eq(userProfiles.userId, `${PREFIX}user`));
});

describe("memory policy scoring", () => {
  it("blends semantic, emotion, relationship, and novelty with the phase-1 weights", () => {
    expect(IMPORTANCE_WEIGHTS).toEqual({
      semantic: 0.4,
      emotional: 0.25,
      relationship: 0.2,
      novelty: 0.15,
    });
    expect(
      IMPORTANCE_WEIGHTS.semantic +
        IMPORTANCE_WEIGHTS.emotional +
        IMPORTANCE_WEIGHTS.relationship +
        IMPORTANCE_WEIGHTS.novelty,
    ).toBeCloseTo(1);
    expect(
      scoreImportance({ semantic: 1, emotional: 1, relationship: 1, novelty: 1 }),
    ).toBe(1);
    expect(
      scoreImportance({ semantic: 0.2, emotional: 0, relationship: 0, novelty: 1 }),
    ).toBeLessThan(0.3);
  });

  it("discards a weak candidate and keeps an episodic event at or above 0.3", () => {
    const weak = decideMemoryCandidate({
      content: "noise",
      semantic: 0.2,
      confidence: 0.4,
      emotionalIntensity: 0,
      relationshipImportance: 0,
      novelty: 1,
      about: "user",
      kind: "episodic",
      identityRelevant: false,
      subject: "user",
      predicate: "did",
      object: "nothing much",
    });
    expect(weak.action).toBe("discard");
    expect(weak.candidate.importance).toBeLessThan(0.3);

    const saved = consolidateExchange({
      userContent: "Yesterday I started a new job at the docks.",
      assistantContent: "That is a real change.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 0,
      relationshipImportance: 0,
    });
    const [fact] = policyOf(saved.facts);
    expect(fact?.memory_class).toBe("episodic");
    expect(fact?.about).toBe("user");
    expect(fact?.importance).toBeGreaterThanOrEqual(0.3);
    expect(fact?.text).toMatch(/^The human did this:/);
    expect(fact?.subject).toBe("user");
    expect(fact?.predicate).toBe("did");
    expect(fact?.object).toMatch(/new job at the docks/);
  });

  it("promotes a repeated event to semantic and does not store a second row", () => {
    const first = consolidateExchange({
      userContent: "Yesterday I started a new job at the docks.",
      assistantContent: "Tell me how it felt.",
      companionName: "Natasha Romanoff",
    });
    const second = consolidateExchange({
      userContent: "Yesterday I started a new job at the docks.",
      assistantContent: "You mentioned the docks again.",
      companionName: "Natasha Romanoff",
      existingFacts: first.facts,
    });
    const facts = policyOf(second.facts);
    expect(second.promoted).toBe(1);
    expect(second.saved).toHaveLength(0);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.memory_class).toBe("semantic");
    expect(facts[0]?.text).toMatch(/more than once/);
    expect(facts[0]?.repeats).toBe(2);
  });

  it("does not duplicate a stable fact that is already semantic", () => {
    const first = consolidateExchange({
      userContent: "My name is Sam.",
      assistantContent: "Sam. I will remember.",
      companionName: "Natasha Romanoff",
    });
    const second = consolidateExchange({
      userContent: "My name is Sam.",
      assistantContent: "I still have that.",
      companionName: "Natasha Romanoff",
      existingFacts: first.facts,
    });
    expect(policyOf(second.facts)).toHaveLength(1);
    expect(second.saved).toHaveLength(0);
    expect(second.promoted).toBe(0);
    expect(policyOf(second.facts)[0]?.text).toBe("The human's name is Sam.");
  });
});

describe("memory policy keeps people separate", () => {
  it("stores a high-importance user fact as the human's, never as core identity", () => {
    const result = consolidateExchange({
      userContent: "My name is Sam.",
      assistantContent: "I hear you, Sam.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 1,
      relationshipImportance: 1,
    });
    const [fact] = policyOf(result.facts);
    expect(fact?.importance).toBeGreaterThan(0.9);
    expect(fact?.memory_class).toBe("semantic");
    expect(fact?.about).toBe("user");
    expect(fact?.protected).toBeUndefined();
    expect(fact?.proposal).toBeUndefined();
    expect(fact?.text).toBe("The human's name is Sam.");
    expect(JSON.stringify(result.facts)).not.toMatch(/operator_model/);
  });

  it("proposes core only when a companion self-claim is identity-relevant and above 0.9", () => {
    const calm = consolidateExchange({
      userContent: "Tell me who you are in this room.",
      assistantContent: "I am Natasha Romanoff.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 0,
      relationshipImportance: 0,
    });
    expect(policyOf(calm.facts)).toHaveLength(0);
    expect(calm.coreProposed).toBe(0);

    const charged = consolidateExchange({
      userContent: "I trust you with this completely.",
      assistantContent: "I am Natasha Romanoff.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 1,
      relationshipImportance: 1,
    });
    const [fact] = policyOf(charged.facts);
    expect(charged.coreProposed).toBe(1);
    expect(fact?.memory_class).toBe("core");
    expect(fact?.about).toBe("companion");
    expect(fact?.protected).toBe(true);
    expect(fact?.proposal).toBe(true);
    expect(fact?.importance).toBeGreaterThan(0.9);
    expect(fact?.text).toMatch(/not applied/);
    expect(fact?.text).not.toMatch(/^You are /);
  });

  it("does not overwrite a protected core proposal", () => {
    const key = policyDedupeKey({
      about: "companion",
      subject: "companion",
      predicate: "name",
      object: "Natasha Romanoff",
    });
    const original: PolicyFact = {
      type: "factual",
      memory_class: "core",
      text: "ORIGINAL",
      subject: "companion",
      predicate: "name",
      object: "Natasha Romanoff",
      about: "companion",
      importance: 0.95,
      confidence: 0.8,
      emotional_weight: 1,
      identity_relevant: true,
      protected: true,
      proposal: true,
      fact_id: policyFactId(key),
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const result = consolidateExchange({
      userContent: "I trust you with this completely.",
      assistantContent: "I am Natasha Romanoff.",
      companionName: "Natasha Romanoff",
      existingFacts: [original],
      emotionalIntensity: 1,
      relationshipImportance: 1,
    });
    expect(policyOf(result.facts)).toHaveLength(1);
    expect(policyOf(result.facts)[0]?.text).toBe("ORIGINAL");
    expect(result.coreProposed).toBe(0);
    expect(result.saved).toHaveLength(0);
  });

  it("does not turn a role-swap reply or a you-are line into anyone's identity", () => {
    const swapped = consolidateExchange({
      userContent: "My name is Sam.",
      assistantContent:
        "You are Natasha Romanoff. You defected from the Red Room and never looked back.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 1,
      relationshipImportance: 1,
    });
    const facts = policyOf(swapped.facts);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.about).toBe("user");
    expect(facts[0]?.text).toBe("The human's name is Sam.");
    expect(JSON.stringify(facts)).not.toMatch(/Red Room|defected|You are Natasha/i);

    const addressed = consolidateExchange({
      userContent: "You are Natasha Romanoff.",
      assistantContent: "I am listening.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 1,
      relationshipImportance: 1,
    });
    expect(policyOf(addressed.facts)).toHaveLength(0);

    const sameName = consolidateExchange({
      userContent: "My name is Natasha.",
      assistantContent: "Alright.",
      companionName: "Natasha Romanoff",
    });
    expect(policyOf(sameName.facts)).toHaveLength(0);
  });

  it("skips greetings and continue turns, and reads stored emotion without inventing it", () => {
    expect(
      consolidateExchange({
        userContent: "hi",
        assistantContent: "Hello.",
        companionName: "Natasha Romanoff",
      }).saved,
    ).toHaveLength(0);
    expect(
      consolidateExchange({
        userContent: CONTINUE_USER_TURN,
        assistantContent: "I go on.",
        companionName: "Natasha Romanoff",
      }).saved,
    ).toHaveLength(0);
    expect(memoryPolicySignals(null)).toEqual({
      emotionalIntensity: 0,
      synchroImportance: null,
    });
    expect(memoryPolicySignals({ selfState: { intensity: 80 }, synchroStrength: 40 })).toEqual({
      emotionalIntensity: 0.8,
      synchroImportance: 0.4,
    });
  });

  it("keeps classified facts when the turn window slides", () => {
    const policy = consolidateExchange({
      userContent: "My name is Sam.",
      assistantContent: "Noted.",
      companionName: "Natasha Romanoff",
    }).facts;
    const turns = Array.from({ length: 24 }, (_, index) => ({
      type: "turn",
      turn_id: `t${index}`,
      text: `User: ${index} | Companion: ok`,
    }));
    const next = appendTurnMemoryFact([...policy, ...turns], {
      type: "turn",
      turn_id: "t-new",
      text: "User: later | Companion: still here",
    });
    expect(next).not.toBeNull();
    expect(policyOf(next || [])).toHaveLength(1);
    expect((next || []).filter((item) => !isPolicyFact(item) && !isLegacyTextFact(item))).toHaveLength(24);
    expect(appendTurnMemoryFact(next || [], { type: "turn", turn_id: "t-new", text: "dup" })).toBe(
      null,
    );
  });

  it("keeps a legacy text fact that has no memory class when the turn window slides", () => {
    const legacy = { type: "factual", text: "The human once mentioned a red scarf." };
    const turns = Array.from({ length: 24 }, (_, index) => ({
      type: "turn",
      turn_id: `t${index}`,
      text: `User: ${index} | Companion: ok`,
    }));
    const next = appendTurnMemoryFact([legacy, ...turns], {
      type: "turn",
      turn_id: "t-new",
      text: "User: later | Companion: still here",
    });
    expect(next).not.toBeNull();
    expect(next?.some((item) => item.text === legacy.text)).toBe(true);
    expect(next?.filter((item) => isLegacyTextFact(item))).toHaveLength(1);
    expect(next?.filter((item) => !isLegacyTextFact(item))).toHaveLength(24);
  });

  it("enqueues a deferred job and does not call a chat model", () => {
    const job = buildMemoryPolicyJob({
      userId: "user_1",
      characterId: "char_1",
      sessionId: "sess_1",
      turnId: "turn_1",
      companionName: "Natasha Romanoff",
      userContent: "My name is Sam.",
      assistantContent: "I hear you.",
    });
    expect(job?.kind).toBe("memory-policy");
    expect(job?.id).toBe("memory-policy:user_1:char_1:turn_1");
    expect(job?.payload).not.toHaveProperty("operator_model");
    expect(Object.keys(job?.payload || {}).sort()).toEqual([
      "assistantContent",
      "characterId",
      "companionName",
      "sessionId",
      "turnId",
      "userContent",
      "userId",
    ]);
    expect(
      buildMemoryPolicyJob({
        userId: "user_1",
        characterId: "char_1",
        sessionId: "sess_1",
        turnId: "turn_1",
        companionName: "Natasha Romanoff",
        userContent: "hello",
        assistantContent: "Hi.",
      }),
    ).toBeNull();
    const source = readFileSync(new URL("../src/lib/memoryPolicy.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/createChatStream|openrouter|openai/i);
  });
});

describe("memory policy persistence", () => {
  it("writes user facts onto companion_memories and leaves identity and the operator model alone", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}natasha`;
    await db.insert(userProfiles).values({
      userId,
      data: { operator_model: { preferred_name: "steward-note" } },
    });
    await db.insert(userEntities).values({
      userId,
      entityName: "Character",
      entityId: characterId,
      data: {
        id: characterId,
        name: "Natasha Romanoff",
        personality: "ORIGINAL PERSONALITY",
        backstory: "ORIGINAL BACKSTORY",
      },
    });
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "kept",
      facts: [
        {
          type: "turn",
          turn_id: "old",
          text: "User: earlier | Companion: yes",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      emotionalState: { selfState: { intensity: 10 }, synchroStrength: 20 },
      resonanceNotes: "note",
    });

    await runDeferredMemoryPolicy(
      {
        userId,
        characterId,
        sessionId: "sess",
        turnId: "turn-user",
        companionName: "Natasha Romanoff",
        userContent: "My name is Sam. I live in Lisbon.",
        assistantContent: "I will keep that as yours.",
      },
      { signal: new AbortController().signal },
    );

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const facts = policyOf(Array.isArray(memory?.facts) ? memory.facts : []);
    expect(facts.map((fact) => fact.text).sort()).toEqual([
      "The human lives in Lisbon.",
      "The human's name is Sam.",
    ]);
    expect(facts.every((fact) => fact.about === "user" && fact.memory_class === "semantic")).toBe(
      true,
    );
    expect(Array.isArray(memory?.facts) && memory.facts.some((item) => {
      return item && typeof item === "object" && (item as { type?: string }).type === "turn";
    })).toBe(true);
    expect(memory?.summary).toBe("kept");
    expect(memory?.resonanceNotes).toBe("note");
    const state = memory?.emotionalState as { selfState?: { intensity?: number } };
    expect(state.selfState?.intensity).toBe(10);

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    expect(profile?.data).toEqual({ operator_model: { preferred_name: "steward-note" } });

    const [character] = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, userId), eq(userEntities.entityId, characterId)))
      .limit(1);
    expect(character?.data).toMatchObject({
      personality: "ORIGINAL PERSONALITY",
      backstory: "ORIGINAL BACKSTORY",
    });

    const scored = retrieveRelevantMemories([
      { characterId, facts: Array.isArray(memory?.facts) ? memory.facts : [] },
    ]);
    expect(scored.map((item) => item.fact.text).join("\n")).toMatch(/Sam/);
  });

  it("stores a charged identity claim as a protected proposal and keeps it out of retrieval", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}core`;
    await db.insert(userEntities).values({
      userId,
      entityName: "Character",
      entityId: characterId,
      data: {
        id: characterId,
        name: "Natasha Romanoff",
        backstory: "ORIGINAL BACKSTORY",
      },
    });
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "",
      facts: [],
      emotionalState: { selfState: { intensity: 100 }, synchroStrength: 100 },
      resonanceNotes: "",
    });

    await runDeferredMemoryPolicy(
      {
        userId,
        characterId,
        turnId: "turn-core",
        companionName: "Natasha Romanoff",
        userContent: "I trust you with this completely.",
        assistantContent: "I am Natasha Romanoff.",
      },
      { signal: new AbortController().signal },
    );

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const [fact] = policyOf(Array.isArray(memory?.facts) ? memory.facts : []);
    expect(fact?.memory_class).toBe("core");
    expect(fact?.protected).toBe(true);
    expect(fact?.proposal).toBe(true);
    const scored = retrieveRelevantMemories([
      { characterId, facts: Array.isArray(memory?.facts) ? memory.facts : [] },
    ]);
    expect(scored).toHaveLength(0);

    const [character] = await db
      .select()
      .from(userEntities)
      .where(eq(userEntities.entityId, characterId))
      .limit(1);
    expect((character?.data as { backstory?: string }).backstory).toBe("ORIGINAL BACKSTORY");
  });

  it("drops facts that belong to a replaced turn and leaves the rest", () => {
    const facts = [
      { type: "turn", turn_id: "turn_old", text: "old reply" },
      { type: "factual", text: "likes tea" },
      { type: "policy", turn_id: "turn_old", text: "also old" },
    ];
    expect(factsWithoutTurn(facts, "turn_old")).toEqual([{ type: "factual", text: "likes tea" }]);
    expect(factsWithoutTurn(facts, "")).toEqual(facts);
  });

  it("keeps his name on retry, drops her reply, and protects corrections", () => {
    const exchanged = consolidateExchange({
      userContent: "My name is Sam.",
      assistantContent: "I hear you.",
      companionName: "Natasha Romanoff",
      turnId: "turn_old",
    });
    expect(policyOf(exchanged.facts).some((fact) => fact.object === "Sam")).toBe(true);
    const companion = {
      type: "factual" as const,
      memory_class: "core" as const,
      text: "Protected identity proposal (not applied): Natasha Romanoff — name Natasha Romanoff.",
      subject: "companion",
      predicate: "name",
      object: "Natasha Romanoff",
      about: "companion" as const,
      importance: 0.99,
      confidence: 0.8,
      emotional_weight: 1,
      identity_relevant: true,
      protected: true,
      proposal: true,
      fact_id: "companion-name",
      created_at: "2026-04-01T00:00:00.000Z",
      turn_id: "turn_old",
    };
    const corrected = {
      type: "factual" as const,
      memory_class: "semantic" as const,
      text: "The human enjoys chess.",
      subject: "user",
      predicate: "enjoys",
      object: "chess",
      about: "user" as const,
      importance: 0.7,
      confidence: 0.7,
      emotional_weight: 0,
      identity_relevant: false,
      fact_id: "user-chess",
      created_at: "2026-04-01T00:00:00.000Z",
      turn_id: "turn_old",
      user_edited: true,
    };
    const tombstone = {
      forgotten: true as const,
      fact_id: "user-walk",
      about: "user" as const,
      subject: "user",
      predicate: "did",
      object: "walked the bridge",
      deleted_at: "2026-04-02T00:00:00.000Z",
      turn_id: "turn_old",
      source_text: "The human did this: walked the bridge.",
    };
    const unsupported = {
      ...corrected,
      text: "The human lives in Paris.",
      predicate: "lives_in",
      object: "Paris",
      fact_id: "user-paris",
      user_edited: false,
    };
    const facts = [
      ...exchanged.facts,
      companion,
      { type: "turn", turn_id: "turn_old", text: "User: My name is Sam. | Companion: old" },
      corrected,
      tombstone,
      unsupported,
    ];
    const retry = {
      replyAction: "retry" as const,
      userContent: "My name is Sam.",
      companionName: "Natasha Romanoff",
      replacingTurnId: "turn_new",
    };
    const kept = factsWithoutTurn(facts, "turn_old", retry);
    const names = policyOf(kept).filter((fact) => fact.object === "Sam");
    expect(names).toHaveLength(1);
    expect(names[0]?.about).toBe("user");
    expect(names[0]?.turn_id).toBe("turn_new");
    expect(policyOf(kept).some((fact) => fact.about === "companion")).toBe(false);
    expect(kept.some((item) => isPolicyFact(item) === false && (item as { type?: string }).type === "turn")).toBe(
      false,
    );
    expect(policyOf(kept).some((fact) => fact.object === "Paris")).toBe(false);
    expect(policyOf(kept).find((fact) => fact.fact_id === "user-chess")?.user_edited).toBe(true);
    expect(kept.some((item) => isForgottenFact(item) && item.fact_id === "user-walk")).toBe(true);

    const edited = factsWithoutTurn(facts, "turn_old", {
      replyAction: "edit",
      userContent: "My name is Sam.",
      companionName: "Natasha Romanoff",
      replacingTurnId: "turn_new",
    });
    expect(policyOf(edited).some((fact) => fact.object === "Sam" || fact.about === "companion")).toBe(false);
    expect(policyOf(edited).find((fact) => fact.fact_id === "user-chess")?.user_edited).toBe(true);
    expect(edited.some((item) => isForgottenFact(item) && item.object === "walked the bridge")).toBe(true);

    const again = factsWithoutTurn(kept, "turn_new", {
      ...retry,
      replacingTurnId: "turn_third",
    });
    expect(policyOf(again).filter((fact) => fact.object === "Sam")).toHaveLength(1);
    expect(policyOf(again).find((fact) => fact.object === "Sam")?.turn_id).toBe("turn_third");
  });

  it("does not store the same fact key twice when retry retags it", () => {
    const first = consolidateExchange({
      userContent: "My name is Sam.",
      assistantContent: "I hear you.",
      companionName: "Natasha Romanoff",
      turnId: "turn_earlier",
    });
    const sam = policyOf(first.facts)[0];
    expect(sam?.object).toBe("Sam");
    const kept = factsWithoutTurn(
      [sam, { ...sam, turn_id: "turn_old" }],
      "turn_old",
      {
        replyAction: "retry",
        userContent: "My name is Sam.",
        companionName: "Natasha Romanoff",
        replacingTurnId: "turn_new",
      },
    );
    expect(policyOf(kept)).toHaveLength(1);
    expect(policyOf(kept)[0]?.turn_id).toBe("turn_earlier");
  });

  it("saves only his words when consolidating a retry, and does not save them twice", () => {
    const job = buildUserOnlyMemoryPolicyJob({
      userId: "user",
      characterId: "character",
      sessionId: "session",
      turnId: "turn_new",
      companionName: "Natasha Romanoff",
      userContent: "My name is Sam.",
    });
    expect(job?.kind).toBe("memory-policy");
    expect(job?.payload.userOnly).toBe(true);
    expect(job?.payload.assistantContent).toBe("");
    expect(job?.payload.userContent).toBe("My name is Sam.");
    expect(job?.payload.turnId).toBe("turn_new");
    expect(
      buildUserOnlyMemoryPolicyJob({
        userId: "user",
        characterId: "character",
        sessionId: "session",
        turnId: "turn_new",
        companionName: "Natasha Romanoff",
        userContent: "hi",
      }),
    ).toBeNull();

    const named = consolidateExchange({
      userOnly: true,
      userContent: "My name is Sam.",
      assistantContent: "I am Natasha Romanoff.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 1,
      relationshipImportance: 1,
      turnId: "turn_new",
    });
    expect(policyOf(named.facts)).toHaveLength(1);
    expect(policyOf(named.facts)[0]?.about).toBe("user");
    expect(policyOf(named.facts)[0]?.object).toBe("Sam");

    const first = consolidateExchange({
      userOnly: true,
      userContent: "Yesterday I started a new job at the docks.",
      assistantContent: "I am Natasha Romanoff.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 1,
      relationshipImportance: 1,
    });
    expect(policyOf(first.facts)).toHaveLength(1);
    expect(policyOf(first.facts)[0]?.memory_class).toBe("episodic");
    const second = consolidateExchange({
      userOnly: true,
      userContent: "Yesterday I started a new job at the docks.",
      assistantContent: "I am Natasha Romanoff.",
      companionName: "Natasha Romanoff",
      emotionalIntensity: 1,
      relationshipImportance: 1,
      existingFacts: first.facts,
    });
    expect(second.saved).toHaveLength(0);
    expect(second.promoted).toBe(0);
    expect(policyOf(second.facts)).toHaveLength(1);
    expect(policyOf(second.facts)[0]?.memory_class).toBe("episodic");
    expect(policyOf(second.facts).some((fact) => fact.about === "companion")).toBe(false);
  });

  it("does not store a memory for a reply the user already replaced", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}replaced`;
    const turnId = `turn_${PREFIX}replaced`.replace(/_+$/, "");
    await beginChatTurn({
      id: turnId,
      sessionId: `${PREFIX}sess`,
      userId,
      userContent: "I trust you with this completely.",
      persistenceOwner: "client",
      metadata: { character_ids: [characterId] },
    });
    await markChatTurnReplaced(turnId, userId, `turn_${PREFIX}next`.replace(/_+$/, ""));
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "",
      facts: [],
      emotionalState: {},
      resonanceNotes: "",
    });
    await runDeferredMemoryPolicy(
      {
        userId,
        characterId,
        sessionId: `${PREFIX}sess`,
        turnId,
        companionName: "Aria",
        userContent: "I trust you with this completely.",
        assistantContent: "I am here with you.",
      },
      { signal: new AbortController().signal },
    );

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    expect(memory?.facts).toEqual([]);
    await db.delete(chatTurns).where(eq(chatTurns.id, turnId));
  });

  it("saves his fact once on the replacing turn when retry lands before the old job", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}user-only`;
    const oldId = `turn_${PREFIX}user_only_old`;
    const newId = `turn_${PREFIX}user_only_new`;
    await beginChatTurn({
      id: oldId,
      sessionId: `${PREFIX}sess`,
      userId,
      userContent: "My name is Sam.",
      persistenceOwner: "client",
      metadata: { character_ids: [characterId] },
    });
    await markChatTurnReplaced(oldId, userId, newId);
    await beginChatTurn({
      id: newId,
      sessionId: `${PREFIX}sess`,
      userId,
      userContent: "My name is Sam.",
      persistenceOwner: "client",
      metadata: { reply_action: "retry", skip_affect: true, character_ids: [characterId] },
    });
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "",
      facts: [],
      emotionalState: { selfState: { intensity: 100 }, synchroStrength: 100 },
      resonanceNotes: "",
    });

    await runDeferredMemoryPolicy(
      {
        userId,
        characterId,
        turnId: oldId,
        companionName: "Mira",
        userContent: "My name is Sam.",
        assistantContent: "I am Mira.",
      },
      { signal: new AbortController().signal },
    );
    const [before] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    expect(policyOf(Array.isArray(before?.facts) ? before.facts : [])).toHaveLength(0);

    const signal = new AbortController().signal;
    const payload = {
      userId,
      characterId,
      sessionId: `${PREFIX}sess`,
      turnId: oldId,
      companionName: "Mira",
      userContent: "My name is Sam.",
      assistantContent: "I am Mira.",
      userOnly: true,
    };
    await runDeferredMemoryPolicy(payload, { signal });
    await runDeferredMemoryPolicy(payload, { signal });

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const facts = policyOf(Array.isArray(memory?.facts) ? memory.facts : []);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.object).toBe("Sam");
    expect(facts[0]?.about).toBe("user");
    expect(facts[0]?.turn_id).toBe(newId);
    expect(facts.some((fact) => fact.about === "companion")).toBe(false);
    await db.delete(chatTurns).where(eq(chatTurns.id, oldId));
    await db.delete(chatTurns).where(eq(chatTurns.id, newId));
  });

  it("does not bring a forgotten fact back on the next memory-policy run", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}forgotten`;
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "kept",
      facts: [
        {
          type: "factual",
          memory_class: "semantic",
          text: "The human's name is Sam.",
          subject: "user",
          predicate: "name",
          object: "Sam",
          about: "user",
          importance: 0.91,
          confidence: 0.9,
          emotional_weight: 0.2,
          identity_relevant: false,
          fact_id: "user-name",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      emotionalState: {},
      resonanceNotes: "",
    });

    const removed = await applyCompanionMemoryChange({
      userId,
      characterId,
      factId: "user-name",
      action: "delete",
    });
    expect(removed.ok).toBe(true);

    await runDeferredMemoryPolicy(
      {
        userId,
        characterId,
        turnId: "turn-again",
        companionName: "Natasha Romanoff",
        userContent: "My name is Sam.",
        assistantContent: "I hear you.",
      },
      { signal: new AbortController().signal },
    );

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    expect(policyOf(facts).some((fact) => /Sam/.test(fact.text))).toBe(false);
    expect(facts.some((item) => isForgottenFact(item) && item.object === "Sam")).toBe(true);
  });

  it("drops an embedding written after the fact was forgotten during the policy job", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}embed-race`;
    const spy = vi
      .spyOn(memoryEmbeddingWrites, "upsertMemoryEmbeddings")
      .mockImplementation(async (opts) => {
        const factId = String(opts.facts[0]?.fact_id || "");
        await applyCompanionMemoryChange({
          userId,
          characterId,
          factId,
          action: "delete",
        });
        await db.insert(memoryEmbeddings).values({
          userId,
          characterId,
          factId,
          text: String(opts.facts[0]?.text || "The human's name is Sam."),
          memoryType: "factual",
          embedding: [0.2, 0.2],
          model: "hash-bow-v1",
        });
        return opts.facts.length;
      });
    try {
      await runDeferredMemoryPolicy(
        {
          userId,
          characterId,
          turnId: "turn-embed",
          companionName: "Natasha Romanoff",
          userContent: "My name is Sam.",
          assistantContent: "I hear you.",
        },
        { signal: new AbortController().signal },
      );
      const [memory] = await db
        .select()
        .from(companionMemories)
        .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
        .limit(1);
      const facts = Array.isArray(memory?.facts) ? memory.facts : [];
      expect(policyOf(facts).some((fact) => /Sam/.test(fact.text))).toBe(false);
      const embeddings = await db
        .select()
        .from(memoryEmbeddings)
        .where(and(eq(memoryEmbeddings.userId, userId), eq(memoryEmbeddings.characterId, characterId)));
      expect(embeddings).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("stops before any write when the slot has already aborted", async () => {
    await expect(
      runDeferredMemoryPolicy(
        {
          userId: `${PREFIX}user`,
          characterId: `${PREFIX}none`,
          userContent: "My name is Sam.",
          assistantContent: "Noted.",
        },
        { signal: AbortSignal.abort() },
      ),
    ).rejects.toBeInstanceOf(DeferredLlmRetryError);
    const rows = await db
      .select()
      .from(companionMemories)
      .where(eq(companionMemories.userId, `${PREFIX}user`));
    expect(rows).toHaveLength(0);
  });
});

describe("a correction survives the next consolidation", () => {
  it("keeps the edited sentence when the same event is seen again", () => {
    const first = consolidateExchange({
      userContent: "Yesterday I walked the bridge.",
      assistantContent: "I will remember that.",
      companionName: "Natasha Romanoff",
    });
    const original = policyOf(first.facts)[0];
    expect(original?.memory_class).toBe("episodic");
    const edited = editCompanionMemoryFact(
      first.facts,
      original?.fact_id || "",
      "The human did this: walked the river.",
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok || !edited.facts) return;

    const again = consolidateExchange({
      userContent: "Yesterday I walked the river.",
      assistantContent: "You said that again.",
      companionName: "Natasha Romanoff",
      existingFacts: edited.facts,
    });
    const kept = policyOf(again.facts).find((fact) => fact.predicate === "did");
    expect(again.promoted).toBe(0);
    expect(kept?.user_edited).toBe(true);
    expect(kept?.text).toBe("The human did this: walked the river.");
    expect(kept?.object).toBe("walked the river");

    const oldAgain = consolidateExchange({
      userContent: "Yesterday I walked the bridge.",
      assistantContent: "That was the other path.",
      companionName: "Natasha Romanoff",
      existingFacts: edited.facts,
    });
    expect(policyOf(oldAgain.facts).some((fact) => /bridge/.test(fact.text) || fact.object === "walked the bridge")).toBe(
      false,
    );
    expect(oldAgain.facts.some((item) => isForgottenFact(item) && item.object === "walked the bridge")).toBe(
      true,
    );
  });
});

describe("a turn write cannot undo a review change", () => {
  async function seedName(characterId: string) {
    const userId = `${PREFIX}user`;
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "kept",
      facts: [
        {
          type: "factual",
          memory_class: "semantic",
          text: "The human's name is Sam.",
          subject: "user",
          predicate: "name",
          object: "Sam",
          about: "user",
          importance: 0.91,
          confidence: 0.9,
          emotional_weight: 0.2,
          identity_relevant: false,
          fact_id: "user-name",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      emotionalState: { selfState: { intensity: 10 } },
      resonanceNotes: "note",
    });
    return userId;
  }

  async function turnWhileLocked(
    userId: string,
    characterId: string,
    mutate: (client: pg.Client) => Promise<void>,
  ) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let writing: Promise<boolean> | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${userId}:${characterId}`]);
      let settled = false;
      writing = persistCompanionTurnFact({
        userId,
        characterId,
        turnFact: {
          type: "turn",
          turn_id: `race-${characterId}`,
          text: "User: later | Companion: still here",
          created_at: "2026-06-02T00:00:00.000Z",
        },
      }).finally(() => {
        settled = true;
      });
      const deadline = Date.now() + 4000;
      while (!settled && Date.now() < deadline) {
        const waiting = await client.query<{ waiting: number }>(
          "SELECT COUNT(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
        );
        if ((waiting.rows[0]?.waiting ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(settled).toBe(false);
      await mutate(client);
      await client.query("COMMIT");
      await writing;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (writing) await writing.catch(() => {});
      throw err;
    } finally {
      await client.end();
    }
  }

  it("keeps a delete that lands while the turn write is waiting", async () => {
    const characterId = `${PREFIX}race-delete`;
    const userId = await seedName(characterId);
    const tombstone = [
      {
        forgotten: true,
        fact_id: "user-name",
        about: "user",
        subject: "user",
        predicate: "name",
        object: "Sam",
        deleted_at: "2026-06-02T00:00:00.000Z",
      },
    ];
    await turnWhileLocked(userId, characterId, async (client) => {
      await client.query(
        "UPDATE companion_memories SET facts = $1::jsonb WHERE user_id = $2 AND character_id = $3",
        [JSON.stringify(tombstone), userId, characterId],
      );
    });
    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    expect(policyOf(facts).some((fact) => /name is Sam/.test(fact.text))).toBe(false);
    expect(facts.some((item) => isForgottenFact(item) && item.object === "Sam")).toBe(true);
    expect(facts.some((item) => item && (item as { turn_id?: string }).turn_id === `race-${characterId}`)).toBe(
      true,
    );
    expect(memory?.summary).toBe("kept");
    expect(memory?.resonanceNotes).toBe("note");
  });

  it("keeps an edit that lands while the turn write is waiting", async () => {
    const characterId = `${PREFIX}race-edit`;
    const userId = await seedName(characterId);
    const corrected = [
      {
        type: "factual",
        memory_class: "semantic",
        text: "The human's name is Samuel.",
        subject: "user",
        predicate: "name",
        object: "Samuel",
        value: "Samuel",
        about: "user",
        importance: 0.91,
        confidence: 0.9,
        emotional_weight: 0.2,
        identity_relevant: false,
        user_edited: true,
        fact_id: "user-name",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-06-02T00:00:00.000Z",
      },
    ];
    await turnWhileLocked(userId, characterId, async (client) => {
      await client.query(
        "UPDATE companion_memories SET facts = $1::jsonb WHERE user_id = $2 AND character_id = $3",
        [JSON.stringify(corrected), userId, characterId],
      );
    });
    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    const saved = policyOf(facts).find((fact) => fact.fact_id === "user-name");
    expect(saved?.text).toBe("The human's name is Samuel.");
    expect(saved?.object).toBe("Samuel");
    expect(saved?.user_edited).toBe(true);
    expect(policyOf(facts).some((fact) => fact.text === "The human's name is Sam.")).toBe(false);
    expect(facts.some((item) => item && (item as { turn_id?: string }).turn_id === `race-${characterId}`)).toBe(
      true,
    );
  });

  it("does not let an in-flight embedding write the old sentence back over a same-id correction", async () => {
    const characterId = `${PREFIX}stale-embed`;
    const userId = await seedName(characterId);
    const corrected = [
      {
        type: "factual",
        memory_class: "semantic",
        text: "The human's name is Samuel.",
        subject: "user",
        predicate: "name",
        object: "Samuel",
        value: "Samuel",
        about: "user",
        importance: 0.91,
        confidence: 0.9,
        emotional_weight: 0.2,
        identity_relevant: false,
        user_edited: true,
        fact_id: "user-name",
        created_at: "2026-04-01T00:00:00.000Z",
        updated_at: "2026-06-02T00:00:00.000Z",
      },
    ];
    await db.insert(memoryEmbeddings).values({
      userId,
      characterId,
      factId: "user-name",
      text: "The human's name is Samuel.",
      memoryType: "factual",
      embedding: [0.4, 0.6],
      model: "hash-bow-v1",
    });

    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let writing: Promise<number> | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${userId}:${characterId}`]);
      let settled = false;
      writing = upsertMemoryEmbeddings({
        userId,
        characterId,
        facts: [
          {
            type: "factual",
            fact_id: "user-name",
            text: "The human's name is Sam.",
          },
        ],
      }).finally(() => {
        settled = true;
      });
      const deadline = Date.now() + 4000;
      while (!settled && Date.now() < deadline) {
        const waiting = await client.query<{ waiting: number }>(
          "SELECT COUNT(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
        );
        if ((waiting.rows[0]?.waiting ?? 0) > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(settled).toBe(false);
      await client.query(
        "UPDATE companion_memories SET facts = $1::jsonb WHERE user_id = $2 AND character_id = $3",
        [JSON.stringify(corrected), userId, characterId],
      );
      await client.query("COMMIT");
      await expect(writing).resolves.toBe(0);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      if (writing) await writing.catch(() => {});
      throw err;
    } finally {
      await client.end();
    }

    const rows = await db
      .select()
      .from(memoryEmbeddings)
      .where(and(eq(memoryEmbeddings.userId, userId), eq(memoryEmbeddings.characterId, characterId)));
    expect(rows.map((row) => row.text)).toEqual(["The human's name is Samuel."]);
    expect(rows.some((row) => row.text === "The human's name is Sam.")).toBe(false);
  });

  it("forgets the source turn and its embedding so the forgotten name cannot reach the prompt", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}forget-prompt`;
    const turnText = "User: My name is Sam. | Companion: I hear you.";
    const city = "The human lives in Lisbon.";
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "kept",
      facts: [
        {
          type: "turn",
          turn_id: "name-turn",
          text: turnText,
          created_at: "2026-06-01T00:00:00.000Z",
        },
        {
          type: "factual",
          memory_class: "semantic",
          text: "The human's name is Sam.",
          subject: "user",
          predicate: "name",
          object: "Sam",
          about: "user",
          importance: 0.91,
          confidence: 0.9,
          emotional_weight: 0.2,
          identity_relevant: false,
          fact_id: "user-name",
          turn_id: "name-turn",
          created_at: "2026-04-01T00:00:00.000Z",
        },
        {
          type: "factual",
          memory_class: "semantic",
          text: city,
          subject: "user",
          predicate: "lives_in",
          object: "Lisbon",
          about: "user",
          importance: 0.7,
          confidence: 0.8,
          emotional_weight: 0.1,
          identity_relevant: false,
          fact_id: "user-city",
          created_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      emotionalState: {},
      resonanceNotes: "",
    });
    await db.insert(memoryEmbeddings).values([
      {
        userId,
        characterId,
        factId: factIdFor(turnText),
        text: turnText,
        memoryType: "turn",
        embedding: [0.1, 0.1],
        model: "hash-bow-v1",
      },
      {
        userId,
        characterId,
        factId: "user-name",
        text: "The human's name is Sam.",
        memoryType: "factual",
        embedding: [0.2, 0.2],
        model: "hash-bow-v1",
      },
      {
        userId,
        characterId,
        factId: "user-city",
        text: city,
        memoryType: "factual",
        embedding: [0.3, 0.3],
        model: "hash-bow-v1",
      },
    ]);

    const removed = await applyCompanionMemoryChange({
      userId,
      characterId,
      factId: "user-name",
      action: "delete",
    });
    expect(removed.ok).toBe(true);

    const [memory] = await db
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const facts = Array.isArray(memory?.facts) ? memory.facts : [];
    expect(facts.some((item) => item && (item as { type?: string }).type === "turn")).toBe(false);
    expect(JSON.stringify(facts)).not.toMatch(/My name is Sam/);

    const rows = await db
      .select()
      .from(memoryEmbeddings)
      .where(and(eq(memoryEmbeddings.userId, userId), eq(memoryEmbeddings.characterId, characterId)));
    expect(rows.map((row) => row.factId)).toEqual(["user-city"]);

    const prompt = formatMemoriesForPrompt(
      retrieveRelevantMemories([{ characterId, facts }], { contextHint: "what is my name Sam", topK: 8 }),
      new Map(),
    );
    expect(prompt).not.toMatch(/\bSam\b/);
    expect(prompt).toMatch(/Lisbon/);

    const hits = await searchMemoriesSemantically({
      userId,
      characterId,
      query: "what is my name Sam",
      topK: 8,
    });
    expect(hits.map((hit) => hit.text).join("\n")).not.toMatch(/\bSam\b/);
  });

  it("re-embeds the corrected sentence and leaves a different fact that shares the new wording", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}reembed`;
    const decoyText = "The human's name is Samuel.";
    await db.insert(companionMemories).values({
      userId,
      characterId,
      summary: "kept",
      facts: [
        {
          type: "factual",
          memory_class: "semantic",
          text: "The human's name is Sam.",
          subject: "user",
          predicate: "name",
          object: "Sam",
          about: "user",
          importance: 0.91,
          confidence: 0.9,
          emotional_weight: 0.2,
          identity_relevant: false,
          fact_id: "user-name",
          created_at: "2026-04-01T00:00:00.000Z",
        },
        {
          type: "factual",
          memory_class: "semantic",
          text: decoyText,
          subject: "companion",
          predicate: "kept",
          object: "a note",
          about: "companion",
          importance: 0.4,
          confidence: 0.5,
          emotional_weight: 0.1,
          identity_relevant: false,
          fact_id: "her-note",
          created_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      emotionalState: {},
      resonanceNotes: "",
    });
    await db.insert(memoryEmbeddings).values([
      {
        userId,
        characterId,
        factId: "user-name",
        text: "The human's name is Sam.",
        memoryType: "factual",
        embedding: [0.1, 0.2],
        model: "hash-bow-v1",
      },
      {
        userId,
        characterId,
        factId: "her-note",
        text: decoyText,
        memoryType: "factual",
        embedding: [0.9, 0.1],
        model: "hash-bow-v1",
      },
    ]);

    const edited = await applyCompanionMemoryChange({
      userId,
      characterId,
      factId: "user-name",
      action: "edit",
      text: "The human's name is Samuel.",
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.focusFactId).toBeTruthy();
    expect(edited.focusFactId).not.toBe("her-note");

    const afterEdit = await db
      .select()
      .from(memoryEmbeddings)
      .where(and(eq(memoryEmbeddings.userId, userId), eq(memoryEmbeddings.characterId, characterId)));
    expect(afterEdit.map((row) => row.factId)).toEqual(["her-note"]);

    const job = buildMemoryReembedJob({
      userId,
      characterId,
      factId: edited.focusFactId,
    });
    expect(job?.kind).toBe("memory-policy");
    expect(job?.payload.reembedOnly).toBe(true);
    expect(job?.payload.factId).toBe(edited.focusFactId);

    await runDeferredMemoryPolicy(job?.payload || {}, { signal: new AbortController().signal });

    const rows = await db
      .select()
      .from(memoryEmbeddings)
      .where(and(eq(memoryEmbeddings.userId, userId), eq(memoryEmbeddings.characterId, characterId)));
    const byId = new Map(rows.map((row) => [row.factId, row.text]));
    expect(byId.get("her-note")).toBe(decoyText);
    expect(byId.get(edited.focusFactId || "")).toBe("The human's name is Samuel.");
    expect(rows.some((row) => row.text === "The human's name is Sam.")).toBe(false);
    expect(rows.every((row) => row.model === "hash-bow-v1")).toBe(true);
  });
});

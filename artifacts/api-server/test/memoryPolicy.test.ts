import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  companionMemories,
  db,
  ensureSchemaOnce,
  userEntities,
  userProfiles,
} from "@workspace/db";
import { CONTINUE_USER_TURN } from "../src/lib/promptBuilder";
import { DeferredLlmRetryError } from "../src/lib/deferredLocalLlm";
import {
  IMPORTANCE_WEIGHTS,
  appendTurnMemoryFact,
  buildMemoryPolicyJob,
  consolidateExchange,
  decideMemoryCandidate,
  isPolicyFact,
  memoryPolicySignals,
  policyDedupeKey,
  policyFactId,
  runDeferredMemoryPolicy,
  scoreImportance,
  type PolicyFact,
} from "../src/lib/memoryPolicy";
import { retrieveRelevantMemories } from "../src/lib/memoryRetrieval";

const PREFIX = `mempol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;

function policyOf(facts: unknown[]): PolicyFact[] {
  return facts.filter(isPolicyFact);
}

beforeAll(async () => {
  await ensureSchemaOnce();
});

afterEach(async () => {
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
    expect((next || []).filter((item) => !isPolicyFact(item))).toHaveLength(24);
    expect(appendTurnMemoryFact(next || [], { type: "turn", turn_id: "t-new", text: "dup" })).toBe(
      null,
    );
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

import { describe, expect, it } from "vitest";
import {
  buildSacredSpaceExperience,
  experiencePromptText,
  forgetSacredSpaceExperience,
  loadSacredSpaceExperiences,
  recordSacredSpaceExperience,
  shareSacredSpaceExperience,
  unshareSacredSpaceExperience,
  type SacredSpaceExperience,
  type SacredSpaceStore,
} from "../src/lib/mind/sacredSpace";
import { formatKnowledgeBlock, packKnowledge, rankKnowledge } from "../src/lib/mind/hybridRecall";
import { knowledgeCandidates } from "../src/lib/mind/mindContext";
import { composeCompanionChatMessages, type CharacterData } from "../src/lib/promptBuilder";
import { dialoguePlanNote, detectTemperament, staleReassurances } from "../src/lib/mind/dialoguePlan";

/** In-memory twin of pgSacredSpaceStore: same (user, character) scoping, dedupe and retraction rules. */
function memoryStore() {
  const rows: Array<SacredSpaceExperience & { dedupeKey: string }> = [];
  const retracted = new Set<string>();
  let n = 0;
  const live = (e: SacredSpaceExperience) => !retracted.has(e.id);
  const store: SacredSpaceStore = {
    async insert(e) {
      if (rows.some((r) => r.userId === e.userId && r.dedupeKey === e.dedupeKey)) return null;
      const id = `ev-${++n}`;
      rows.push({ ...e, id });
      return id;
    },
    async list(userId, characterId, limit) {
      return rows
        .filter((r) => r.userId === userId && r.characterId === characterId && live(r))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
        .slice(0, limit);
    },
    async get(userId, id) {
      return rows.find((r) => r.userId === userId && r.id === id && live(r)) ?? null;
    },
    async copiesOf(userId, id) {
      return rows.filter((r) => r.userId === userId && r.payload.shared_from_event_id === id && live(r));
    },
    async retract(_u, e) {
      retracted.add(e.id);
    },
  };
  return store;
}

const U = "user_1";
const SCARLETT = "scarlett";
const SERENITY = "serenity";
const SECRET = "pressure to make Anima perfect and never rest";
const transcript = [
  { role: "assistant", content: "Welcome." },
  { role: "user", content: `I keep feeling the ${SECRET}, it follows me everywhere.` },
  { role: "user", content: "ok" },
];
const session = (over: Record<string, unknown> = {}) => ({
  userId: U,
  characterId: SCARLETT,
  characterName: "Scarlett",
  sessionId: "sess-1",
  ritualFocus: "clarity",
  transcript,
  reflection: "I should let myself enjoy building it.",
  ...over,
});

describe("Sacred Space experiential memory", () => {
  it("records a structured digest without the transcript or invented emotion", () => {
    const e = buildSacredSpaceExperience(session({ reflection: "" }))!;
    expect(e.payload).toMatchObject({ kind: "sacred_space_experience", session_id: "sess-1", ritual_focus: "clarity", has_reflection: false, reflection: null });
    expect(e.payload.disclosures).toEqual([expect.stringContaining(SECRET)]);
    expect(e.content).toContain("left no written reflection");
    expect(e.content).not.toContain("Welcome.");
    expect(e.emotionalWeight).toBe(0.5);
    expect(buildSacredSpaceExperience(session({ sessionId: "" }))).toBeNull();
  });

  it("Character A recalls its own session; Character B cannot", async () => {
    const store = memoryStore();
    await recordSacredSpaceExperience(store, session());
    const a = await loadSacredSpaceExperiences(store, U, SCARLETT);
    expect(a).toHaveLength(1);
    expect(experiencePromptText(a[0]!)).toContain("you were there");
    expect(await loadSacredSpaceExperiences(store, U, SERENITY)).toEqual([]);
    expect(await loadSacredSpaceExperiences(store, "other_user", SCARLETT)).toEqual([]);
    expect(await loadSacredSpaceExperiences(store, U, "")).toEqual([]);
  });

  it("is idempotent per session id", async () => {
    const store = memoryStore();
    const first = await recordSacredSpaceExperience(store, session());
    const again = await recordSacredSpaceExperience(store, session());
    expect(first?.duplicate).toBe(false);
    expect(again).toEqual({ id: null, duplicate: true });
    expect(await loadSacredSpaceExperiences(store, U, SCARLETT)).toHaveLength(1);
  });

  it("shares only on explicit action, framed as not-your-session, and can be revoked", async () => {
    const store = memoryStore();
    const rec = await recordSacredSpaceExperience(store, session());
    expect(await loadSacredSpaceExperiences(store, U, SERENITY)).toEqual([]);
    const shared = await shareSacredSpaceExperience(store, { userId: U, eventId: rec!.id!, fromCharacterId: SCARLETT, toCharacterId: SERENITY });
    expect(shared).toBeTruthy();
    const seen = await loadSacredSpaceExperiences(store, U, SERENITY);
    expect(experiencePromptText(seen[0]!)).toContain("they were with Scarlett, not you");
    expect(await loadSacredSpaceExperiences(store, U, "third")).toEqual([]);
    expect(await unshareSacredSpaceExperience(store, { userId: U, eventId: rec!.id!, fromCharacterId: SCARLETT, toCharacterId: SERENITY })).toBe(1);
    expect(await loadSacredSpaceExperiences(store, U, SERENITY)).toEqual([]);
    expect(await loadSacredSpaceExperiences(store, U, SCARLETT)).toHaveLength(1);
  });

  it("refuses to share from a character that does not own the experience, or another user's", async () => {
    const store = memoryStore();
    const rec = await recordSacredSpaceExperience(store, session());
    expect(await shareSacredSpaceExperience(store, { userId: U, eventId: rec!.id!, fromCharacterId: SERENITY, toCharacterId: "third" })).toBeNull();
    expect(await shareSacredSpaceExperience(store, { userId: "evil", eventId: rec!.id!, fromCharacterId: SCARLETT, toCharacterId: "third" })).toBeNull();
  });

  it("forgetting removes the experience and shared copies from retrieval and the prompt block", async () => {
    const store = memoryStore();
    const rec = await recordSacredSpaceExperience(store, session());
    await shareSacredSpaceExperience(store, { userId: U, eventId: rec!.id!, fromCharacterId: SCARLETT, toCharacterId: SERENITY });
    expect(await forgetSacredSpaceExperience(store, { userId: U, eventId: rec!.id!, characterId: SERENITY })).toBe(0);
    expect(await forgetSacredSpaceExperience(store, { userId: U, eventId: rec!.id!, characterId: SCARLETT })).toBe(2);
    for (const c of [SCARLETT, SERENITY]) {
      const exp = await loadSacredSpaceExperiences(store, U, c);
      const ranked = rankKnowledge(knowledgeCandidates([], [], exp), { query: "pressure" });
      const block = formatKnowledgeBlock(packKnowledge(ranked, "", 2000));
      expect(block).not.toContain(SECRET);
    }
  });

  it("retention expires an experience without a write", async () => {
    const store = memoryStore();
    await recordSacredSpaceExperience(store, session({ retentionDays: 7, occurredAt: "2026-01-01T00:00:00Z" }));
    expect(await loadSacredSpaceExperiences(store, U, SCARLETT, 6, Date.parse("2026-01-05T00:00:00Z"))).toHaveLength(1);
    expect(await loadSacredSpaceExperiences(store, U, SCARLETT, 6, Date.parse("2026-02-01T00:00:00Z"))).toEqual([]);
  });

  it("surfaces in the chat mind block, and the generic recall path cannot bypass scoping", async () => {
    const store = memoryStore();
    await recordSacredSpaceExperience(store, session());
    const own = await loadSacredSpaceExperiences(store, U, SCARLETT);
    const leakedByRecall = [
      { id: "x", event_type: "milestone", content: "LEAK", payload: { kind: "sacred_space_experience" }, conversation_id: null, occurred_at: new Date().toISOString(), emotional_weight: 0.9, similarity: 0.9, recency: 1, score: 1 },
    ];
    const text = (exp: SacredSpaceExperience[]) =>
      formatKnowledgeBlock(packKnowledge(rankKnowledge(knowledgeCandidates([], leakedByRecall, exp), { query: "pressure" }), "", 2000));
    expect(text(own)).toContain(SECRET);
    expect(text(own)).not.toContain("LEAK");
    expect(text([])).toBe("");
  });

  it("group chat does not hand one speaker's private session to another (SEC-001 path)", () => {
    const mk = (id: string, name: string): CharacterData => ({ id, name, personality: "x", speaking_style: "y", universe: "u" });
    const scarlett = mk(SCARLETT, "Scarlett");
    const serenity = mk(SERENITY, "Serenity");
    const messages = composeCompanionChatMessages({
      characters: [scarlett, serenity],
      activeCharacter: undefined as unknown as CharacterData,
      memories: [],
      recentMessages: [],
      content: "hi both",
      mode: "group",
      isCrossover: true,
      memoryCoreContext: "",
    } as never);
    expect(JSON.stringify(messages)).not.toContain(SECRET);
  });
});

describe("dialogue plan", () => {
  const sharp = { name: "Scarlett", personality: "Sarcastic, dry wit, blunt", speaking_style: "Clipped, teasing" };
  const quiet = { name: "Mira", personality: "Quiet, guarded", speaking_style: "Short sentences" };

  it("is deterministic and adds no model request (pure function)", () => {
    const input = { userText: "long day", recentReplies: ["Hm."], character: sharp };
    expect(dialoguePlanNote(input)).toBe(dialoguePlanNote(input));
  });

  it("reads temperament from the character's own identity", () => {
    expect(detectTemperament(sharp)).toBe("sharp");
    expect(detectTemperament(quiet)).toBe("quiet");
    expect(detectTemperament(null)).toBe("neutral");
    expect(dialoguePlanNote({ userText: "ugh, monday", recentReplies: [], character: quiet })).toContain("economical");
  });

  it("stops uniformly interrogative replies", () => {
    const note = dialoguePlanNote({
      userText: "just got home",
      recentReplies: ["How was it?", "What happened next?", "And then?"],
      character: sharp,
    });
    expect(note).toContain("end this one on a statement");
    expect(dialoguePlanNote({ userText: "why is the sky blue?", recentReplies: [], character: sharp })).toContain("Answer what they asked first");
  });

  it("breaks same-length rhythm and retires stock reassurance", () => {
    const same = ["one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty."];
    const note = dialoguePlanNote({
      userText: "tell me something about your day please",
      recentReplies: [...same, ...same, "I'm here for you. " + same[0]],
      character: sharp,
    });
    expect(note).toContain("break that rhythm");
    expect(note).toContain('"I\'m here for you"');
    expect(staleReassurances(["Fine."])).toEqual([]);
  });

  it("varies the beat across turns and keeps recall optional and mood temporary", () => {
    const beats = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const n = dialoguePlanNote({ userText: `message number ${i} about things`, recentReplies: Array(i % 4).fill("ok."), character: sharp });
      beats.add(n.split("This turn, if it fits you: ")[1]!.split(".")[0]!);
    }
    expect(beats.size).toBeGreaterThan(2);
    const n = dialoguePlanNote({ userText: "hey", recentReplies: [], character: sharp, hasMemory: true, hasMood: true });
    expect(n).toContain("only if it bears on what they just said");
    expect(n).toContain("for this reply only");
    expect(n).not.toMatch(/sound human/i);
  });

  it("matches brevity and distinguishes registers", () => {
    expect(dialoguePlanNote({ userText: "k", recentReplies: [], character: sharp })).toContain("Match their brevity");
    expect(dialoguePlanNote({ userText: "I'm so anxious and scared tonight about everything", recentReplies: [], character: sharp })).toContain("steady and specific");
    expect(dialoguePlanNote({ userText: "*opens the door*", recentReplies: [], character: sharp })).toContain("Stay inside the scene");
  });
});

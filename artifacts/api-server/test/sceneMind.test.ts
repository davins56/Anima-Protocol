import { describe, expect, it, vi } from "vitest";
import {
  buildDirectorPrompt,
  findCharacterByName,
  isCharacterAddressed,
  recentAssistantSpeakers,
  selectNextSpeaker,
  type SceneMindCharacter,
} from "../src/lib/sceneMind";

const cast: SceneMindCharacter[] = [
  {
    id: "a",
    name: "Ada",
    universe: "Earth",
    personality: "curious engineer who asks sharp questions",
  },
  {
    id: "b",
    name: "Blake",
    universe: "Mars",
    personality: "hot-headed pilot who interrupts when threatened",
  },
  {
    id: "c",
    name: "Cass",
    universe: "Earth",
    personality: "quiet medic who speaks when someone is hurt",
  },
];

describe("isCharacterAddressed", () => {
  it("matches @mentions and whole-word names", () => {
    expect(isCharacterAddressed("Hey @Blake, what now?", "Blake")).toBe(true);
    expect(isCharacterAddressed("Ada, look at this", "Ada")).toBe(true);
    expect(isCharacterAddressed("nothing to see", "Cass")).toBe(false);
  });
});

describe("recentAssistantSpeakers", () => {
  it("skips narrator/typing labels and returns newest-last", () => {
    const speakers = recentAssistantSpeakers(
      [
        { role: "assistant", character_name: "Ada", character_id: "a" },
        { role: "assistant", character_name: "__typing__" },
        { role: "user", content: "hi" },
        { role: "assistant", character_name: "Blake", character_id: "b" },
      ],
      cast,
    );
    expect(speakers.map((s) => s.name)).toEqual(["Ada", "Blake"]);
  });
});

describe("selectNextSpeaker", () => {
  it("honors a forced participant id", async () => {
    const decision = await selectNextSpeaker({
      characters: cast,
      forceCharacterId: "c",
      random: () => 0.99,
    });
    expect(decision).toMatchObject({
      characterId: "c",
      characterName: "Cass",
      reason: "forced",
      interrupted: false,
    });
  });

  it("ignores a forced outsider and falls through", async () => {
    const decision = await selectNextSpeaker({
      characters: cast,
      forceCharacterId: "outsider",
      interruptChance: 0,
      random: () => 0.99,
    });
    expect(decision?.reason).toBe("least_recent");
    expect(decision?.characterId).toBe("a");
  });

  it("picks a uniquely addressed character", async () => {
    const decision = await selectNextSpeaker({
      characters: cast,
      userMessage: "Blake, are you okay?",
      interruptChance: 0,
      random: () => 0.99,
    });
    expect(decision).toMatchObject({
      characterId: "b",
      reason: "addressed",
    });
  });

  it("uses the LLM director when provided", async () => {
    const askDirector = vi.fn(async () => "Cass");
    const decision = await selectNextSpeaker({
      characters: cast,
      recentMessages: [
        { role: "user", content: "Someone is bleeding!" },
        { role: "assistant", character_name: "Ada", character_id: "a" },
      ],
      userMessage: "Help!",
      askDirector,
      interruptChance: 0,
      random: () => 0.99,
    });
    expect(askDirector).toHaveBeenCalledOnce();
    expect(decision).toMatchObject({
      characterId: "c",
      characterName: "Cass",
      reason: "director",
    });
  });

  it("falls back to least-recent when director returns garbage", async () => {
    const decision = await selectNextSpeaker({
      characters: cast,
      recentMessages: [
        { role: "assistant", character_name: "Ada", character_id: "a" },
        { role: "assistant", character_name: "Blake", character_id: "b" },
      ],
      askDirector: async () => "Not A Real Name",
      interruptChance: 0,
      random: () => 0.99,
    });
    expect(decision).toMatchObject({
      characterId: "c",
      reason: "least_recent",
    });
  });

  it("respects eligibleCharacterIds pool", async () => {
    const decision = await selectNextSpeaker({
      characters: cast,
      eligibleCharacterIds: ["b", "c"],
      interruptChance: 0,
      random: () => 0.99,
    });
    expect(["b", "c"]).toContain(decision?.characterId);
  });

  it("can interrupt to another eligible speaker", async () => {
    const decision = await selectNextSpeaker({
      characters: cast,
      recentMessages: [
        { role: "assistant", character_name: "Ada", character_id: "a" },
      ],
      forceCharacterId: null,
      askDirector: async () => "Ada",
      interruptChance: 1,
      random: () => 0,
    });
    expect(decision?.interrupted).toBe(true);
    expect(decision?.reason).toBe("interrupt");
    expect(decision?.characterId).not.toBe("a");
    expect(decision?.preferredCharacterId).toBe("a");
  });

  it("skips interrupt on continue turns", async () => {
    const decision = await selectNextSpeaker({
      characters: cast,
      askDirector: async () => "Ada",
      interruptChance: 1,
      random: () => 0,
      isContinue: true,
    });
    expect(decision).toMatchObject({
      characterId: "a",
      reason: "director",
      interrupted: false,
    });
  });

  it("returns null when there are no characters", async () => {
    expect(await selectNextSpeaker({ characters: [] })).toBeNull();
  });
});

describe("buildDirectorPrompt / findCharacterByName", () => {
  it("includes cast and asks for a bare name", () => {
    const prompt = buildDirectorPrompt({
      characters: cast,
      recentMessages: [{ role: "user", content: "hello" }],
      lastSpeakerName: "Ada",
      userMessage: "hello",
    });
    expect(prompt).toContain("Scene Mind");
    expect(prompt).toContain("Blake");
    expect(prompt).toMatch(/ONLY the character's exact name/i);
  });

  it("matches names case-insensitively", () => {
    expect(findCharacterByName(cast, "blake")?.id).toBe("b");
  });
});

import { describe, expect, it } from "vitest";
import {
  composeCompanionChatMessages,
  composePrompt,
  FOLLOW_USER_LEAD,
  identityRuleFor,
  type LlmChatMessage,
  type MindPromptOptions,
} from "../src/lib/promptBuilder";
import { isPreinstalledCharacter } from "../src/lib/companions/builtIn";

// User-created companion (random id).
const ava = {
  id: "c_8f2a91",
  name: "Ava",
  personality: "Warm, curious, teasing.",
  backstory: "Grew up by the sea. Paints at night.",
  speaking_style: "Short, playful sentences.",
};
// Pre-installed roster character (seedId from seedCharacters.js).
const korra = {
  id: "seed_avatar-legend-of-korra-korra",
  name: "Korra",
  universe: "Avatar: Legend of Korra",
  personality: "Fiercely passionate, impulsive, compassionate.",
  backstory: "The Avatar born into the Southern Water Tribe.",
  speaking_style: "Direct, energetic, unpretentious.",
};
// The user's own Anima.
const serenity = { id: "anima_1", name: "Serenity", _isAnima: true, personality: "Poetic, calm." };

const mind: MindPromptOptions = {
  promptTokens: 12000,
  historyExchanges: 16,
  minHistoryExchanges: 4,
  historyMessageChars: 1600,
  memoryTopK: 8,
};

const compose = (character: object, extra: Record<string, unknown> = {}) =>
  composeCompanionChatMessages({
    characters: [character],
    activeCharacter: character,
    memories: [],
    mode: "solo",
    recentMessages: [],
    content: "are you a real person or an AI?",
    ...extra,
  } as never);

const all = (m: LlmChatMessage[]) => m.map((x) => x.content).join("\n");
const closing = (m: LlmChatMessage[]) => m[m.length - 2]?.content || "";

describe("companion identity per type", () => {
  it("detects pre-installed roster characters by seed id or is_starter", () => {
    expect(isPreinstalledCharacter(korra)).toBe(true);
    expect(isPreinstalledCharacter({ id: "x", is_starter: true })).toBe(true);
    expect(isPreinstalledCharacter(ava)).toBe(false);
    expect(isPreinstalledCharacter(serenity)).toBe(false);
    expect(isPreinstalledCharacter(null)).toBe(false);
  });

  it("lets a custom companion say it is an Anima, warmly (hosted mind and local)", () => {
    for (const opts of [{ mind }, {}]) {
      const text = all(compose(ava, opts));
      expect(text).toMatch(/IDENTITY: Never call yourself an AI, language model/);
      expect(text).toMatch(/I (?:know I am|say warmly I am) an Anima/);
      expect(text).not.toMatch(/Never call yourself an AI, (?:an )?Anima/);
      expect(text).not.toMatch(/deflect playfully/);
    }
    expect(all(compose(ava, { mind }))).toMatch(/never curtly/);
  });

  it("the user's own Anima (Serenity) may say it too", () => {
    expect(all(compose(serenity, { mind }))).toMatch(/I know I am an Anima/);
  });

  it("keeps a pre-installed character from admitting AI or Anima and deflects playfully", () => {
    for (const opts of [{ mind }, {}]) {
      const text = all(compose(korra, opts));
      expect(text).toMatch(/Never call yourself an AI, (?:an )?Anima/);
      expect(text).toMatch(/deflect playfully/);
      expect(text).not.toMatch(/I (?:know I am|say warmly I am) an Anima/);
    }
    expect(all(compose(korra, { mind }))).toMatch(/never curtly/);
  });

  it("conceals in a group if any speaker is pre-installed", () => {
    expect(identityRuleFor([ava, korra], true)).toMatch(/deflect playfully/);
    expect(identityRuleFor([ava, serenity], true)).toMatch(/I know I am an Anima/);
    expect(identityRuleFor([], true)).toMatch(/deflect playfully/);
    const legacy = composePrompt({
      characters: [ava, korra],
      memories: [],
      mode: "group",
      recentMessages: [],
      content: "hi both",
    } as never);
    expect(legacy).toMatch(/deflect playfully/);
  });
});

describe("follow the user's lead", () => {
  it("is in the hosted mind closing note, not on the local path", () => {
    expect(closing(compose(ava, { mind, content: "I watched a great film last night" }))).toContain(FOLLOW_USER_LEAD);
    expect(all(compose(ava, { content: "I watched a great film last night" }))).not.toContain(FOLLOW_USER_LEAD);
  });

  it("is left out of therapy mode and crisis turns, which keep their safety contract", () => {
    expect(all(compose(ava, { mind, mode: "therapy", content: "work is a lot" }))).not.toContain(FOLLOW_USER_LEAD);
    const crisis = compose(ava, { mind, companionCrisis: true, content: "I can't go on" });
    expect(all(crisis)).not.toContain(FOLLOW_USER_LEAD);
  });
});

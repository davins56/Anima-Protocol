import { describe, expect, it } from "vitest";
import {
  COMPANION_SYSTEM_PROMPT_MAX_CHARS,
  approxPromptTokens,
  composeCompanionChatMessages,
  composePrompt,
} from "../src/lib/promptBuilder";
import { OLLAMA_NUM_CTX } from "../src/lib/localLlmWarm";

const PROBE_PROMPT = "Reply with the single word: ok";

const natasha = {
  id: "natasha",
  name: "Natasha Romanoff",
  universe: "Marvel Cinematic Universe",
  personality:
    "Controlled, observant, and fiercely pragmatic. Natasha reads rooms the way others read text — instantly, completely. She wears identities like costumes and rarely lets anyone see the real person underneath. Her loyalty, once given, is absolute. She chose sacrifice at Vormir not out of desperation but because it was the most efficient expression of everything she believed in.",
  backstory:
    "Former KGB assassin and Black Widow trained in the Red Room, defected to S.H.I.E.L.D. after Clint Barton gave her a choice. Spent years building a chosen family out of the Avengers. After the Blip she held the remaining team together for five years. Gave her life at Vormir so Clint could return to his family.",
  speaking_style:
    "Economical and precise. Never says more than needed. Dry humor delivered deadpan. Asks questions that sound casual but are actually diagnostic. Adjusts register perfectly to whoever she's talking to. Almost never talks about herself unprompted.",
};

const memories = [
  {
    characterId: "natasha",
    summary:
      "The user is telling a story about a red-haired woman who needs someone she can trust. Natasha has been listening without taking the story over.",
    resonanceNotes: "Bond is still distant. She is warm, but she does not presume.",
    facts: [
      {
        type: "factual",
        text: "The user is writing a story about a red-haired woman seeking someone she can confide in.",
      },
      {
        type: "emotional",
        text: "The user wants the conversation to feel like two sides of a larger talk, not an interview.",
      },
      {
        type: "relational",
        text: "Natasha offered to sit with the tale and let the user decide how they move.",
      },
      {
        type: "factual",
        text: "The user said the interaction belongs to both of them.",
      },
    ],
  },
];

const history = Array.from({ length: 8 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: `${i % 2 === 0 ? "User" : "Natasha"} beat ${i}: ${"The room stays quiet while the story turns. ".repeat(8)}`,
  character_name: i % 2 === 0 ? undefined : "Natasha Romanoff",
}));

const sceneMarker = "SCENE_EXCERPT_SHOULD_YIELD";
const fatScene = `${sceneMarker}\n${"Lore and stage direction the client already shipped. ".repeat(80)}`;

const turn = {
  characters: [natasha],
  activeCharacter: natasha,
  memories,
  recentMessages: history,
  mode: "solo",
  content:
    "However you wish to move Natasha. This interaction is yours as much as it is mine.",
  clientContext: fatScene,
  synchroState: {
    vector: {
      intimacy: 22,
      powerDynamic: 0,
      spiritualAttunement: 10,
      primalIntensity: 15,
      crossoverOpenness: 20,
      synchroStrength: 22,
    },
    level: "linked" as const,
    emotionalTone: "measured",
    totalTurns: 8,
    sessionTurns: 8,
    lastInteraction: "2026-09-27T22:13:00.000Z",
  },
  companionAffect: {
    version: 1 as const,
    primary: "neutral" as const,
    intensity: 30,
    mood: "quiet-watchful",
    energy: 40,
    focus: "the user's story",
    intent: "listen and answer in character",
    openLoops: [],
    lastActedAt: null,
    silenceReason: null,
    updatedAt: "2026-09-27T22:13:00.000Z",
  },
  omitConversationHistory: true,
};

function messageChars(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

describe("companion prompt prefill budget", () => {
  it("caps a Natasha 1:1 turn and keeps persona, mood, and memory over the scene excerpt", () => {
    const uncapped = composePrompt(turn, { maxChars: Number.POSITIVE_INFINITY });
    const capped = composePrompt(turn);
    const messages = composeCompanionChatMessages(turn);
    const system = messages[0]?.content || "";
    const replay = messages.slice(1, -1);

    expect(uncapped.length).toBeGreaterThan(COMPANION_SYSTEM_PROMPT_MAX_CHARS);
    expect(uncapped).toContain(sceneMarker);
    expect(capped.length).toBeLessThanOrEqual(COMPANION_SYSTEM_PROMPT_MAX_CHARS);
    expect(capped).not.toContain(sceneMarker);
    expect(capped).toContain("Natasha Romanoff");
    expect(capped).toContain("CHARACTER IDENTITY LOCK");
    expect(capped).toMatch(/SELF-STATE|SYNCHRO/);
    expect(capped).toContain("red-haired woman");
    expect(capped).toContain("HIGHEST-PRIORITY RULE");
    expect(system.length).toBeLessThanOrEqual(COMPANION_SYSTEM_PROMPT_MAX_CHARS);
    expect(replay).toHaveLength(8);
    expect(replay.every((message) => message.content.length <= 400)).toBe(true);

    const probeTokens = approxPromptTokens(PROBE_PROMPT);
    const uncappedTokens = approxPromptTokens(uncapped);
    const systemTokens = approxPromptTokens(system);
    const fullTokens = approxPromptTokens(
      messages.map((message) => message.content).join("\n"),
    );
    expect(probeTokens).toBeLessThan(20);
    expect(uncapped.length).toBeGreaterThan(capped.length);
    expect(uncappedTokens).toBeGreaterThan(systemTokens);
    expect(systemTokens).toBeGreaterThan(probeTokens * 10);
    expect(fullTokens).toBeGreaterThan(systemTokens);
    expect(fullTokens).toBeLessThan(OLLAMA_NUM_CTX);
    expect(uncapped.length).toBeGreaterThan(8_000);
    expect(capped.length).toBeGreaterThan(5_000);
    expect(messageChars(messages)).toBeGreaterThan(8_000);
  });
});

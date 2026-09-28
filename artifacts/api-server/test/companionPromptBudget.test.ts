import { describe, expect, it } from "vitest";
import {
  COMPANION_SYSTEM_PROMPT_MAX_CHARS,
  LOCAL_PROMPT_MAX_TOKENS,
  LOCAL_PROMPT_SAFETY_MARGIN_TOKENS,
  OLLAMA_N_CTX,
  approxPromptTokens,
  companionLocalSections,
  companionStaticPrefix,
  composeCompanionChatMessages,
  composePrompt,
  estimateLocalPromptTokens,
  localPromptHardMaxTokens,
} from "../src/lib/promptBuilder";
import { OLLAMA_NUM_CTX } from "../src/lib/localLlmWarm";
import { OLLAMA_NUM_PREDICT_CAP } from "../src/lib/ollamaChat";
import { PDF_CONTEXT_WORD_BUDGET } from "../src/lib/pdf/limits";

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
    expect(system.startsWith(companionStaticPrefix(turn))).toBe(true);
    expect(replay.every((message) => message.content.length <= 400)).toBe(true);
    expect(messages.at(-1)?.content).toContain("However you wish to move");

    const probeTokens = approxPromptTokens(PROBE_PROMPT);
    const uncappedTokens = approxPromptTokens(uncapped);
    const fullTokens = estimateLocalPromptTokens(
      messages.map((message) => message.content).join("\n"),
    );
    expect(probeTokens).toBeLessThan(20);
    expect(uncapped.length).toBeGreaterThan(capped.length);
    expect(uncappedTokens).toBeGreaterThan(approxPromptTokens(system));
    expect(fullTokens).toBeGreaterThan(probeTokens * 10);
    expect(fullTokens).toBeLessThanOrEqual(LOCAL_PROMPT_MAX_TOKENS);
    expect(fullTokens).toBeLessThan(OLLAMA_NUM_CTX);
    expect(uncapped.length).toBeGreaterThan(8_000);
    expect(capped.length).toBeGreaterThan(5_000);
    expect(messageChars(messages)).toBeGreaterThan(0);
  });

  it("keeps a large history, memory, and PDF under the local token cap", () => {
    const persona = "PERSONA_CORE_MARK violet lantern stays in the static block";
    const latest = "LATEST_USER_MARK do not drop this turn";
    const messages = composeCompanionChatMessages({
      characters: [{ ...natasha, personality: persona }],
      activeCharacter: { ...natasha, personality: persona },
      memories: [
        {
          characterId: "natasha",
          summary: `MEMORY_MARK ${"remembered fact ".repeat(200)}`,
          facts: [
            {
              type: "factual",
              text: `MEMORY_MARK ${"remembered fact ".repeat(200)}`,
            },
          ],
        },
      ],
      recentMessages: Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `OLD_HISTORY_${i} ${"earlier beat ".repeat(80)}`,
        character_name: i % 2 === 0 ? undefined : "Natasha Romanoff",
      })),
      mode: "solo",
      content: latest,
      pdfContext: `PDF_MARK ${"excerpt word ".repeat(800)}`,
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
    });
    const packed = messages.map((message) => message.content).join("\n");
    const tokens = estimateLocalPromptTokens(packed);
    const sections = companionLocalSections({
      characters: [{ ...natasha, personality: persona }],
      activeCharacter: { ...natasha, personality: persona },
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: latest,
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
    });
    expect(LOCAL_PROMPT_MAX_TOKENS).toBeGreaterThanOrEqual(1_500);
    expect(LOCAL_PROMPT_MAX_TOKENS).toBeLessThanOrEqual(2_000);
    expect(localPromptHardMaxTokens()).toBe(
      OLLAMA_N_CTX - OLLAMA_NUM_PREDICT_CAP - LOCAL_PROMPT_SAFETY_MARGIN_TOKENS,
    );
    expect(tokens).toBeLessThanOrEqual(LOCAL_PROMPT_MAX_TOKENS);
    expect(tokens + OLLAMA_NUM_PREDICT_CAP).toBeLessThan(OLLAMA_N_CTX);
    expect(
      tokens + OLLAMA_NUM_PREDICT_CAP + LOCAL_PROMPT_SAFETY_MARGIN_TOKENS,
    ).toBeLessThanOrEqual(OLLAMA_N_CTX);
    expect(packed).toContain(persona);
    expect(packed).toContain("CHARACTER IDENTITY LOCK");
    expect(messages.at(-1)).toEqual({ role: "user", content: latest });
    expect(packed).not.toContain("OLD_HISTORY_0");
    expect(sections.staticText.length).toBeGreaterThan(0);
  });

  it("fits a worst-case prompt under n_ctx minus num_predict and keeps persona, mood, and the latest message", () => {
    const persona = "PERSONA_FULL_MARK the identity lock stays intact";
    const latest = "LATEST_WORST_MARK the newest line";
    const character = { ...natasha, personality: persona };
    const memories = Array.from({ length: 24 }, (_, i) => ({
      characterId: "natasha",
      summary: `MEMORY_WORST_${i} ${"long remembered fact ".repeat(40)}`,
      facts: [
        {
          type: "factual",
          text: `MEMORY_WORST_${i} ${"long remembered fact ".repeat(40)}`,
        },
      ],
    }));
    const input = {
      characters: [character],
      activeCharacter: character,
      memories,
      recentMessages: Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `OLD_HISTORY_${i} ${"earlier beat ".repeat(120)}`,
        character_name: i % 2 === 0 ? undefined : "Natasha Romanoff",
      })),
      mode: "solo",
      content: latest,
      pdfContext: `PDF_WORST ${"excerpt word ".repeat(PDF_CONTEXT_WORD_BUDGET + 400)}`,
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
    };
    const sections = companionLocalSections(input);
    const messages = composeCompanionChatMessages(input);
    const packed = messages.map((message) => message.content).join("\n");
    const tokens = estimateLocalPromptTokens(packed);

    expect(sections.staticText).toContain(persona);
    expect(sections.moodText.length).toBeGreaterThan(0);
    expect(packed.includes(sections.staticText)).toBe(true);
    expect(packed.includes(sections.moodText)).toBe(true);
    expect(messages.at(-1)).toEqual({ role: "user", content: latest });
    expect(tokens).toBeLessThanOrEqual(localPromptHardMaxTokens());
    expect(tokens + OLLAMA_NUM_PREDICT_CAP).toBeLessThan(OLLAMA_N_CTX);
    expect(
      tokens + OLLAMA_NUM_PREDICT_CAP + LOCAL_PROMPT_SAFETY_MARGIN_TOKENS,
    ).toBeLessThanOrEqual(OLLAMA_N_CTX);
    expect(packed).not.toContain("OLD_HISTORY_0");
  });

  it("keeps the leading static block identical when mood and memory change", () => {
    const base = {
      characters: [natasha],
      activeCharacter: natasha,
      recentMessages: history.slice(0, 2),
      mode: "solo" as const,
      content: "However you wish to move Natasha.",
    };
    const calm = {
      ...base,
      memories: [
        {
          characterId: "natasha",
          summary: "MEMORY_CALM she is listening.",
          facts: [{ type: "factual", text: "MEMORY_CALM she is listening." }],
        },
      ],
      synchroState: {
        ...turn.synchroState,
        emotionalTone: "measured",
        vector: { ...turn.synchroState.vector, intimacy: 22 },
      },
      companionAffect: { ...turn.companionAffect, mood: "quiet-watchful", primary: "neutral" as const },
    };
    const stirred = {
      ...base,
      memories: [
        {
          characterId: "natasha",
          summary: "MEMORY_STIRRED the bond just shifted.",
          facts: [{ type: "emotional", text: "MEMORY_STIRRED the bond just shifted." }],
        },
      ],
      synchroState: {
        ...turn.synchroState,
        emotionalTone: "fierce",
        vector: { ...turn.synchroState.vector, intimacy: 88 },
      },
      companionAffect: { ...turn.companionAffect, mood: "fierce-alert", primary: "watchful" as const },
    };

    const prefixCalm = companionStaticPrefix(calm);
    const prefixStirred = companionStaticPrefix(stirred);
    expect(prefixCalm).toBe(prefixStirred);
    expect(prefixCalm).toContain("CHARACTER IDENTITY LOCK");
    expect(prefixCalm).toContain("Natasha Romanoff");
    expect(prefixCalm).not.toContain("MEMORY_CALM");
    expect(prefixCalm).not.toContain("MEMORY_STIRRED");
    expect(prefixCalm).not.toContain("quiet-watchful");
    expect(prefixCalm).not.toContain("fierce-alert");
    expect(prefixCalm).not.toContain("Current emotional atmosphere");

    const calmMessages = composeCompanionChatMessages(calm);
    const stirredMessages = composeCompanionChatMessages(stirred);
    expect(calmMessages[0]?.content.startsWith(prefixCalm)).toBe(true);
    expect(stirredMessages[0]?.content.startsWith(prefixStirred)).toBe(true);
    expect(calmMessages[0]?.content.slice(0, prefixCalm.length)).toBe(
      stirredMessages[0]?.content.slice(0, prefixStirred.length),
    );
    expect(calmMessages[0]?.content).not.toBe(stirredMessages[0]?.content);
    expect(calmMessages[0]?.content).toContain("MEMORY_CALM");
    expect(stirredMessages[0]?.content).toContain("MEMORY_STIRRED");
    expect(calmMessages[0]?.content).toContain("quiet-watchful");
    expect(stirredMessages[0]?.content).toContain("fierce-alert");
    expect(calmMessages[0]?.content.indexOf("MEMORY_CALM")).toBeLessThan(
      calmMessages[0]?.content.indexOf("quiet-watchful") ?? -1,
    );
  });

  it("places mood just before history, after memories and PDF", () => {
    const input = {
      characters: [natasha],
      activeCharacter: natasha,
      memories: [
        {
          characterId: "natasha",
          summary: "MEMORY_ORDER silver moth",
          facts: [{ type: "factual", text: "MEMORY_ORDER silver moth" }],
        },
      ],
      recentMessages: [
        { role: "user", content: "HISTORY_ORDER earlier line" },
        {
          role: "assistant",
          content: "HISTORY_ORDER she answered",
          character_name: "Natasha Romanoff",
        },
      ],
      mode: "solo",
      content: "LATEST_ORDER the new line",
      pdfContext: "PDF_ORDER short excerpt",
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
    };
    const sections = companionLocalSections(input);
    const messages = composeCompanionChatMessages(input);
    const system = messages[0]?.content || "";

    expect(sections.moodText.length).toBeGreaterThan(0);
    expect(system.startsWith(sections.staticText)).toBe(true);
    const memoryAt = system.indexOf("MEMORY_ORDER");
    const pdfAt = system.indexOf("PDF_ORDER");
    const moodAt = system.indexOf(sections.moodText);
    expect(memoryAt).toBeGreaterThan(sections.staticText.length);
    expect(pdfAt).toBeGreaterThan(memoryAt);
    expect(moodAt).toBeGreaterThan(pdfAt);
    expect(system.endsWith(sections.moodText)).toBe(true);
    expect(messages.slice(1, -1).map((message) => message.content).join("\n")).toContain(
      "HISTORY_ORDER",
    );
    expect(messages.at(-1)).toEqual({ role: "user", content: "LATEST_ORDER the new line" });
    expect(sections.staticText.includes(sections.moodText)).toBe(false);
  });
});

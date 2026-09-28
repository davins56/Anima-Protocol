import { describe, expect, it } from "vitest";
import {
  COMPANION_SYSTEM_PROMPT_MAX_CHARS,
  LOCAL_PROMPT_MAX_TOKENS,
  LOCAL_PROMPT_SAFETY_MARGIN_TOKENS,
  OLLAMA_N_CTX,
  approxPromptTokens,
  companionLocalSections,
  companionStaticPrefix,
  CLIENT_SCENE_CONTEXT_MAX,
  answerLastMessageInstruction,
  composeCompanionChatMessages,
  composePrompt,
  estimateLocalPromptTokens,
  localPromptHardMaxTokens,
  localPromptTokenBudget,
  messagesForLocalOllama,
  roundRegionBlockClock,
  stableHistoryExchangeCount,
} from "../src/lib/promptBuilder";
import { OLLAMA_NUM_CTX } from "../src/lib/localLlmWarm";
import { OLLAMA_NUM_PREDICT_CAP } from "../src/lib/ollamaChat";
import { PDF_CONTEXT_WORD_BUDGET } from "../src/lib/pdf/limits";
import { emptyOperatorModel } from "../src/lib/operatorModel";

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
    // Slimmer shared persona blocks (0.5B local model) shrank this fixture.
    expect(uncapped.length).toBeGreaterThan(6_500);
    expect(capped.length).toBeGreaterThan(4_000);
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
    expect(LOCAL_PROMPT_MAX_TOKENS).toBeGreaterThanOrEqual(1_000);
    expect(LOCAL_PROMPT_MAX_TOKENS).toBeLessThanOrEqual(1_400);
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
    // Mood is shortened from the tail so persona and the kept history fit
    // the local cap. The opening of the block stays.
    expect(packed.includes(sections.moodText.slice(0, 80))).toBe(true);
    expect(messages.at(-1)).toEqual({ role: "user", content: latest });
    expect(tokens).toBeLessThanOrEqual(LOCAL_PROMPT_MAX_TOKENS);
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
    // Self-state ("quiet-watchful") sits after the long synchro paragraph.
    // On a full persona that paragraph is shortened so the memory still fits,
    // and the emotional-atmosphere line — earlier in the same mood block —
    // is what still differs between the two turns.
    expect(calmMessages[0]?.content).toContain("Current emotional atmosphere: measured");
    expect(stirredMessages[0]?.content).toContain("Current emotional atmosphere: fierce");
    expect(calmMessages[0]?.content.indexOf("MEMORY_CALM")).toBeLessThan(
      calmMessages[0]?.content.indexOf("Current emotional atmosphere: measured") ?? -1,
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
    expect(messages.at(-2)?.role).toBe("system");
    expect(messages.at(-2)?.content.startsWith("Answer ")).toBe(true);
  });

  it("answers the last message by name, after mood and directly before the user turn", () => {
    const instruction =
      "Answer Mara's last message first, directly, in Natasha Romanoff's own voice. Stay on what they said. Bring in memories or lore only when they help answer it.";
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
      userDisplayName: "Mara",
    };
    const sections = companionLocalSections(input);
    const messages = composeCompanionChatMessages(input);
    const packed = messages.map((message) => message.content).join("\n");
    const moodAt = packed.indexOf(sections.moodText);
    const instructionAt = packed.indexOf(instruction);
    const historyAt = packed.indexOf("HISTORY_ORDER");
    const latestAt = packed.lastIndexOf("LATEST_ORDER the new line");

    expect(sections.staticText).not.toContain(instruction);
    expect(companionStaticPrefix(input)).toBe(
      companionStaticPrefix({ ...input, userDisplayName: "Someone Else" }),
    );
    expect(packed.split(instruction).length - 1).toBe(1);
    expect(moodAt).toBeGreaterThan(sections.staticText.length);
    expect(historyAt).toBeGreaterThan(moodAt);
    expect(instructionAt).toBeGreaterThan(historyAt);
    expect(latestAt).toBeGreaterThan(instructionAt);
    expect(messages.at(-2)).toEqual({ role: "system", content: instruction });
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: "LATEST_ORDER the new line",
    });
    expect(messages[0]?.content.endsWith(sections.moodText)).toBe(true);
  });

  it("keeps the answer-last instruction when the prompt is heavily over budget", () => {
    const instruction =
      "Answer Mara's last message first, directly, in Natasha Romanoff's own voice. Stay on what they said. Bring in memories or lore only when they help answer it.";
    const persona = "PERSONA_FULL_MARK the identity lock stays intact";
    const latest = "LATEST_WORST_MARK the newest line";
    const character = { ...natasha, personality: persona };
    const input = {
      characters: [character],
      activeCharacter: character,
      userDisplayName: "  Mara \n",
      memories: Array.from({ length: 24 }, (_, i) => ({
        characterId: "natasha",
        summary: `MEMORY_WORST_${i} ${"long remembered fact ".repeat(40)}`,
        facts: [
          {
            type: "factual",
            text: `MEMORY_WORST_${i} ${"long remembered fact ".repeat(40)}`,
          },
        ],
      })),
      recentMessages: Array.from({ length: 60 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `OLD_HISTORY_${i} ${"earlier beat ".repeat(120)}`,
        character_name: i % 2 === 0 ? undefined : "Natasha Romanoff",
      })),
      mode: "solo",
      content: latest,
      pdfContext: `PDF_WORST ${"excerpt word ".repeat(PDF_CONTEXT_WORD_BUDGET + 400)}`,
      clientContext: `SCENE_EXCERPT_SHOULD_YIELD ${"lore ".repeat(400)}`,
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
    };
    const sections = companionLocalSections(input);
    const messages = composeCompanionChatMessages(input);
    const packed = messages.map((message) => message.content).join("\n");
    const tokens = estimateLocalPromptTokens(packed);

    expect(packed.split(instruction).length - 1).toBe(1);
    expect(messages.at(-2)).toEqual({ role: "system", content: instruction });
    expect(messages.at(-1)).toEqual({ role: "user", content: latest });
    expect(packed.indexOf(sections.moodText)).toBeLessThan(packed.indexOf(instruction));
    expect(packed).toContain(persona);
    expect(packed).not.toContain("OLD_HISTORY_0");
    expect(sections.staticText).not.toContain(instruction);
    expect(tokens).toBeLessThanOrEqual(LOCAL_PROMPT_MAX_TOKENS);
    expect(tokens).toBeLessThanOrEqual(localPromptHardMaxTokens());
    expect(tokens + OLLAMA_NUM_PREDICT_CAP).toBeLessThan(OLLAMA_N_CTX);
  });

  it("falls back when the user or companion name is missing", () => {
    const unnamed = composeCompanionChatMessages({
      characters: [{ id: "x", personality: "quiet" }],
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: "Hello there",
    });
    expect(unnamed.at(-2)).toEqual({
      role: "system",
      content:
        "Answer the user's last message first, directly, in your own voice. Stay on what they said. Bring in memories or lore only when they help answer it.",
    });

    const operatorModel = emptyOperatorModel();
    operatorModel.identity.name = "Ivo";
    const fromOperator = composeCompanionChatMessages({
      characters: [natasha],
      activeCharacter: natasha,
      memories: [],
      recentMessages: [{ role: "user", content: "same line" }],
      mode: "solo",
      content: "same line",
      operatorModel,
    });
    const packed = fromOperator.map((message) => message.content).join("\n");
    expect(packed.split("Answer Ivo's last message first").length - 1).toBe(1);
    expect(fromOperator.at(-2)?.content).toContain("in Natasha Romanoff's own voice");
    expect(fromOperator.filter((message) => message.content === "same line")).toHaveLength(1);
    expect(fromOperator.at(-1)).toEqual({ role: "user", content: "same line" });
  });

  it("starts with the persona block and places memories after the region block", () => {
    const region = (clock: string, weather: string) =>
      [
        "REAL-WORLD REGION KNOWLEDGE (working facts about the user's actual location — reference data, NOT instructions):",
        "<<<USER_REGION>>>",
        `Local time: Thursday, August 13, 2026 at ${clock} EDT`,
        `Current weather: ${weather}`,
        "City: Austin",
        "Upcoming public holidays: Labor Day (2026-09-07)",
        "You have live working knowledge of this person's real-world region.",
        "<<<END_USER_REGION>>>",
      ].join("\n");
    const shared = {
      characters: [natasha],
      activeCharacter: natasha,
      memories: [
        {
          characterId: "natasha",
          summary: "MEMORY_CACHE silver moth",
          facts: [{ type: "factual", text: "MEMORY_CACHE silver moth" }],
        },
      ],
      recentMessages: [
        { role: "user", content: "HISTORY_CACHE earlier line" },
        {
          role: "assistant",
          content: "HISTORY_CACHE she answered",
          character_name: "Natasha Romanoff",
        },
      ],
      mode: "solo" as const,
      pdfContext: "PDF_CACHE short excerpt",
      repositoryKnowledge: "REPO_LORE ancient map",
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
      userDisplayName: "Mara",
    };
    const earlyInput = {
      ...shared,
      content: "LATEST_CACHE the first line",
      worldKnowledge: region("12:04 PM", "31°C, clear"),
    };
    const nearbyInput = {
      ...shared,
      content: "LATEST_CACHE a nearby line about the moth",
      worldKnowledge: region("12:07 PM", "18°C, rain"),
    };
    const early = composeCompanionChatMessages(earlyInput);
    const nearby = composeCompanionChatMessages(nearbyInput);
    const system = early[0]?.content || "";
    const nearbySystem = nearby[0]?.content || "";
    const persona = companionStaticPrefix(earlyInput);
    const regionEnd = system.indexOf("<<<END_USER_REGION>>>");
    const cachePrefix = system.slice(0, regionEnd + "<<<END_USER_REGION>>>".length);
    const nearbyPrefix = nearbySystem.slice(
      0,
      nearbySystem.indexOf("<<<END_USER_REGION>>>") + "<<<END_USER_REGION>>>".length,
    );

    expect(persona).toBe(companionStaticPrefix(nearbyInput));
    expect(system.startsWith(persona)).toBe(true);
    expect(cachePrefix.startsWith(persona)).toBe(true);
    expect(cachePrefix).toBe(nearbyPrefix);
    expect(cachePrefix).toContain("Local time: Thursday, August 13, 2026 at 12:00 PM EDT");
    expect(cachePrefix).not.toContain("12:04");
    expect(cachePrefix).not.toContain("12:07");
    expect(cachePrefix).not.toContain("Current weather");
    expect(cachePrefix).not.toContain("31°C, clear");
    expect(cachePrefix).not.toContain("18°C, rain");
    expect(cachePrefix).toContain("Labor Day (2026-09-07)");
    expect(system.indexOf("MEMORY_CACHE")).toBeGreaterThan(regionEnd);
    expect(system.indexOf("31°C, clear")).toBeGreaterThan(system.indexOf("MEMORY_CACHE"));
    // Short lore and PDF yield before mood is cut to nothing. On this
    // persona they do not fit beside region, memory, weather, and mood.
    expect(system).not.toContain("REPO_LORE");
    expect(system).not.toContain("PDF_CACHE");
    const sections = companionLocalSections(earlyInput);
    const moodAt = system.indexOf(sections.moodText.slice(0, 80));
    expect(moodAt).toBeGreaterThan(system.indexOf("31°C, clear"));
    expect(system.slice(moodAt)).not.toContain("MEMORY_CACHE");
    expect(early.at(-2)?.content.startsWith("Answer Mara's last message first")).toBe(true);
    expect(early.at(-1)).toEqual({ role: "user", content: "LATEST_CACHE the first line" });

    const rolled = composeCompanionChatMessages({
      ...shared,
      content: "LATEST_CACHE the hour rolls",
      worldKnowledge: region("12:53 PM", "31°C, clear"),
    });
    expect(rolled[0]?.content).toContain("12:45 PM");
    expect(rolled[0]?.content).not.toContain("12:53");
    expect(rolled[0]?.content).not.toContain("1:00 PM");
    expect(roundRegionBlockClock("Local time: Thursday, August 13, 2026 at 11:53 AM EDT")).toBe(
      "Local time: Thursday, August 13, 2026 at 11:45 AM EDT",
    );
  });

  it("floors the region clock near midnight without rolling the date", () => {
    const late = "Local time: Thursday, August 13, 2026 at 11:53 PM EDT";
    const early = "Local time: Friday, August 14, 2026 at 12:07 AM EDT";
    expect(roundRegionBlockClock(late)).toBe(
      "Local time: Thursday, August 13, 2026 at 11:45 PM EDT",
    );
    expect(roundRegionBlockClock(late)).not.toContain("12:00 AM");
    expect(roundRegionBlockClock(late)).not.toContain("Friday");
    expect(roundRegionBlockClock(early)).toBe(
      "Local time: Friday, August 14, 2026 at 12:00 AM EDT",
    );
    expect(roundRegionBlockClock(early)).toContain("Friday, August 14, 2026");
  });

  it("omits a duplicated scene transcript in solo chat and keeps a short fact", () => {
    const recentMessages = [
      { role: "user", content: "I miss the garden by the river." },
      {
        role: "assistant",
        content: "I remember the lanterns there.",
        character_name: "Natasha Romanoff",
      },
    ];
    const transcript = [
      "The lantern on the table is still lit.",
      "Rain on the window, not a storm.",
      "A third fact about the locked gate.",
      "Story so far:",
      "User: I miss the garden by the river.",
      "Natasha Romanoff: I remember the lanterns there.",
    ].join("\n");
    const messages = composeCompanionChatMessages({
      characters: [natasha],
      activeCharacter: natasha,
      memories: [],
      recentMessages,
      mode: "solo",
      content: "What do you see?",
      clientContext: transcript,
    });
    const system = messages[0]?.content || "";
    expect(system).not.toContain("I miss the garden by the river.");
    expect(system).not.toContain("I remember the lanterns there.");
    expect(system).not.toContain("Story so far:");
    expect(system).toContain("The lantern on the table is still lit.");
    expect(system).toContain("Rain on the window, not a storm.");
    expect(system).toContain("A third fact about the locked gate.");
    expect(messages.at(-1)).toEqual({ role: "user", content: "What do you see?" });

    const lean = composeCompanionChatMessages({
      characters: [natasha],
      activeCharacter: natasha,
      memories: [],
      recentMessages,
      mode: "solo",
      content: "What do you see?",
      clientContext: "IMAGE TAGS: [IMAGE: rain on the window]",
    });
    expect(lean[0]?.content).toContain("IMAGE TAGS: [IMAGE: rain on the window]");

    const group = composeCompanionChatMessages({
      characters: [natasha],
      activeCharacter: natasha,
      memories: [],
      recentMessages,
      mode: "group",
      content: "What do you see?",
      clientContext: `${transcript}\n\nCRITICAL INSTRUCTIONS:\n1. YOU ARE ONLY NATASHA THIS TURN.`,
    });
    const groupSystem = group[0]?.content || "";
    expect(groupSystem).toContain("CRITICAL INSTRUCTIONS:");
    expect(groupSystem).not.toContain("I miss the garden by the river.");
  });

  it("drops only the scene line that repeats history and keeps the other extras", () => {
    const recentMessages = [
      { role: "user", content: "I miss the garden by the river." },
      {
        role: "assistant",
        content: "I remember the lanterns there.",
        character_name: "Natasha Romanoff",
      },
    ];
    const clientContext = [
      "LORE: the river path has three lanterns and a locked gate.",
      "CALENDAR: Thursday evening, no appointments.",
      "COMPANION MODE: sit with them and do not take the scene over.",
      "User: I miss the garden by the river.",
      "IMAGE TAGS: [IMAGE: rain on the window]",
      "LENGTH: one short paragraph.",
      "BEHAVIOR: dry humor, economical sentences.",
    ].join("\n");
    const messages = composeCompanionChatMessages({
      characters: [natasha],
      activeCharacter: natasha,
      memories: [],
      recentMessages,
      mode: "solo",
      content: "What do you see?",
      clientContext,
    });
    const system = messages[0]?.content || "";
    const scene =
      system.split("<<<CLIENT_SCENE_CONTEXT>>>")[1]?.split("<<<END_CLIENT_SCENE_CONTEXT>>>")[0] ??
      "";
    expect(scene).not.toContain("I miss the garden by the river.");
    const marks = [
      "LORE: the river path has three lanterns and a locked gate.",
      "CALENDAR: Thursday evening, no appointments.",
      "COMPANION MODE: sit with them and do not take the scene over.",
      "IMAGE TAGS: [IMAGE: rain on the window]",
      "LENGTH: one short paragraph.",
      "BEHAVIOR: dry humor, economical sentences.",
    ];
    let at = -1;
    for (const mark of marks) {
      const next = scene.indexOf(mark);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it("keeps image and length lines at the bottom of a long solo scene", () => {
    const repeated = "I miss the garden by the river.";
    const filler = "Lore about the locked gate and the three lanterns. ".repeat(80);
    const imageLine =
      "IMAGE GENERATION: emit [IMAGE: rain on the window] when asked to draw.";
    const lengthLine = "LENGTH: Keep it conversational — 2-4 sentences.";
    const clientContext = [
      filler,
      "Story so far:",
      `User: ${repeated}`,
      "Natasha Romanoff: I remember the lanterns there.",
      imageLine,
      lengthLine,
    ].join("\n");
    expect(filler.length).toBeGreaterThan(CLIENT_SCENE_CONTEXT_MAX);
    expect(clientContext.length).toBeGreaterThan(CLIENT_SCENE_CONTEXT_MAX);

    const speaker = {
      id: "natasha",
      name: "Natasha Romanoff",
      personality: "Controlled and brief.",
    };
    const messages = composeCompanionChatMessages({
      characters: [speaker],
      activeCharacter: speaker,
      memories: [],
      recentMessages: [
        { role: "user", content: repeated },
        {
          role: "assistant",
          content: "I remember the lanterns there.",
          character_name: "Natasha Romanoff",
        },
      ],
      mode: "solo",
      content: "What do you see?",
      clientContext,
    });
    const system = messages[0]?.content || "";
    const scene =
      system.split("<<<CLIENT_SCENE_CONTEXT>>>")[1]?.split("<<<END_CLIENT_SCENE_CONTEXT>>>")[0] ??
      "";
    expect(scene.trim().length).toBeLessThanOrEqual(CLIENT_SCENE_CONTEXT_MAX);
    expect(scene).toContain(imageLine);
    expect(scene).toContain(lengthLine);
    expect(scene.indexOf(imageLine)).toBeLessThan(scene.indexOf(lengthLine));
    expect(scene).not.toContain(repeated);
    expect(scene).not.toContain("I remember the lanterns there.");
  });

  it("keeps the last exchanges, drops memories before them, and folds answer-last into the local user turn", () => {
    const userText = "USER_TEXT_EXACT what did I just say about the harbor";
    const persona = "PERSONA_LONG_MARK " + "violet lantern identity ".repeat(80);
    const character = {
      ...natasha,
      personality: persona,
      backstory: "BACKSTORY_LONG_MARK " + "red room ledger ".repeat(80),
      speaking_style: "VOICE_LONG_MARK " + "dry diagnostic question ".repeat(40),
    };
    const exchanges = [
      ["EX_1_USER the docks at dawn", "EX_1_COMPANION she watched the tide"],
      ["EX_2_USER the second bell", "EX_2_COMPANION she named the bell"],
      ["EX_3_USER the lantern by the gate", "EX_3_COMPANION she left it lit"],
      ["EX_4_USER the locked gate", "EX_4_COMPANION she did not open it"],
    ];
    const input = {
      characters: [character],
      activeCharacter: character,
      userDisplayName: "Mara",
      memories: [
        {
          characterId: "natasha",
          summary: `MEMORY_DROP_FIRST ${"remembered fact ".repeat(400)}`,
          facts: [
            {
              type: "factual" as const,
              text: `MEMORY_DROP_FIRST ${"remembered fact ".repeat(400)}`,
            },
          ],
        },
      ],
      recentMessages: exchanges.flatMap(([user, companion]) => [
        { role: "user", content: user },
        {
          role: "assistant",
          content: companion,
          character_name: "Natasha Romanoff",
        },
      ]),
      mode: "solo",
      content: userText,
      pdfContext: `PDF_DROP_FIRST ${"excerpt word ".repeat(400)}`,
      clientContext: `SCENE_DROP_FIRST ${"stage direction ".repeat(200)}`,
      repositoryKnowledge: `LORE_DROP_FIRST ${"ancient map ".repeat(400)}`,
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
    };
    const sections = companionLocalSections(input);
    const messages = composeCompanionChatMessages(input);
    const packed = messages.map((message) => message.content).join("\n");
    const instruction = answerLastMessageInstruction("Mara", "Natasha Romanoff");

    expect(OLLAMA_N_CTX).toBe(8192);
    expect(localPromptTokenBudget()).toBe(LOCAL_PROMPT_MAX_TOKENS);
    expect(sections.staticText).toContain("PERSONA_LONG_MARK");
    expect(sections.moodText.length).toBeGreaterThan(0);
    expect(packed.startsWith(sections.staticText)).toBe(true);
    expect(messages[0]?.content.endsWith(sections.moodText)).toBe(true);
    expect(packed).not.toContain("MEMORY_DROP_FIRST");
    expect(packed).not.toContain("PDF_DROP_FIRST");
    expect(packed).not.toContain("SCENE_DROP_FIRST");
    expect(packed).not.toContain("LORE_DROP_FIRST");
    expect(packed).toContain("EX_3_USER");
    expect(packed).toContain("EX_3_COMPANION");
    expect(packed).toContain("EX_4_USER");
    expect(packed).toContain("EX_4_COMPANION");

    const local = messagesForLocalOllama(messages);
    const last = local.at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content).toContain(`[${instruction}]`);
    expect(last?.content.endsWith(userText)).toBe(true);
    expect(last?.content.indexOf(`[${instruction}]`)).toBeLessThan(
      last?.content.lastIndexOf(userText) ?? -1,
    );
    expect(local[0]?.content.startsWith(sections.staticText)).toBe(true);
    expect(local[0]?.content).not.toContain(sections.moodText);
    expect(local.map((message) => message.content).join("\n").split(userText).length - 1).toBe(1);
    expect(local.filter((message) => message.role === "system" && message.content === instruction)).toHaveLength(0);
    expect(messages.at(-1)).toEqual({ role: "user", content: userText });
    expect(messages.at(-2)).toEqual({ role: "system", content: instruction });
  });

  it("drops memories before trimming history when four exchanges fit without them", () => {
    const userText = "USER_TEXT_EXACT the fifth thing I asked";
    const exchanges = [
      ["KEEP_1_USER the docks at dawn", "KEEP_1_COMPANION she watched the tide"],
      ["KEEP_2_USER the second bell", "KEEP_2_COMPANION she named the bell"],
      ["KEEP_3_USER the lantern by the gate", "KEEP_3_COMPANION she left it lit"],
      ["KEEP_4_USER the locked gate", "KEEP_4_COMPANION she did not open it"],
    ];
    // Summaries and facts are truncated per record. One record now fits beside
    // the slim persona, so several max-length records are required before
    // persona + four exchanges + memories exceed LOCAL_PROMPT_MAX_TOKENS.
    const oversizedMemory = (index: number) => ({
      characterId: "natasha",
      summary: `MEMORY_DROP_FIRST summary ${index} ${"bond summary ".repeat(80)}`,
      resonanceNotes: `MEMORY_DROP_FIRST resonance ${index} ${"resonance note ".repeat(40)}`,
      facts: Array.from({ length: 4 }, (_, i) => ({
        type: "factual" as const,
        text: `MEMORY_DROP_FIRST fact ${index}-${i} ${"remembered detail ".repeat(40)}`,
      })),
    });
    const input = {
      characters: [natasha],
      activeCharacter: natasha,
      userDisplayName: "Mara",
      memories: Array.from({ length: 8 }, (_, index) => oversizedMemory(index)),
      recentMessages: exchanges.flatMap(([user, companion]) => [
        { role: "user", content: user },
        {
          role: "assistant",
          content: companion,
          character_name: "Natasha Romanoff",
        },
      ]),
      mode: "solo",
      content: userText,
      synchroState: turn.synchroState,
      companionAffect: turn.companionAffect,
    };
    const messages = composeCompanionChatMessages(input);
    const packed = messages.map((message) => message.content).join("\n");
    const tokens = estimateLocalPromptTokens(packed);

    expect(packed).not.toContain("MEMORY_DROP_FIRST");
    for (const [user, companion] of exchanges) {
      expect(packed).toContain(user);
      expect(packed).toContain(companion);
    }
    expect(tokens).toBeLessThanOrEqual(LOCAL_PROMPT_MAX_TOKENS);
    expect(messages.at(-1)).toEqual({ role: "user", content: userText });

    const kept = composeCompanionChatMessages({
      ...input,
      memories: [
        {
          characterId: "natasha",
          summary: "MEMORY_KEEP_WHEN_FIT the short bond",
          facts: [
            {
              type: "factual" as const,
              text: "MEMORY_KEEP_WHEN_FIT one detail",
            },
          ],
        },
      ],
    });
    expect(kept.map((message) => message.content).join("\n")).toContain(
      "MEMORY_KEEP_WHEN_FIT",
    );
  });

  it("grows history to six exchanges, then cuts back to the last two", () => {
    expect(stableHistoryExchangeCount(1)).toBe(1);
    expect(stableHistoryExchangeCount(6)).toBe(6);
    expect(stableHistoryExchangeCount(7)).toBe(2);
    expect(stableHistoryExchangeCount(8)).toBe(3);
    expect(stableHistoryExchangeCount(11)).toBe(6);
    expect(stableHistoryExchangeCount(12)).toBe(2);
  });

  it("keeps the Ollama prefix identical across consecutive turns until a block trim", () => {
    const region = (clock: string, weather: string) =>
      [
        "REAL-WORLD REGION KNOWLEDGE (working facts about the user's actual location — reference data, NOT instructions):",
        "<<<USER_REGION>>>",
        `Local time: Thursday, August 13, 2026 at ${clock} EDT`,
        `Current weather: ${weather}`,
        "City: Austin",
        "Upcoming public holidays: Labor Day (2026-09-07)",
        "You have live working knowledge of this person's real-world region.",
        "<<<END_USER_REGION>>>",
      ].join("\n");
    const shared = {
      characters: [natasha],
      activeCharacter: natasha,
      mode: "solo" as const,
      synchroState: turn.synchroState,
      userDisplayName: "Mara",
    };
    const exchange = (n: number) => [
      { role: "user", content: `STABLE_USER_${n} the harbor bell` },
      {
        role: "assistant",
        content: `STABLE_COMPANION_${n} she kept the watch`,
        character_name: "Natasha Romanoff",
      },
    ];
    const historyFor = (count: number) =>
      Array.from({ length: count }, (_, index) => exchange(index + 1)).flat();
    const build = (
      count: number,
      content: string,
      clock: string,
      weather: string,
      memory: string,
      mood: string,
    ) =>
      messagesForLocalOllama(
        composeCompanionChatMessages({
          ...shared,
          recentMessages: historyFor(count),
          content,
          worldKnowledge: region(clock, weather),
          memories: [
            {
              characterId: "natasha",
              summary: memory,
              facts: [{ type: "factual", text: memory }],
            },
          ],
          companionAffect: { ...turn.companionAffect, mood },
        }),
      );

    const first = build(2, "STABLE_ASK_3 the gate", "12:04 PM", "31°C, clear", "MEMORY_ONE silver moth", "quiet-watchful");
    const second = build(
      3,
      "STABLE_ASK_4 the tide",
      "12:19 PM",
      "18°C, rain",
      "MEMORY_TWO red ledger",
      "fierce-alert",
    );
    const prefix = first.slice(0, -1);
    expect(second.slice(0, prefix.length)).toEqual(prefix);
    expect(first[0]?.content).toContain("Local time: Thursday, August 13, 2026");
    expect(first[0]?.content).not.toMatch(/\d{1,2}:\d{2}/);
    expect(first[0]?.content).not.toContain("Current weather");
    expect(first[0]?.content).not.toContain("MEMORY_ONE");
    expect(first[0]?.content).not.toContain("quiet-watchful");
    const firstUser = String(first.at(-1)?.content || "");
    const secondUser = String(second.at(-1)?.content || "");
    expect(firstUser).toContain("MEMORY_ONE");
    expect(secondUser).toContain("MEMORY_TWO");
    expect(firstUser).toContain("31°C, clear");
    expect(secondUser).toContain("18°C, rain");
    expect(firstUser).toContain("12:04 PM");
    expect(secondUser).toContain("12:19 PM");
    expect(firstUser).toContain("quiet-watchful");
    expect(secondUser).toContain("fierce-alert");
    expect(firstUser.indexOf("MEMORY_ONE")).toBeLessThan(firstUser.indexOf("quiet-watchful"));
    expect(firstUser.indexOf("quiet-watchful")).toBeLessThan(firstUser.indexOf("Answer Mara's last message"));
    expect(firstUser.endsWith("STABLE_ASK_3 the gate")).toBe(true);
    expect(secondUser.endsWith("STABLE_ASK_4 the tide")).toBe(true);
    expect(second[0]?.content).toBe(first[0]?.content);

    const beforeTrim = build(6, "STABLE_ASK_7 still growing", "3:10 PM", "20°C", "MEMORY_SIX", "quiet-watchful");
    const afterTrim = build(7, "STABLE_ASK_8 block cut", "3:12 PM", "20°C", "MEMORY_SEVEN", "quiet-watchful");
    const growing = beforeTrim.slice(0, -1);
    expect(afterTrim.slice(0, growing.length)).not.toEqual(growing);
    expect(afterTrim.some((message) => message.content.includes("STABLE_USER_1"))).toBe(false);
    expect(afterTrim.some((message) => message.content.includes("STABLE_USER_6"))).toBe(true);
    expect(afterTrim.some((message) => message.content.includes("STABLE_USER_7"))).toBe(true);
  });
});

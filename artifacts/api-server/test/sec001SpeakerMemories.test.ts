/**
 * SEC-001 regression: group/crossover memory selection must fail closed.
 *
 * Crossover/group turns load every participant's companion_memories. The live
 * companion path (composeCompanionChatMessages -> localCompanionSections) keeps
 * only the speaker's rows. When the speaker identity is missing or unusable it
 * must select NO private memories, never the whole pool (which would hand
 * Steve's private memories to whoever is speaking). Shared session facts are a
 * separate, crossover-only block and must still reach the prompt.
 */
import { describe, it, expect } from "vitest";
import {
  companionLocalSections,
  composeCompanionChatMessages,
  type CharacterData,
  type CompanionMemoryRecord,
  type PromptBuilderParams,
} from "../src/lib/promptBuilder";

const NATASHA_PRIVATE = "SENTINEL_NATASHA_PRIVATE_7f3";
const NATASHA_FACT = "SENTINEL_NATASHA_FACT_2d8";
const STEVE_PRIVATE = "SENTINEL_STEVE_PRIVATE_9a1";
const STEVE_FACT = "SENTINEL_STEVE_FACT_5b6";
const STEVE_RESONANCE = "SENTINEL_STEVE_RESONANCE_e04";
const SHARED_FACT = "SENTINEL_SHARED_GROUP_FACT_c42";

const ALL_PRIVATE = [NATASHA_PRIVATE, NATASHA_FACT, STEVE_PRIVATE, STEVE_FACT, STEVE_RESONANCE];
const STEVE_SENTINELS = [STEVE_PRIVATE, STEVE_FACT, STEVE_RESONANCE];

const natasha: CharacterData = {
  id: "natasha",
  name: "Natasha Romanoff",
  personality: "Guarded, precise, dry humour.",
  speaking_style: "Short sentences. Deflects with wit.",
  universe: "Marvel",
};
const steve: CharacterData = {
  id: "steve",
  name: "Steve Rogers",
  personality: "Earnest, principled, steady.",
  speaking_style: "Plain spoken, warm.",
  universe: "Marvel",
};

const now = new Date().toISOString();
const memories: CompanionMemoryRecord[] = [
  {
    characterId: "natasha",
    summary: `Natasha's private summary ${NATASHA_PRIVATE}`,
    facts: [{ type: "factual", text: `User told Natasha where the key is ${NATASHA_FACT}`, created_at: now }],
  },
  {
    characterId: "steve",
    summary: `Steve's private summary ${STEVE_PRIVATE}`,
    facts: [{ type: "factual", text: `User told Steve about the key ${STEVE_FACT}`, created_at: now }],
    resonanceNotes: `Steve private resonance ${STEVE_RESONANCE}`,
  },
];
const sharedMemory = [{ text: `The group found the vault together ${SHARED_FACT}` }];

function params(overrides: Partial<PromptBuilderParams> = {}): PromptBuilderParams {
  return {
    characters: [natasha, steve],
    memories,
    sharedMemory,
    recentMessages: [],
    mode: "group",
    isCrossover: true,
    content: "Where did we leave the key?",
    ...overrides,
  };
}

/** Every string the builder produces for this turn: all chat messages plus all sections. */
function generatedContext(p: PromptBuilderParams): string {
  const messages = composeCompanionChatMessages(p);
  const sections = companionLocalSections(p) as unknown as Record<string, unknown>;
  const sectionText = Object.values(sections)
    .filter((v): v is string => typeof v === "string")
    .join("\n");
  return [...messages.map((m) => `${m.role}: ${m.content}`), sectionText].join("\n");
}

function presentSentinels(text: string): string[] {
  return ALL_PRIVATE.filter((s) => text.includes(s));
}

const invalidIdentities: Array<[string, CharacterData]> = [
  ["id absent", { name: "Natasha Romanoff", personality: "Guarded." }],
  ["id undefined", { id: undefined, name: "Natasha Romanoff", personality: "Guarded." } as CharacterData],
  ["id null", { id: null, name: "Natasha Romanoff", personality: "Guarded." } as unknown as CharacterData],
  ["id empty string", { id: "", name: "Natasha Romanoff", personality: "Guarded." }],
  ["id whitespace", { id: "   ", name: "Natasha Romanoff", personality: "Guarded." }],
  ["id matching no memory", { id: "nobody-7", name: "Natasha Romanoff", personality: "Guarded." }],
];

describe("SEC-001: speaker memory selection fails closed", () => {
  it("missing speaker (group turn with no resolved activeCharacter) -> no private memories", () => {
    const p = params({ activeCharacter: undefined });
    const sections = companionLocalSections(p);
    expect(presentSentinels(sections.memoryText)).toEqual([]);
    expect(presentSentinels(generatedContext(p))).toEqual([]);
  });

  it.each(invalidIdentities)("invalid speaker identity (%s) -> no private memories", (_label, speaker) => {
    const p = params({ activeCharacter: speaker });
    const sections = companionLocalSections(p);
    expect(presentSentinels(sections.memoryText)).toEqual([]);
    expect(presentSentinels(generatedContext(p))).toEqual([]);
  });

  it("valid speaker id -> only that character's private memories", () => {
    const p = params({ activeCharacter: natasha });
    const sections = companionLocalSections(p);
    expect(sections.memoryText).toContain(NATASHA_PRIVATE);
    expect(sections.memoryText).toContain(NATASHA_FACT);
    const all = generatedContext(p);
    for (const s of STEVE_SENTINELS) expect(all).not.toContain(s);
  });

  it("valid speaker id (Steve) -> only Steve's private memories", () => {
    const p = params({ activeCharacter: steve });
    const all = generatedContext(p);
    expect(all).toContain(STEVE_PRIVATE);
    expect(all).not.toContain(NATASHA_PRIVATE);
    expect(all).not.toContain(NATASHA_FACT);
  });

  it("shared group facts stay in the crossover prompt with a valid speaker", () => {
    const p = params({ activeCharacter: natasha });
    expect(companionLocalSections(p).memoryText).toContain(SHARED_FACT);
    expect(composeCompanionChatMessages(p).some((m) => m.content.includes(SHARED_FACT))).toBe(true);
  });

  it.each([["missing speaker", undefined] as const, ...invalidIdentities])(
    "shared group facts stay in the crossover prompt when the speaker is unusable (%s)",
    (_label, speaker) => {
      const p = params({ activeCharacter: speaker });
      expect(companionLocalSections(p).memoryText).toContain(SHARED_FACT);
      expect(composeCompanionChatMessages(p).some((m) => m.content.includes(SHARED_FACT))).toBe(true);
    },
  );

  it("no private memory from another Anima appears in any message or section", () => {
    const cases: Array<[CharacterData | undefined, string[]]> = [
      [natasha, STEVE_SENTINELS],
      [steve, [NATASHA_PRIVATE, NATASHA_FACT]],
      [undefined, ALL_PRIVATE],
      ...invalidIdentities.map(([, c]) => [c, ALL_PRIVATE] as [CharacterData, string[]]),
    ];
    for (const [speaker, forbidden] of cases) {
      const p = params({ activeCharacter: speaker });
      for (const msg of composeCompanionChatMessages(p)) {
        for (const s of forbidden) expect(msg.content, `${speaker?.id ?? "missing"} ${msg.role}`).not.toContain(s);
      }
      const all = generatedContext(p);
      for (const s of forbidden) expect(all, `${String(speaker?.id ?? "missing")}`).not.toContain(s);
    }
  });

  it("group/crossover prompt still carries speaker identity, crossover awareness and the user turn", () => {
    const p = params({ activeCharacter: natasha });
    const messages = composeCompanionChatMessages(p);
    expect(messages[0]!.role).toBe("system");
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    expect(system).toContain("CHARACTER IDENTITY LOCK: Speak in first person as Natasha Romanoff");
    expect(system).toContain("Steve Rogers");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    expect(lastUser?.content).toContain("Where did we leave the key?");
  });

  it("solo (non-group) turns are unaffected: the speaker keeps their own memories", () => {
    const p = params({ characters: [natasha], mode: "solo", isCrossover: false, memories: [memories[0]!], sharedMemory: undefined });
    const all = generatedContext(p);
    expect(all).toContain(NATASHA_PRIVATE);
    expect(all).not.toContain(SHARED_FACT);
  });
});

// The legacy/full prompt path has its own speaker-memory selection. Exercise
// the real export as well as the live-chat path above; do not mock retrieval.
import { composePrompt } from "../src/lib/promptBuilder";

describe("SEC-001 composePrompt: group memory selection fails closed", () => {
  const unusableSpeakers: Array<[string, CharacterData | undefined]> = [
    ["no resolved speaker", undefined],
    ...invalidIdentities,
  ];

  it.each(unusableSpeakers)("%s -> no private sentinel anywhere in final output", (_label, speaker) => {
    const output = composePrompt(params({ activeCharacter: speaker }));
    expect(presentSentinels(output)).toEqual([]);
    for (const sentinel of ALL_PRIVATE) expect(output).not.toContain(sentinel);
    expect(output).toContain(SHARED_FACT);
  });

  // Shared facts are gated on isCrossover in composePrompt. The same two-person
  // crossover fixture explicitly enables it, including on the unfixed bases.
  it.each(unusableSpeakers)("%s -> shared crossover fact remains accessible", (_label, speaker) => {
    const p = params({ activeCharacter: speaker });
    expect(p.mode).toBe("group");
    expect(p.characters).toHaveLength(2);
    expect(p.isCrossover).toBe(true);
    expect(composePrompt(p)).toContain(SHARED_FACT);
  });

  it.each([["Natasha", natasha], ["Steve", steve]] as const)(
    "valid %s speaker -> own memories and shared fact, no other Anima private state",
    (_label, speaker) => {
      const output = composePrompt(params({ activeCharacter: speaker }));
      const own = speaker.id === natasha.id ? [NATASHA_PRIVATE, NATASHA_FACT] : STEVE_SENTINELS;
      const forbidden = speaker.id === natasha.id ? STEVE_SENTINELS : [NATASHA_PRIVATE, NATASHA_FACT];
      for (const sentinel of own) expect(output).toContain(sentinel);
      for (const sentinel of forbidden) expect(output).not.toContain(sentinel);
      expect(output).toContain(SHARED_FACT);
      expect(output).toContain(`CHARACTER IDENTITY LOCK: Speak in first person as ${speaker.name}`);
    },
  );
});

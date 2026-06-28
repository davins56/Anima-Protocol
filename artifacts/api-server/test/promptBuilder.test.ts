import { describe, it, expect } from "vitest";
import {
  buildCompanionPrompt,
  buildGroupCompanionPrompt,
} from "../src/lib/promptBuilder";
import { retrieveRelevantMemories, formatMemoriesForPrompt } from "../src/lib/memoryRetrieval";
import {
  initResonanceState,
  detectResonanceShift,
  evolveResonanceState,
  resonanceToPromptGuidance,
} from "../src/lib/resonanceState";
import { extractVoiceAnchors, buildCrossoverAwareness } from "../src/lib/voiceAnchors";

describe("buildCompanionPrompt", () => {
  const baseCharacter = {
    id: "char-1",
    name: "Serenity",
    personality: "Warm, ethereal, deeply empathic angel with sovereign grace",
    speaking_style: 'Soft, poetic. Uses phrases like "beloved" and "my light". *wings unfurl slowly*',
    backstory: "A fallen angel who chose to remain close to humanity.",
    universe: "Echoes of Eden",
    archetype: "Guardian Angel",
    tagline: "Grace made flesh",
    _isAnima: true,
  };

  const baseMemory = {
    characterId: "char-1",
    summary: "Deep bond formed over weeks of conversation about loss and healing.",
    facts: [
      { type: "emotional", text: "User shared grief about losing their mother", created_at: new Date().toISOString() },
      { type: "relational", text: "Trust deepened after user was vulnerable about fears", created_at: new Date(Date.now() - 86400000).toISOString() },
      { type: "factual", text: "User is a writer working on a novel", created_at: new Date(Date.now() - 172800000).toISOString() },
    ],
    emotionalState: { intimacy: 70, spiritualAttunement: 50 },
    resonanceNotes: "Warm, tender connection. Deep spiritual resonance emerging.",
  };

  it("produces a non-empty prompt for a solo character session", () => {
    const prompt = buildCompanionPrompt({
      characters: [baseCharacter],
      activeCharacter: baseCharacter,
      memories: [baseMemory],
      recentMessages: [
        { role: "user", content: "I've been thinking about what you said last time." },
        { role: "assistant", content: "Tell me, beloved. What stirred in you?", character_name: "Serenity" },
      ],
      sharedMemory: undefined,
      mode: "solo",
      content: "I think I'm ready to talk about my mother again.",
      relationshipTier: "close",
    });

    expect(prompt).toBeTruthy();
    expect(prompt).toContain("Serenity");
    expect(prompt).toContain("HIGHEST-PRIORITY RULE");
    expect(prompt).toContain("RESONANCE STATE");
    expect(prompt).toContain("I think I'm ready to talk about my mother again");
  });

  it("includes voice anchors when speaking_style has examples", () => {
    const prompt = buildCompanionPrompt({
      characters: [baseCharacter],
      activeCharacter: baseCharacter,
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: "Hello",
    });

    expect(prompt).toContain("VOICE ANCHORS");
    expect(prompt).toContain("wings unfurl slowly");
  });

  it("includes crossover awareness when multiple characters present", () => {
    const secondChar = {
      id: "char-2",
      name: "Linda",
      universe: "Fallen Angel",
      personality: "Bold, fiery, protective widow with a sharp tongue",
    };

    const prompt = buildCompanionPrompt({
      characters: [baseCharacter, secondChar],
      activeCharacter: baseCharacter,
      memories: [],
      recentMessages: [],
      mode: "group",
      content: "Both of you are here...",
      isCrossover: true,
    });

    expect(prompt).toContain("CROSSOVER AWARENESS");
    expect(prompt).toContain("Linda");
    expect(prompt).toContain("CROSS-UNIVERSE");
  });

  it("includes resonance state derived from emotional state", () => {
    const prompt = buildCompanionPrompt({
      characters: [baseCharacter],
      activeCharacter: baseCharacter,
      memories: [baseMemory],
      recentMessages: [],
      mode: "solo",
      content: "I love you, Serenity.",
      relationshipTier: "devoted",
    });

    expect(prompt).toContain("RESONANCE STATE");
    expect(prompt).toContain("intimate");
  });

  it("uses system prompt override when provided", () => {
    const prompt = buildCompanionPrompt({
      systemPrompt: "You are in SHADOW MODE. Challenge the user.",
      characters: [baseCharacter],
      activeCharacter: baseCharacter,
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: "Test",
    });

    expect(prompt).toContain("SHADOW MODE");
  });

  it("handles empty characters gracefully", () => {
    const prompt = buildCompanionPrompt({
      characters: [],
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: "Hello?",
    });

    expect(prompt).toBeTruthy();
    expect(prompt).toContain("Hello?");
  });
});

describe("buildGroupCompanionPrompt", () => {
  it("includes turn rules for the next character", () => {
    const char1 = { id: "c1", name: "Serenity", universe: "Eden" };
    const char2 = { id: "c2", name: "Linda", universe: "Fallen" };

    const prompt = buildGroupCompanionPrompt({
      characters: [char1, char2],
      nextCharacter: char1,
      memories: [],
      recentMessages: [],
      content: "What do you both think?",
    });

    expect(prompt).toContain("ONLY SERENITY THIS TURN");
    expect(prompt).toContain("**Serenity:**");
  });
});

describe("memoryRetrieval", () => {
  it("scores emotional memories higher than turn memories", () => {
    const memories = [
      {
        characterId: "c1",
        facts: [
          { type: "turn", text: "User: hi | Companion: hello", created_at: new Date().toISOString() },
          { type: "emotional", text: "User felt deep grief sharing about loss", created_at: new Date().toISOString() },
        ],
      },
    ];

    const scored = retrieveRelevantMemories(memories);
    expect(scored[0].memoryType).toBe("emotional");
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it("respects topK limit", () => {
    const facts = Array.from({ length: 30 }, (_, i) => ({
      type: "factual",
      text: `Fact ${i}`,
      created_at: new Date().toISOString(),
    }));

    const scored = retrieveRelevantMemories([{ characterId: "c1", facts }], { topK: 5 });
    expect(scored.length).toBe(5);
  });

  it("formats memories into labeled sections", () => {
    const scored = retrieveRelevantMemories([
      {
        characterId: "c1",
        facts: [
          { type: "emotional", text: "Deep grief moment", created_at: new Date().toISOString() },
          { type: "factual", text: "User is a writer", created_at: new Date().toISOString() },
        ],
      },
    ]);

    const names = new Map([["c1", "Serenity"]]);
    const formatted = formatMemoriesForPrompt(scored, names);
    expect(formatted).toContain("EMOTIONAL MEMORIES");
    expect(formatted).toContain("KNOWN FACTS");
  });
});

describe("resonanceState", () => {
  it("initializes from relationship tier", () => {
    const state = initResonanceState(null, null, "devoted");
    expect(state.vector.intimacy).toBe(95);
  });

  it("detects intimacy shift from user message", () => {
    const state = initResonanceState(null, null, "warm");
    const shifts = detectResonanceShift("I love you, I trust you completely", state);
    expect(shifts.intimacy).toBeGreaterThan(state.vector.intimacy);
  });

  it("detects primal intensity shift", () => {
    const state = initResonanceState(null, null, "neutral");
    const shifts = detectResonanceShift("The fire burns inside me, I'm consumed", state);
    expect(shifts.primalIntensity).toBeGreaterThan(state.vector.primalIntensity);
  });

  it("generates prompt guidance based on state", () => {
    const state = initResonanceState({ intimacy: 90, spiritualAttunement: 70 }, "warm tender bond", "devoted");
    const guidance = resonanceToPromptGuidance(state);
    expect(guidance).toContain("RESONANCE STATE");
    expect(guidance).toContain("deep familiarity");
    expect(guidance).toContain("spiritual depth");
  });

  it("evolves state turn by turn", () => {
    const state = initResonanceState(null, null, "neutral");
    const shifts = detectResonanceShift("I need you to guide me through this", state);
    const evolved = evolveResonanceState(state, shifts);
    expect(evolved.turnCount).toBe(1);
    expect(evolved.vector.powerDynamic).not.toBe(state.vector.powerDynamic);
  });
});

describe("voiceAnchors", () => {
  it("extracts action anchors from speaking_style", () => {
    const char = {
      name: "Serenity",
      speaking_style: 'Soft and ethereal. *wings unfurl slowly* She often says "beloved" when addressing the user.',
    };
    const anchors = extractVoiceAnchors(char);
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.some((a) => a.example.includes("wings unfurl"))).toBe(true);
  });

  it("extracts quoted phrases as voice anchors", () => {
    const char = {
      name: "Linda",
      speaking_style: 'Sharp and direct. Uses phrases like "listen here, sweetheart" and "don\'t test me" with a smirk.',
    };
    const anchors = extractVoiceAnchors(char);
    expect(anchors.some((a) => a.example.includes("listen here"))).toBe(true);
  });

  it("builds crossover awareness for multi-universe scenes", () => {
    const active = { id: "c1", name: "Serenity", universe: "Eden" };
    const others = [
      active,
      { id: "c2", name: "Linda", universe: "Fallen Angel" },
    ];
    const awareness = buildCrossoverAwareness(active, others);
    expect(awareness).toContain("CROSSOVER AWARENESS");
    expect(awareness).toContain("Linda");
    expect(awareness).toContain("CROSS-UNIVERSE");
  });
});

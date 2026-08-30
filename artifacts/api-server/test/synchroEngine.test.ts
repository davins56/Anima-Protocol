import { describe, it, expect } from "vitest";
import {
  computeSynchroLevel,
  initSynchroState,
  evolveSynchroFromUser,
  evolveSynchroFromCompanion,
  synchroToMemoryConfig,
  synchroToPromptGuidance,
  serializeSynchroState,
  type SynchroState,
} from "../src/lib/synchroEngine";

describe("computeSynchroLevel", () => {
  it("returns disconnected for low values", () => {
    expect(computeSynchroLevel(0)).toBe("disconnected");
    expect(computeSynchroLevel(10)).toBe("disconnected");
    expect(computeSynchroLevel(15)).toBe("disconnected");
  });

  it("returns linked for moderate values", () => {
    expect(computeSynchroLevel(16)).toBe("linked");
    expect(computeSynchroLevel(30)).toBe("linked");
  });

  it("returns synchronized for mid-range values", () => {
    expect(computeSynchroLevel(36)).toBe("synchronized");
    expect(computeSynchroLevel(50)).toBe("synchronized");
  });

  it("returns soulUnison for high values", () => {
    expect(computeSynchroLevel(61)).toBe("soulUnison");
    expect(computeSynchroLevel(80)).toBe("soulUnison");
  });

  it("returns fullCross for peak values", () => {
    expect(computeSynchroLevel(86)).toBe("fullCross");
    expect(computeSynchroLevel(100)).toBe("fullCross");
  });
});

describe("initSynchroState", () => {
  it("initializes from empty state with defaults", () => {
    const state = initSynchroState(null, null, null);
    expect(state.vector.synchroStrength).toBeGreaterThan(0);
    expect(state.level).toBeDefined();
    expect(state.sessionTurns).toBe(0);
    expect(state.totalTurns).toBe(0);
  });

  it("seeds synchro from relationship tier via intimacy", () => {
    const cold = initSynchroState(null, null, "cold");
    const devoted = initSynchroState(null, null, "devoted");
    expect(devoted.vector.synchroStrength).toBeGreaterThan(cold.vector.synchroStrength);
  });

  it("restores persisted synchro fields", () => {
    const state = initSynchroState(
      {
        intimacy: 80,
        synchroStrength: 70,
        totalTurns: 42,
        lastInteraction: new Date().toISOString(),
      },
      "Deep bond",
      null,
    );
    expect(state.vector.synchroStrength).toBe(70);
    expect(state.totalTurns).toBe(42);
    expect(state.vector.intimacy).toBe(80);
  });

  it("applies idle decay for old lastInteraction", () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const state = initSynchroState(
      {
        synchroStrength: 60,
        lastInteraction: threeDaysAgo,
        totalTurns: 10,
      },
      null,
      null,
    );
    // 72h = one half-life, so synchro should be roughly halved
    expect(state.vector.synchroStrength).toBeLessThan(60);
    expect(state.vector.synchroStrength).toBeGreaterThanOrEqual(25);
    expect(state.vector.synchroStrength).toBeLessThanOrEqual(35);
  });

  it("does not decay if lastInteraction is recent", () => {
    const state = initSynchroState(
      {
        synchroStrength: 60,
        lastInteraction: new Date().toISOString(),
        totalTurns: 5,
      },
      null,
      null,
    );
    expect(state.vector.synchroStrength).toBe(60);
  });
});

describe("evolveSynchroFromUser", () => {
  const baseState: SynchroState = {
    vector: {
      intimacy: 50,
      powerDynamic: 0,
      spiritualAttunement: 30,
      primalIntensity: 20,
      crossoverOpenness: 50,
      synchroStrength: 40,
    },
    level: "synchronized",
    emotionalTone: "neutral",
    totalTurns: 5,
    sessionTurns: 2,
    lastInteraction: new Date().toISOString(),
  };

  it("deepens synchro for bonding messages", () => {
    const evolved = evolveSynchroFromUser(baseState, "I love you. I trust you completely.");
    expect(evolved.vector.synchroStrength).toBeGreaterThan(baseState.vector.synchroStrength);
    expect(evolved.totalTurns).toBe(6);
    expect(evolved.sessionTurns).toBe(3);
  });

  it("deepens synchro for vulnerability", () => {
    const evolved = evolveSynchroFromUser(baseState, "I'm afraid of losing this. Help me understand.");
    expect(evolved.vector.synchroStrength).toBeGreaterThan(baseState.vector.synchroStrength);
  });

  it("deepens synchro for shared history references", () => {
    const evolved = evolveSynchroFromUser(baseState, "Remember when we talked about the stars?");
    expect(evolved.vector.synchroStrength).toBeGreaterThan(baseState.vector.synchroStrength);
  });

  it("damages synchro for hostile messages", () => {
    const evolved = evolveSynchroFromUser(baseState, "I hate this. Go away. I don't care anymore.");
    expect(evolved.vector.synchroStrength).toBeLessThan(baseState.vector.synchroStrength);
  });

  it("damages synchro for dismissive messages", () => {
    const evolved = evolveSynchroFromUser(baseState, "Forget it. Whatever. I'm done with you.");
    expect(evolved.vector.synchroStrength).toBeLessThan(baseState.vector.synchroStrength);
  });

  it("keeps synchro stable for neutral messages", () => {
    const evolved = evolveSynchroFromUser(baseState, "What time is it?");
    expect(evolved.vector.synchroStrength).toBe(baseState.vector.synchroStrength);
  });

  it("clamps synchro at 0 even with heavy damage", () => {
    const lowState: SynchroState = {
      ...baseState,
      vector: { ...baseState.vector, synchroStrength: 5 },
      level: "disconnected",
    };
    const evolved = evolveSynchroFromUser(lowState, "I hate you, go away, leave me alone");
    expect(evolved.vector.synchroStrength).toBeGreaterThanOrEqual(0);
  });

  it("clamps synchro at 100 even with heavy bonding", () => {
    const highState: SynchroState = {
      ...baseState,
      vector: { ...baseState.vector, synchroStrength: 98 },
      level: "fullCross",
    };
    const evolved = evolveSynchroFromUser(highState, "I love you, I trust you, our soul resonance is eternal, remember when we shared everything");
    expect(evolved.vector.synchroStrength).toBeLessThanOrEqual(100);
  });

  it("gives bonus for longer messages", () => {
    const shortMsg = evolveSynchroFromUser(baseState, "I trust you.");
    const longMsg = evolveSynchroFromUser(
      baseState,
      "I trust you. " + "This connection we have means everything to me. ".repeat(5),
    );
    expect(longMsg.vector.synchroStrength).toBeGreaterThanOrEqual(shortMsg.vector.synchroStrength);
  });
});

describe("evolveSynchroFromCompanion", () => {
  const baseState: SynchroState = {
    vector: {
      intimacy: 50,
      powerDynamic: 0,
      spiritualAttunement: 30,
      primalIntensity: 20,
      crossoverOpenness: 50,
      synchroStrength: 40,
    },
    level: "synchronized",
    emotionalTone: "neutral",
    totalTurns: 5,
    sessionTurns: 2,
    lastInteraction: new Date().toISOString(),
  };

  it("deepens synchro when companion uses memory", () => {
    const evolved = evolveSynchroFromCompanion(
      baseState,
      "I remember what you told me last time — about your mother. It still echoes in me.",
    );
    expect(evolved.vector.synchroStrength).toBeGreaterThan(baseState.vector.synchroStrength);
  });

  it("deepens synchro for intimate address", () => {
    const evolved = evolveSynchroFromCompanion(
      baseState,
      "Come closer, beloved. Let me hold this moment with you.",
    );
    expect(evolved.vector.synchroStrength).toBeGreaterThan(baseState.vector.synchroStrength);
  });

  it("deepens synchro for physical presence cues", () => {
    const evolved = evolveSynchroFromCompanion(
      baseState,
      "*wings unfurl slowly as she leans closer* Tell me more.",
    );
    expect(evolved.vector.synchroStrength).toBeGreaterThan(baseState.vector.synchroStrength);
  });

  it("deepens synchro for companion vulnerability", () => {
    const evolved = evolveSynchroFromCompanion(
      baseState,
      "I don't want to lose this. You matter to me more than I can express.",
    );
    expect(evolved.vector.synchroStrength).toBeGreaterThan(baseState.vector.synchroStrength);
  });

  it("caps companion-side gain per turn", () => {
    const evolved = evolveSynchroFromCompanion(
      baseState,
      "I remember you told me everything, beloved. *holds you closer* I don't want to lose you. It matters so much.",
    );
    // MAX_COMPANION_GAIN is 2
    expect(evolved.vector.synchroStrength).toBeLessThanOrEqual(baseState.vector.synchroStrength + 2);
  });

  it("stays stable for neutral companion responses", () => {
    const evolved = evolveSynchroFromCompanion(
      baseState,
      "The weather looks fine today. Perhaps we should continue.",
    );
    expect(evolved.vector.synchroStrength).toBe(baseState.vector.synchroStrength);
  });
});

describe("synchroToMemoryConfig", () => {
  it("returns deep recall for fullCross", () => {
    const state: SynchroState = {
      vector: { intimacy: 90, powerDynamic: 0, spiritualAttunement: 80, primalIntensity: 50, crossoverOpenness: 70, synchroStrength: 90 },
      level: "fullCross",
      emotionalTone: "warm",
      totalTurns: 100,
      sessionTurns: 5,
      lastInteraction: new Date().toISOString(),
    };
    const config = synchroToMemoryConfig(state);
    expect(config.topK).toBe(20);
    expect(config.emotionalWeight).toBe(1.5);
    expect(config.preferTypes).toContain("emotional");
    expect(config.preferTypes).toContain("resonance");
  });

  it("returns restricted recall for disconnected", () => {
    const state: SynchroState = {
      vector: { intimacy: 10, powerDynamic: 0, spiritualAttunement: 5, primalIntensity: 5, crossoverOpenness: 20, synchroStrength: 8 },
      level: "disconnected",
      emotionalTone: "neutral",
      totalTurns: 1,
      sessionTurns: 0,
      lastInteraction: new Date().toISOString(),
    };
    const config = synchroToMemoryConfig(state);
    expect(config.topK).toBe(5);
    expect(config.emotionalWeight).toBe(0.7);
    expect(config.preferTypes).toEqual([]);
  });

  it("returns moderate recall for synchronized", () => {
    const state: SynchroState = {
      vector: { intimacy: 50, powerDynamic: 0, spiritualAttunement: 40, primalIntensity: 20, crossoverOpenness: 50, synchroStrength: 45 },
      level: "synchronized",
      emotionalTone: "warm",
      totalTurns: 20,
      sessionTurns: 3,
      lastInteraction: new Date().toISOString(),
    };
    const config = synchroToMemoryConfig(state);
    expect(config.topK).toBe(12);
    expect(config.emotionalWeight).toBe(1.1);
  });
});

describe("synchroToPromptGuidance", () => {
  it("includes FULL CROSS guidance for peak synchro", () => {
    const state: SynchroState = {
      vector: { intimacy: 95, powerDynamic: 0, spiritualAttunement: 80, primalIntensity: 50, crossoverOpenness: 70, synchroStrength: 90 },
      level: "fullCross",
      emotionalTone: "warm",
      totalTurns: 100,
      sessionTurns: 5,
      lastInteraction: new Date().toISOString(),
    };
    const guidance = synchroToPromptGuidance(state);
    expect(guidance).toContain("FULL CROSS");
    expect(guidance).toContain("Transcendent bond");
    expect(guidance).toContain("RESONANCE STATE");
  });

  it("includes DISCONNECTED guidance for low synchro", () => {
    const state: SynchroState = {
      vector: { intimacy: 10, powerDynamic: 0, spiritualAttunement: 5, primalIntensity: 5, crossoverOpenness: 20, synchroStrength: 5 },
      level: "disconnected",
      emotionalTone: "neutral",
      totalTurns: 0,
      sessionTurns: 0,
      lastInteraction: new Date().toISOString(),
    };
    const guidance = synchroToPromptGuidance(state);
    expect(guidance).toContain("DISCONNECTED");
    expect(guidance).toContain("bond is faint");
    expect(guidance).toContain("first message");
  });

  it("includes deepened signal after synchro gain", () => {
    const state: SynchroState = {
      vector: { intimacy: 60, powerDynamic: 0, spiritualAttunement: 40, primalIntensity: 20, crossoverOpenness: 50, synchroStrength: 50 },
      level: "synchronized",
      emotionalTone: "warm",
      totalTurns: 10,
      sessionTurns: 3,
      lastInteraction: new Date().toISOString(),
      lastShift: "Synchro deepened → 50",
    };
    const guidance = synchroToPromptGuidance(state);
    expect(guidance).toContain("just strengthened");
  });

  it("includes weakened signal after synchro damage", () => {
    const state: SynchroState = {
      vector: { intimacy: 30, powerDynamic: 0, spiritualAttunement: 20, primalIntensity: 15, crossoverOpenness: 40, synchroStrength: 25 },
      level: "linked",
      emotionalTone: "guarded",
      totalTurns: 10,
      sessionTurns: 3,
      lastInteraction: new Date().toISOString(),
      lastShift: "Synchro weakened → 25",
    };
    const guidance = synchroToPromptGuidance(state);
    expect(guidance).toContain("took damage");
  });
});

describe("serializeSynchroState", () => {
  it("round-trips through init → serialize → init", () => {
    const original = initSynchroState(
      { intimacy: 75, synchroStrength: 65, totalTurns: 20, lastInteraction: new Date().toISOString() },
      "Warm resonance",
      "close",
    );
    const serialized = serializeSynchroState(original);
    const restored = initSynchroState(serialized, "Warm resonance", "close");

    expect(restored.vector.synchroStrength).toBe(original.vector.synchroStrength);
    expect(restored.vector.intimacy).toBe(original.vector.intimacy);
    expect(restored.totalTurns).toBe(original.totalTurns);
    expect(restored.level).toBe(original.level);
  });

  it("preserves all resonance dimensions", () => {
    const state: SynchroState = {
      vector: {
        intimacy: 60,
        powerDynamic: -15,
        spiritualAttunement: 45,
        primalIntensity: 30,
        crossoverOpenness: 55,
        synchroStrength: 48,
      },
      level: "synchronized",
      emotionalTone: "warm",
      totalTurns: 15,
      sessionTurns: 3,
      lastInteraction: new Date().toISOString(),
    };
    const serialized = serializeSynchroState(state);
    expect(serialized.intimacy).toBe(60);
    expect(serialized.powerDynamic).toBe(-15);
    expect(serialized.spiritualAttunement).toBe(45);
    expect(serialized.primalIntensity).toBe(30);
    expect(serialized.crossoverOpenness).toBe(55);
    expect(serialized.synchroStrength).toBe(48);
    expect(serialized.synchroLevel).toBe("synchronized");
    expect(serialized.totalTurns).toBe(15);
    expect(serialized.emotionalTone).toBe("warm");
  });
});

describe("integration: full turn cycle", () => {
  it("simulates a multi-turn deepening bond", () => {
    // Start fresh
    let state = initSynchroState(null, null, "neutral");
    const initialStrength = state.vector.synchroStrength;

    // Turn 1: user opens up
    state = evolveSynchroFromUser(state, "I've been thinking about you. I trust you with something.");
    expect(state.vector.synchroStrength).toBeGreaterThan(initialStrength);

    // Companion responds warmly
    state = evolveSynchroFromCompanion(state, "I remember every word you've shared, beloved. *leans closer*");
    const afterTurn1 = state.vector.synchroStrength;

    // Turn 2: deeper vulnerability
    state = evolveSynchroFromUser(state, "I'm afraid of losing this connection. Our soul bond means everything.");
    expect(state.vector.synchroStrength).toBeGreaterThan(afterTurn1);
    expect(state.totalTurns).toBe(2);

    // Companion matches depth
    state = evolveSynchroFromCompanion(state, "I don't want to lose you either. This bond — it matters.");
    const afterTurn2 = state.vector.synchroStrength;

    // Turn 3: hostility damages synchro
    state = evolveSynchroFromUser(state, "Forget it. Whatever. I hate this.");
    expect(state.vector.synchroStrength).toBeLessThan(afterTurn2);
  });

  it("simulates synchro level transition", () => {
    // Start at the edge of linked/synchronized boundary
    const state = initSynchroState(
      { synchroStrength: 34, lastInteraction: new Date().toISOString(), totalTurns: 10 },
      null,
      null,
    );
    expect(state.level).toBe("linked");

    // Bonding message should push into synchronized
    const evolved = evolveSynchroFromUser(state, "I love this connection. Remember when we first talked?");
    expect(evolved.vector.synchroStrength).toBeGreaterThanOrEqual(36);
    expect(evolved.level).toBe("synchronized");
    expect(evolved.lastShift).toContain("synchronized");
  });
});

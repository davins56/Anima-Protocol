import { describe, it, expect } from "vitest";
import {
  COMPANION_AFFECT_SOURCE,
  COMPANION_AFFECT_VERSION,
  companionAffectToPromptGuidance,
  detectAffectCue,
  evolveCompanionAffectFromCompanion,
  evolveCompanionAffectFromUser,
  initCompanionAffect,
  mergeEmotionalStateWithAffect,
  primaryFromLabel,
  radiationEventFromAffect,
  serializeCompanionAffect,
  toCompanionAffectSnapshot,
} from "../src/lib/companionAffect";

describe("initCompanionAffect", () => {
  it("starts at a resting watchful-neutral floor, not an empty fake label", () => {
    const state = initCompanionAffect(null);
    expect(state.primary).toBe("neutral");
    expect(state.intensity).toBeGreaterThan(0);
    expect(state.mood).toBe("quiet-watchful");
    expect(state.version).toBe(COMPANION_AFFECT_VERSION);
  });

  it("restores nested selfState from emotionalState jsonb", () => {
    const state = initCompanionAffect({
      intimacy: 70,
      synchroStrength: 55,
      selfState: {
        primary: "tender",
        intensity: 61,
        energy: 40,
        mood: "tender-aching",
        focus: "steward",
        intent: "comfort",
        openLoops: ["their hurt"],
        updatedAt: "2026-09-14T00:00:00.000Z",
      },
    });
    expect(state.primary).toBe("tender");
    expect(state.intensity).toBe(61);
    expect(state.openLoops).toEqual(["their hurt"]);
    expect(state.mood).toBe("tender-aching");
  });
});

describe("detectAffectCue / evolve from conversation", () => {
  it("maps affection to romantic and deepens intensity across turns", () => {
    let state = initCompanionAffect(null, "2026-09-14T00:00:00.000Z");
    state = evolveCompanionAffectFromUser(
      state,
      "I love you. Stay with me.",
      "2026-09-14T00:01:00.000Z",
    );
    expect(state.primary).toBe("romantic");
    expect(state.intensity).toBeGreaterThan(30);
    const after = evolveCompanionAffectFromUser(
      state,
      "I miss you so much. Hold me.",
      "2026-09-14T00:02:00.000Z",
    );
    expect(after.primary).toBe("romantic");
    expect(after.intensity).toBeGreaterThan(state.intensity);
  });

  it("does not snap primary on a weak opposing cue (hysteresis)", () => {
    let state = initCompanionAffect({
      selfState: {
        primary: "romantic",
        intensity: 72,
        energy: 60,
        mood: "tender-open",
        updatedAt: "2026-09-14T00:00:00.000Z",
      },
    });
    state = evolveCompanionAffectFromUser(state, "ok, why though?");
    expect(state.primary).toBe("romantic");
  });

  it("shifts when the pull is strong enough", () => {
    let state = initCompanionAffect({
      selfState: {
        primary: "playful",
        intensity: 30,
        energy: 50,
        updatedAt: "2026-09-14T00:00:00.000Z",
      },
    });
    state = evolveCompanionAffectFromUser(
      state,
      "I'm so sad. I feel heartbroken and lonely.",
    );
    expect(state.primary).toBe("tender");
    expect(state.intent).toBe("comfort");
  });

  it("lets the companion's own reply confirm the feeling", () => {
    let state = initCompanionAffect({
      selfState: { primary: "curious", intensity: 40, energy: 55 },
    });
    state = evolveCompanionAffectFromCompanion(
      state,
      "[EMOTION: tender] I am here. You do not have to carry that alone.",
    );
    expect(state.primary).toBe("tender");
  });

  it("parses explicit emotion tags", () => {
    expect(detectAffectCue("[EMOTION: grief-stricken] I know.")?.primary).toBe(
      "sad",
    );
    expect(primaryFromLabel("quiet-watchful")).toBe("watchful");
  });
});

describe("reply conditioning + Key radiation hook", () => {
  it("injects a SELF-STATE block that names the feeling without a mood menu", () => {
    const state = initCompanionAffect({
      selfState: {
        primary: "playful",
        intensity: 64,
        energy: 70,
        mood: "stirred",
        intent: "play",
      },
    });
    const guidance = companionAffectToPromptGuidance(state);
    expect(guidance).toContain("SELF-STATE");
    expect(guidance).toContain("playful");
    expect(guidance).toMatch(/never announce/i);
    expect(guidance.length).toBeLessThanOrEqual(480);
  });

  it("exports a stable radiation event for future Resonance Keys", () => {
    const state = initCompanionAffect({
      selfState: {
        primary: "romantic",
        intensity: 80,
        energy: 62,
        mood: "tender-open",
        updatedAt: "2026-09-14T12:00:00.000Z",
      },
    });
    const event = radiationEventFromAffect(state, 74);
    expect(event).toMatchObject({
      source: COMPANION_AFFECT_SOURCE,
      version: 1,
      primary: "romantic",
      intensity: 80,
      synchro_strength: 74,
      mood: "tender-open",
    });
    expect(event.valence).toBeGreaterThan(0.4);
    expect(event.arousal).toBeGreaterThan(0.5);
    expect(event.felt_at).toBe("2026-09-14T12:00:00.000Z");
  });

  it("round-trips through emotionalState jsonb without wiping synchro fields", () => {
    const affect = initCompanionAffect({
      selfState: { primary: "curious", intensity: 44, energy: 51 },
    });
    const merged = mergeEmotionalStateWithAffect(
      { intimacy: 70, synchroStrength: 55, emotionalTone: "warm" },
      affect,
    );
    expect(merged.intimacy).toBe(70);
    expect(merged.synchroStrength).toBe(55);
    expect(merged.selfState).toEqual(serializeCompanionAffect(affect));
    const restored = initCompanionAffect(merged);
    expect(restored.primary).toBe("curious");
    expect(restored.intensity).toBe(44);
  });

  it("snapshot is the SSE/UI contract", () => {
    const state = initCompanionAffect({
      selfState: { primary: "watchful", intensity: 33, energy: 29 },
    });
    expect(toCompanionAffectSnapshot(state, 41)).toMatchObject({
      version: 1,
      primary: "watchful",
      intensity: 33,
      energy: 29,
      synchro_strength: 41,
    });
  });
});

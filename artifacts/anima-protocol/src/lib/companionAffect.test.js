import { describe, it, expect } from "vitest";
import {
  COMPANION_AFFECT_SOURCE,
  characterEmotionFromAffect,
  parseCompanionAffectSnapshot,
  radiationEventFromAffect,
} from "./companionAffect";

describe("parseCompanionAffectSnapshot", () => {
  it("accepts the SSE/API contract and rejects junk", () => {
    expect(parseCompanionAffectSnapshot(null)).toBeNull();
    expect(parseCompanionAffectSnapshot({ intensity: 40 })).toBeNull();
    const snap = parseCompanionAffectSnapshot({
      version: 1,
      primary: "Tender",
      intensity: 58,
      mood: "tender-aching",
      energy: 44,
      focus: "steward",
      intent: "comfort",
      updated_at: "2026-09-14T00:00:00.000Z",
      synchro_strength: 61,
    });
    expect(snap).toMatchObject({
      primary: "tender",
      intensity: 58,
      synchro_strength: 61,
      mood: "tender-aching",
    });
  });
});

describe("characterEmotionFromAffect", () => {
  it("maps onto the existing ChatHeader emotion shape", () => {
    const snap = parseCompanionAffectSnapshot({
      primary: "curious",
      intensity: 73,
      energy: 60,
      mood: "stirred",
    });
    expect(characterEmotionFromAffect(snap)).toEqual({
      emotion: "curious",
      intensity: 7,
      emotion_level: "stirred",
      arousal: 60,
      source: COMPANION_AFFECT_SOURCE,
    });
  });
});

describe("radiationEventFromAffect", () => {
  it("exports the Key-radiation hook without building Keys", () => {
    const snap = parseCompanionAffectSnapshot({
      primary: "romantic",
      intensity: 80,
      energy: 62,
      mood: "tender-open",
      updated_at: "2026-09-14T12:00:00.000Z",
      synchro_strength: 74,
    });
    expect(radiationEventFromAffect(snap)).toMatchObject({
      source: COMPANION_AFFECT_SOURCE,
      version: 1,
      primary: "romantic",
      intensity: 80,
      synchro_strength: 74,
      mood: "tender-open",
    });
    expect(radiationEventFromAffect(snap)?.valence).toBeGreaterThan(0.4);
  });
});

import { describe, expect, it } from "vitest";
import {
  AFFECT_DRIFT_STEP_MINUTES,
  COMPANION_AFFECT_SOURCE,
  affectLevelLabel,
  characterEmotionFromAffect,
  driftCharacterEmotion,
  parseCompanionAffectSnapshot,
} from "./companionAffect";

const T0 = Date.parse("2026-11-13T20:00:00.000Z");
const min = (m) => T0 + m * 60_000;

function emotionFrom(raw) {
  return characterEmotionFromAffect(parseCompanionAffectSnapshot({ updated_at: new Date(T0).toISOString(), ...raw }));
}

describe("driftCharacterEmotion", () => {
  it("leaves a fresh feeling alone inside the first step", () => {
    const e = emotionFrom({ primary: "playful", intensity: 70, energy: 80, mood: "stirred" });
    expect(driftCharacterEmotion(e, min(AFFECT_DRIFT_STEP_MINUTES - 1))).toBe(e);
  });

  it("eases intensity and arousal back a step at a time", () => {
    const e = emotionFrom({ primary: "playful", intensity: 70, energy: 80, mood: "stirred" });
    const one = driftCharacterEmotion(e, min(AFFECT_DRIFT_STEP_MINUTES));
    expect(one.intensity_pct).toBe(66);
    expect(one.arousal).toBe(77);
    expect(one.emotion).toBe("playful");
    const two = driftCharacterEmotion(e, min(AFFECT_DRIFT_STEP_MINUTES * 2));
    expect(two.intensity_pct).toBeLessThan(one.intensity_pct);
    expect(two.arousal).toBeLessThan(one.arousal);
  });

  it("returns to her baseline feeling and level once the feeling fades", () => {
    const e = emotionFrom({ primary: "happy", intensity: 50, energy: 70, mood: "happy" });
    const later = driftCharacterEmotion(e, min(12 * 60));
    expect(later.emotion).toBe("neutral");
    expect(later.emotion_level).toBe("quiet-watchful");
    expect(later.arousal).toBe(48);
  });

  it("drifts to a personality baseline the server sent, not to neutral", () => {
    const e = emotionFrom({
      primary: "happy",
      intensity: 50,
      energy: 70,
      mood: "happy",
      baseline_primary: "watchful",
      baseline_energy: 40,
    });
    const later = driftCharacterEmotion(e, min(12 * 60));
    expect(later.emotion).toBe("watchful");
    expect(later.arousal).toBe(40);
  });

  it("never touches entries that did not come from the server felt state", () => {
    const legacy = { emotion: "sad", intensity: 7, arousal: 30 };
    expect(driftCharacterEmotion(legacy, min(600))).toBe(legacy);
    expect(driftCharacterEmotion(null, min(600))).toBeNull();
  });

  it("keeps the client level words in step with the server's", () => {
    expect(affectLevelLabel("neutral", 22, 48)).toBe("quiet-watchful");
    expect(affectLevelLabel("curious", 30, 50)).toBe("interested");
    expect(affectLevelLabel("curious", 60, 50)).toBe("stirred");
    expect(affectLevelLabel("happy", 70, 50)).toBe("radiant");
    expect(affectLevelLabel("tender", 60, 40)).toBe("tender-aching");
  });

  it("characterEmotionFromAffect carries the drift inputs", () => {
    const e = emotionFrom({ primary: "curious", intensity: 41, energy: 52, mood: "curious" });
    expect(e).toMatchObject({ source: COMPANION_AFFECT_SOURCE, intensity_pct: 41, baseline_primary: "neutral" });
  });
});

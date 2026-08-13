import { describe, it, expect } from "vitest";
import {
  getEmotionPalette,
  getBuildMetrics,
  getPose,
  getSpeakingGesture,
  getVisemeOpenness,
  getIdleSway,
  resolvePresenceCast,
  lastSpokenLine,
  highlightedCastId,
  emotionCss,
  EMOTION_PALETTE,
  VULNERABLE_EMOTIONS,
} from "./livingPresence";

const korra = { id: "c1", name: "Korra", universe: "Avatar" };
const asami = { id: "c2", name: "Asami", universe: "Avatar" };
const goku = { id: "c3", name: "Goku", universe: "Dragon Ball" };

describe("getEmotionPalette", () => {
  it("returns a palette for known emotions", () => {
    expect(getEmotionPalette("joyful").hue).toBe(EMOTION_PALETTE.joyful.hue);
    expect(getEmotionPalette("angry").hue).toBe(EMOTION_PALETTE.angry.hue);
  });

  it("falls back to neutral for unknown or empty emotion", () => {
    expect(getEmotionPalette()).toEqual(EMOTION_PALETTE.neutral);
    expect(getEmotionPalette("sparkly")).toEqual(EMOTION_PALETTE.neutral);
  });
});

describe("getBuildMetrics", () => {
  it("scales athletic wider than petite", () => {
    expect(getBuildMetrics("athletic").shoulder).toBeGreaterThan(getBuildMetrics("petite").shoulder);
    expect(getBuildMetrics("tall").height).toBeGreaterThan(getBuildMetrics("petite").height);
  });

  it("defaults unknown builds to average", () => {
    expect(getBuildMetrics("mecha")).toEqual(getBuildMetrics("average"));
    expect(getBuildMetrics()).toEqual(getBuildMetrics("average"));
  });
});

describe("getPose", () => {
  it("slumps sad and opens joyful arms", () => {
    const sad = getPose("sad", 8);
    const joy = getPose("joyful", 8);
    expect(sad.headDrop).toBeGreaterThan(joy.headDrop);
    expect(sad.vulnerable).toBe(true);
    expect(joy.bounce).toBe(true);
    expect(Math.abs(joy.armL.rotate)).toBeGreaterThan(Math.abs(getPose("calm").armL.rotate));
  });

  it("clamps intensity and unknown emotion", () => {
    expect(getPose("calm", 99).intensity).toBe(1);
    expect(getPose("calm", -4).intensity).toBe(0);
    expect(getPose("nope").emotion).toBe("neutral");
  });

  it("marks the vulnerable set", () => {
    for (const e of VULNERABLE_EMOTIONS) {
      expect(getPose(e).vulnerable).toBe(true);
    }
    expect(getPose("joyful").vulnerable).toBe(false);
  });
});

describe("getSpeakingGesture / viseme", () => {
  it("returns zeroed arms when silent", () => {
    const g = getSpeakingGesture(1200, { speaking: false });
    expect(g.armL.rotate).toBe(0);
    expect(g.armR.lift).toBe(0);
  });

  it("moves arms while speaking or thinking", () => {
    const speak = getSpeakingGesture(800, { speaking: true });
    const think = getSpeakingGesture(800, { thinking: true });
    expect(speak.armL.rotate).not.toBe(0);
    expect(think.headTilt).toBeGreaterThan(0);
  });

  it("keeps visemes nearly closed when silent and open while speaking", () => {
    expect(getVisemeOpenness(0, false)).toBeLessThan(0.15);
    expect(getVisemeOpenness(250, true)).toBeGreaterThan(0.2);
    expect(getVisemeOpenness(900, true)).toBeLessThanOrEqual(1);
  });

  it("sways more when bouncing or speaking", () => {
    expect(getIdleSway(false, true)).toBeGreaterThan(getIdleSway(false, false));
    expect(getIdleSway(true, false)).toBeGreaterThan(getIdleSway(false, false));
  });
});

describe("resolvePresenceCast", () => {
  it("returns the solo character", () => {
    expect(resolvePresenceCast({ mode: "solo", character_id: "c1" }, [korra, asami])).toEqual([korra]);
  });

  it("returns group members in roster order", () => {
    expect(
      resolvePresenceCast(
        { mode: "group", group_character_ids: ["c3", "c1"] },
        [korra, asami, goku],
      ),
    ).toEqual([korra, goku]);
  });

  it("returns empty for missing session or roster", () => {
    expect(resolvePresenceCast(null, [korra])).toEqual([]);
    expect(resolvePresenceCast({ mode: "solo", character_id: "c1" }, [])).toEqual([]);
    expect(resolvePresenceCast({ mode: "solo", character_id: "missing" }, [korra])).toEqual([]);
  });
});

describe("lastSpokenLine / highlightedCastId", () => {
  const messages = [
    { role: "user", content: "hey", character_name: "You" },
    { role: "assistant", content: "hello", character_name: "Korra" },
    { character_name: "__thinking__", content: "..." },
    { type: "event", content: "thunder" },
  ];

  it("skips thinking and event bubbles", () => {
    expect(lastSpokenLine(messages)?.character_name).toBe("Korra");
    expect(lastSpokenLine([])).toBeNull();
    expect(lastSpokenLine(null)).toBeNull();
  });

  it("highlights the last speaking companion", () => {
    expect(highlightedCastId([korra, asami], lastSpokenLine(messages), true)).toBe("c1");
    expect(highlightedCastId([korra], { role: "user" }, false)).toBeNull();
    expect(highlightedCastId([korra], { role: "user" }, true)).toBe("c1");
    expect(highlightedCastId([], lastSpokenLine(messages), true)).toBeNull();
  });
});

describe("emotionCss", () => {
  it("emits hsl with alpha", () => {
    expect(emotionCss("calm", 0.4)).toMatch(/^hsl\(190 88% 58% \/ 0\.4\)$/);
  });
});

/**
 * Header Feeling / Level / energy must move with the conversation.
 * Regression for the stuck "Feeling: NEUTRAL · Level: QUIET-WATCHFUL ·
 * Arousal: 48%" header: ordinary turns used to leave the felt state at its
 * resting default forever.
 */
import { describe, expect, it } from "vitest";
import {
  AFFECT_DRIFT_STEP_MINUTES,
  affectBaselineFromPersonality,
  detectAffectCue,
  driftCompanionAffect,
  evolveCompanionAffectFromCompanion,
  evolveCompanionAffectFromUser,
  initCompanionAffect,
  mergeEmotionalStateWithAffect,
  toCompanionAffectSnapshot,
  type CompanionAffect,
} from "../src/lib/companionAffect";

const T0 = Date.parse("2026-11-13T20:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

/** One full turn the way chat.ts runs it: user pass, then the reply pass. */
function turn(state: CompanionAffect, user: string, reply: string, minute: number): CompanionAffect {
  const afterUser = evolveCompanionAffectFromUser(state, user, at(minute));
  return evolveCompanionAffectFromCompanion(afterUser, reply, at(minute));
}

const FRIENDLY_CHAT: Array<[string, string]> = [
  ["Hey, how was your day today?", "It was calm. I spent most of it reading."],
  ["What were you reading about?", "Old sea charts, mostly. The margins are full of notes."],
  ["That sounds really interesting, tell me more", "Sailors drew monsters where the maps ran out."],
  ["Haha that is amazing, thank you for sharing", "I'm glad it made you smile."],
  ["Honestly I've been struggling a bit this week", "I'm here. Tell me what's been weighing on you."],
  ["Work has been a lot and I feel tired", "That sounds exhausting. You don't have to carry it alone."],
];

describe("Feeling and Level shift each turn", () => {
  it("a friendly conversation no longer stays at neutral / quiet-watchful / 48", () => {
    let state = initCompanionAffect(null, at(0));
    const seen = new Set<string>();
    const energies = new Set<number>();
    FRIENDLY_CHAT.forEach(([user, reply], i) => {
      const before = toCompanionAffectSnapshot(state);
      state = turn(state, user, reply, i + 1);
      const after = toCompanionAffectSnapshot(state);
      seen.add(`${after.primary}/${after.mood}`);
      energies.add(after.energy);
      // Something visible changes on every turn.
      expect(
        after.primary !== before.primary ||
          after.mood !== before.mood ||
          after.intensity !== before.intensity ||
          after.energy !== before.energy,
      ).toBe(true);
    });
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(energies.size).toBeGreaterThanOrEqual(3);
    expect([...seen]).not.toEqual(["neutral/quiet-watchful"]);
  });

  it("plain engaged talk pulls a resting companion toward curious", () => {
    const state = evolveCompanionAffectFromUser(
      initCompanionAffect(null, at(0)),
      "I went to the market this morning and found some strange old books",
      at(1),
    );
    expect(state.primary).toBe("curious");
    expect(state.mood).not.toBe("quiet-watchful");
    expect(state.energy).toBeGreaterThan(48);
  });

  it("warmth reads happy, vulnerability reads tender, rejection reads sad", () => {
    const rest = initCompanionAffect(null, at(0));
    expect(evolveCompanionAffectFromUser(rest, "Thank you, that was so sweet", at(1)).primary).toBe("happy");
    expect(evolveCompanionAffectFromUser(rest, "Honestly I've been struggling lately", at(1)).primary).toBe("tender");
    expect(evolveCompanionAffectFromUser(rest, "Shut up, you're useless", at(1)).primary).toBe("sad");
    expect(evolveCompanionAffectFromUser(rest, "forget it, never mind", at(1)).primary).toBe("cold");
  });

  it("everyday phrasing is not read as rejection", () => {
    const rest = initCompanionAffect(null, at(0));
    const next = evolveCompanionAffectFromUser(rest, "I have to leave for work soon, talk later", at(1));
    expect(["sad", "cold", "hostile"]).not.toContain(next.primary);
  });

  it("a curt reply settles energy instead of lifting it", () => {
    const warm = initCompanionAffect({ selfState: { primary: "happy", intensity: 50, energy: 66, updatedAt: at(0) } });
    const next = evolveCompanionAffectFromUser(warm, "ok", at(1));
    expect(next.energy).toBeLessThan(66);
  });

  it("the companion's own reply never counts as user engagement", () => {
    expect(detectAffectCue("Sure, I can tell you about the stars tonight", { source: "companion" })).toBeNull();
    expect(detectAffectCue("Sure, I can tell you about the stars tonight", { source: "user" })?.primary).toBeTruthy();
  });

  it("a strong feeling still resists a weak opposing cue (hysteresis kept)", () => {
    const romantic = initCompanionAffect({ selfState: { primary: "romantic", intensity: 72, energy: 60, updatedAt: at(0) } });
    expect(evolveCompanionAffectFromUser(romantic, "What did you do this morning anyway?", at(1)).primary).toBe("romantic");
  });
});

describe("drift back toward baseline", () => {
  it("turns with no cue let a faded feeling settle back to rest", () => {
    let state = initCompanionAffect({ selfState: { primary: "happy", intensity: 34, energy: 60, updatedAt: at(0) } });
    for (let i = 1; i <= 6; i += 1) {
      state = evolveCompanionAffectFromCompanion(state, "Mm.", at(i));
      state = applyNoCueUserTurn(state, at(i));
    }
    expect(state.primary).toBe("neutral");
    expect(state.mood).toBe("quiet-watchful");
  });

  it("quiet time eases intensity and energy back in whole steps", () => {
    const stirred = initCompanionAffect({ selfState: { primary: "playful", intensity: 70, energy: 80, updatedAt: at(0) } });
    expect(driftCompanionAffect(stirred, at(AFFECT_DRIFT_STEP_MINUTES - 1))).toBe(stirred);
    const oneStep = driftCompanionAffect(stirred, at(AFFECT_DRIFT_STEP_MINUTES));
    expect(oneStep.intensity).toBeLessThan(70);
    expect(oneStep.energy).toBeLessThan(80);
    expect(oneStep.primary).toBe("playful");
    const hoursLater = driftCompanionAffect(stirred, at(12 * 60));
    expect(hoursLater.primary).toBe("neutral");
    expect(hoursLater.intensity).toBe(22);
    expect(hoursLater.energy).toBe(48);
    // Same input, same answer: a persist replay cannot land somewhere else.
    expect(driftCompanionAffect(stirred, at(12 * 60))).toEqual(hoursLater);
  });

  it("coming back after a long gap starts from rest, then moves again", () => {
    const old = initCompanionAffect({ selfState: { primary: "sad", intensity: 60, energy: 30, updatedAt: at(0) } });
    const next = evolveCompanionAffectFromUser(old, "Hey! I missed talking with you, how have you been?", at(24 * 60));
    expect(next.primary).not.toBe("sad");
  });
});

describe("personality baseline", () => {
  it("reads a resting feeling from personality text", () => {
    expect(affectBaselineFromPersonality("Cheerful, bubbly and playful").primary).toBe("playful");
    expect(affectBaselineFromPersonality("Stoic, reserved and guarded").primary).toBe("watchful");
    expect(affectBaselineFromPersonality("Warm, gentle, caring").primary).toBe("tender");
    expect(affectBaselineFromPersonality(null)).toEqual({ primary: "neutral", intensity: 22, energy: 48 });
  });

  it("drifts back to her own baseline, not to neutral", () => {
    const baseline = affectBaselineFromPersonality("Stoic, reserved, disciplined");
    let state = initCompanionAffect(null, at(0), baseline);
    expect(state.primary).toBe("watchful");
    state = evolveCompanionAffectFromUser(state, "Haha that is so funny, thank you!", at(1));
    expect(state.primary).not.toBe("watchful");
    const later = driftCompanionAffect(state, at(12 * 60));
    expect(later.primary).toBe("watchful");
    expect(later.energy).toBe(40);
  });

  it("the baseline survives the jsonb round trip and reaches the snapshot", () => {
    const baseline = affectBaselineFromPersonality("Energetic and witty");
    const state = initCompanionAffect(null, at(0), baseline);
    const restored = initCompanionAffect(mergeEmotionalStateWithAffect({ synchroStrength: 40 }, state));
    expect(restored.baseline).toEqual(baseline);
    expect(toCompanionAffectSnapshot(restored)).toMatchObject({ baseline_primary: "playful", baseline_energy: 60 });
  });
});

describe("group chats: each companion moves on her own turns", () => {
  it("two companions' states evolve independently from their own turns", () => {
    // Each character has her own companion_memories row; chat.ts evolves only
    // the speaker (SEC-005b). Model that with two independent states.
    let asami = initCompanionAffect(null, at(0), affectBaselineFromPersonality("Confident and determined"));
    let korra = initCompanionAffect(null, at(0), affectBaselineFromPersonality("Energetic, bold and playful"));
    const korraBefore = toCompanionAffectSnapshot(korra);

    asami = turn(asami, "Asami, honestly I've been struggling with this engine", "I'm here. Let's look at it together.", 1);
    asami = turn(asami, "Asami, thank you, that really helps", "I'm glad. You did the hard part.", 2);

    // Korra was not addressed and did not speak: her header stays put.
    expect(toCompanionAffectSnapshot(korra)).toEqual(korraBefore);
    expect(toCompanionAffectSnapshot(asami).primary).not.toBe("neutral");

    korra = turn(korra, "Korra, haha that was hilarious", "Ha! Told you it would work.", 3);
    expect(korra.primary).toBe("playful");
    expect(asami.primary).not.toBe(korra.primary);
  });
});

function applyNoCueUserTurn(state: CompanionAffect, now: string): CompanionAffect {
  // A single word carries no conversation signal at all.
  return evolveCompanionAffectFromUser(state, "Mm", now);
}

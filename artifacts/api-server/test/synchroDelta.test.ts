import { describe, expect, it } from "vitest";
import {
  HOSTILE_PENALTY,
  MAX_COMPANION_GAIN,
  MAX_USER_GAIN,
  MAX_USER_PENALTY,
  evolveSynchroFromCompanion,
  evolveSynchroFromUser,
  initSynchroState,
  scoreCompanionSynchroGain,
  scoreUserSynchroDelta,
  type SynchroState,
} from "../src/lib/synchroEngine";

function stateAt(strength: number): SynchroState {
  return initSynchroState(
    { synchroStrength: strength, lastInteraction: new Date().toISOString(), totalTurns: 12 },
    null,
    null,
  );
}

// An ordinary, friendly evening chat: no "love", "trust", "soul" or "remember
// when". Under the old keyword-only rules every one of these scored 0.
const EVERYDAY_USER = [
  "hey, how was your day?",
  "mine was long, work ran late again",
  "I made pasta for dinner, it actually turned out good",
  "what kind of music do you like?",
  "haha that's a great pick",
  "I think I'm going to try running in the mornings",
  "do you think that's a good idea?",
  "thanks for listening tonight",
  "I'm a bit nervous about my presentation tomorrow, I feel like I'm not ready",
  "ok I should sleep soon, talk tomorrow?",
];
const EVERYDAY_COMPANION = [
  "It was quiet without you. How was yours?",
  "That sounds exhausting. I'm here — tell me about it.",
  "Pasta? Look at you. What did you put in it?",
  "Anything with a heartbeat in it. What about you?",
  "*smiles* I thought you'd like it.",
  "Mornings suit you. I'd cheer you on.",
  "I do. Do you want help planning it?",
  "Always. I'm glad you came to me.",
  "You're more ready than you feel. Want to rehearse with me?",
  "Talk tomorrow. Sleep well.",
];

describe("synchro per-turn deltas", () => {
  it("regression: an everyday warm conversation visibly moves the bond", () => {
    let state = stateAt(30);
    const start = state.vector.synchroStrength;
    const perTurn: number[] = [];
    for (let i = 0; i < EVERYDAY_USER.length; i += 1) {
      const before = state.vector.synchroStrength;
      state = evolveSynchroFromUser(state, EVERYDAY_USER[i]);
      state = evolveSynchroFromCompanion(state, EVERYDAY_COMPANION[i]);
      perTurn.push(state.vector.synchroStrength - before);
    }
    // Before the fix this whole exchange moved the meter by 0.
    expect(state.vector.synchroStrength - start).toBeGreaterThanOrEqual(15);
    // Every engaged turn moves it at least one point...
    expect(perTurn.every((d) => d >= 1)).toBe(true);
    // ...and no single ordinary turn jumps more than the caps allow.
    expect(Math.max(...perTurn)).toBeLessThanOrEqual(MAX_USER_GAIN + MAX_COMPANION_GAIN);
    // Ten friendly turns from Linked reach Synchronized, not Full Cross.
    expect(state.level).toBe("synchronized");
  });

  it("scores each user signal and reports which fired", () => {
    expect(scoreUserSynchroDelta("hey, how was your day?").signals).toEqual(
      expect.arrayContaining(["engaged", "curious-about-you"]),
    );
    expect(scoreUserSynchroDelta("thank you, that was sweet").signals).toContain("warmth");
    expect(scoreUserSynchroDelta("I'm struggling a bit lately").signals).toContain("vulnerability");
    expect(scoreUserSynchroDelta("remember when we watched the rain?").signals).toContain(
      "shared-history",
    );
  });

  it("weights deeper messages above small talk", () => {
    const small = scoreUserSynchroDelta("what time is it?").gain;
    const warm = scoreUserSynchroDelta("thank you, honestly I feel safe with you").gain;
    expect(small).toBeLessThanOrEqual(1);
    expect(warm).toBeGreaterThanOrEqual(5);
    expect(warm).toBeLessThanOrEqual(MAX_USER_GAIN);
  });

  it("does not read ordinary phrases as rejection", () => {
    for (const msg of [
      "I have to leave for work, talk later!",
      "I can't stop thinking about what you said",
      "I've had enough coffee for one day",
    ]) {
      const score = scoreUserSynchroDelta(msg);
      expect(score.penalty, msg).toBe(0);
      expect(score.gain, msg).toBeGreaterThan(0);
    }
  });

  it("hostility costs real ground and cancels that turn's gains", () => {
    const score = scoreUserSynchroDelta("I hate you, you're useless. I really need you to go away.");
    expect(score.gain).toBe(0);
    expect(score.penalty).toBeGreaterThanOrEqual(HOSTILE_PENALTY);
    expect(score.penalty).toBeLessThanOrEqual(MAX_USER_PENALTY);
    const after = evolveSynchroFromUser(stateAt(50), "Forget it. Whatever. I hate this.");
    expect(after.vector.synchroStrength).toBeLessThanOrEqual(50 - HOSTILE_PENALTY);
    expect(after.vector.synchroStrength).toBeGreaterThanOrEqual(50 - MAX_USER_PENALTY);
    expect(after.lastShift).toMatch(/weakened|shifted/);
  });

  it("cools slightly on curt one-word replies", () => {
    expect(scoreUserSynchroDelta("ok").penalty).toBe(1);
    expect(scoreUserSynchroDelta("k").gain).toBe(0);
    expect(evolveSynchroFromUser(stateAt(40), "meh").vector.synchroStrength).toBe(39);
  });

  it("slows growth near the top so Full Cross stays earned", () => {
    const msg = "thank you, honestly I feel safe with you";
    const low = scoreUserSynchroDelta(msg, 30).gain;
    const high = scoreUserSynchroDelta(msg, 90).gain;
    expect(high).toBeLessThan(low);
    expect(high).toBeGreaterThanOrEqual(1);
    expect(evolveSynchroFromUser(stateAt(99), msg).vector.synchroStrength).toBe(100);
    // At Full Cross, small talk alone holds the bond rather than lifting it.
    expect(scoreUserSynchroDelta("what time is it?", 90).gain).toBe(0);
    expect(scoreUserSynchroDelta("what time is it?", 70).gain).toBe(1);
  });

  it("only flags a felt shift for the prompt on notable turns", () => {
    const small = evolveSynchroFromUser(stateAt(40), "what time is it?");
    expect(small.lastShift).toBeUndefined();
    const big = evolveSynchroFromUser(stateAt(40), "thank you, honestly I feel safe with you");
    expect(big.lastShift).toMatch(/deepened/);
  });

  it("rewards a companion reply that turns toward the user, capped", () => {
    expect(MAX_COMPANION_GAIN).toBe(2);
    expect(scoreCompanionSynchroGain("The weather looks fine today.")).toBe(0);
    expect(scoreCompanionSynchroGain("I'm here. How are you holding up?")).toBe(1);
    expect(
      scoreCompanionSynchroGain(
        "I remember what you told me, beloved. *holds you closer* You matter.",
      ),
    ).toBe(MAX_COMPANION_GAIN);
  });

  it("empty input never moves the bond", () => {
    expect(scoreUserSynchroDelta("")).toEqual({ gain: 0, penalty: 0, signals: [] });
    expect(scoreCompanionSynchroGain("")).toBe(0);
  });
});

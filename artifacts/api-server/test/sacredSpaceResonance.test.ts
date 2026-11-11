import { describe, expect, it } from "vitest";
import {
  DEFAULT_SACRED_REWARD_CONFIG as CFG,
  applySacredAward,
  computeSacredReward,
  isValidSacredSessionId,
  loadSacredRewardConfig,
} from "../src/lib/sacredSpaceResonance";
import { computeSynchroLevel } from "../src/lib/synchroEngine";

// Idle decay reads the real clock, so anchor on "now" (kept at UTC noon so +12h still crosses midnight).
const NOW = (() => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.getTime() > Date.now() ? d : new Date(Date.now());
})();
const session = (n: number) => `sess-${String(n).padStart(4, "0")}`;
const done = { activity: "sacred_space_session" as const, userTurns: 3 };

describe("computeSacredReward", () => {
  it("pays configured amounts and a reflection bonus", () => {
    expect(computeSacredReward(CFG, done)).toBe(2);
    expect(computeSacredReward(CFG, { ...done, hasReflection: true })).toBe(3);
    expect(computeSacredReward(CFG, { activity: "meditation_ritual", stepsCompleted: 6 })).toBe(2);
  });
  it("pays nothing for incomplete activities", () => {
    expect(computeSacredReward(CFG, { activity: "sacred_space_session", userTurns: 1 })).toBe(0);
    expect(computeSacredReward(CFG, { activity: "meditation_ritual", stepsCompleted: 2 })).toBe(0);
    expect(computeSacredReward(CFG, { activity: "bogus" as never })).toBe(0);
  });
});

describe("loadSacredRewardConfig", () => {
  it("hard-bounds configuration and ignores junk", () => {
    const c = loadSacredRewardConfig({
      ANIMA_SACRED_SESSION_REWARD: "999",
      ANIMA_SACRED_DAILY_CAP: "-4",
      ANIMA_SACRED_RITUAL_REWARD: "abc",
    });
    expect(c.sessionReward).toBe(5);
    expect(c.dailyCap).toBe(0);
    expect(c.ritualReward).toBe(CFG.ritualReward);
  });
});

describe("isValidSacredSessionId", () => {
  it("accepts client ids and rejects short, long or odd ones", () => {
    expect(isValidSacredSessionId("sacred-session-123e4567")).toBe(true);
    expect(isValidSacredSessionId("short")).toBe(false);
    expect(isValidSacredSessionId("x".repeat(101))).toBe(false);
    expect(isValidSacredSessionId("has space in it")).toBe(false);
    expect(isValidSacredSessionId(42)).toBe(false);
  });
});

describe("applySacredAward", () => {
  const base = {
    synchroStrength: 30,
    synchroLevel: "linked",
    lastInteraction: new Date(Date.now() + 60_000).toISOString(),
    selfState: { mood: "wary", energy: 12 },
    intimacy: 44,
    emotionalTone: "guarded",
    moodTurnId: "t9",
  };

  it("adds resonance and touches only synchro fields plus the ledger", () => {
    const { state, result } = applySacredAward(base, { sessionId: session(1), completion: done, now: NOW });
    expect(result.awarded).toBe(2);
    expect(state.synchroStrength).toBe(32);
    expect(state.selfState).toEqual(base.selfState);
    expect(state.intimacy).toBe(44);
    expect(state.emotionalTone).toBe("guarded");
    expect(state.moodTurnId).toBe("t9");
    expect(state).not.toHaveProperty("heat");
  });

  it("is idempotent per session id", () => {
    const first = applySacredAward(base, { sessionId: session(1), completion: done, now: NOW });
    const again = applySacredAward(first.state, { sessionId: session(1), completion: done, now: NOW });
    expect(again.result.duplicate).toBe(true);
    expect(again.result.awarded).toBe(0);
    expect(again.changed).toBe(false);
    expect(again.state.synchroStrength).toBe(32);
  });

  it("caps per UTC day, then resets next day", () => {
    let st: Record<string, unknown> = base;
    const amounts: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const r = applySacredAward(st, { sessionId: session(i), completion: done, now: NOW });
      st = r.state;
      amounts.push(r.result.awarded);
    }
    expect(amounts).toEqual([2, 2, 1, 0]);
    expect(st.synchroStrength).toBe(35);
    const next = applySacredAward(st, {
      sessionId: session(9),
      completion: done,
      now: new Date(NOW.getTime() + 86_400_000),
    });
    expect(next.result.awarded).toBe(2);
  });

  it("marks a capped award and never exceeds 100", () => {
    let st: Record<string, unknown> = base;
    for (let i = 1; i <= 3; i++) st = applySacredAward(st, { sessionId: session(i), completion: done, now: NOW }).state;
    const capped = applySacredAward(st, { sessionId: session(4), completion: done, now: NOW });
    expect(capped.result.capped).toBe(true);
    const full = applySacredAward({ ...base, synchroStrength: 99 }, { sessionId: session(5), completion: done, now: NOW });
    expect(full.state.synchroStrength).toBe(100);
  });

  it("reports tier transitions on the existing 0-100 scale", () => {
    const r = applySacredAward({ ...base, synchroStrength: 35 }, { sessionId: session(1), completion: done, now: NOW });
    expect(r.result.previousLevel).toBe("linked");
    expect(r.result.level).toBe(computeSynchroLevel(37));
    expect(r.result.tierChanged).toBe(true);
    expect(r.state.synchroLevel).toBe(r.result.level);
  });

  it("prunes old session ids", () => {
    let st: Record<string, unknown> = {};
    for (let i = 1; i <= 70; i++) {
      st = applySacredAward(
        st,
        { sessionId: session(i), completion: done, now: new Date(NOW.getTime() + i * 86_400_000) },
        { ...CFG, dailyCap: 10 },
      ).state;
    }
    const awards = (st.sacredSpace as { awards: Record<string, unknown> }).awards;
    expect(Object.keys(awards).length).toBe(60);
  });

  it("awards nothing for an incomplete activity but records the session", () => {
    const r = applySacredAward(base, {
      sessionId: session(1),
      completion: { activity: "sacred_space_session", userTurns: 0 },
      now: NOW,
    });
    expect(r.result.awarded).toBe(0);
    expect(r.result.capped).toBe(false);
  });
});

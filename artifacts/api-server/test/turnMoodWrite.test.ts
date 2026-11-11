import { describe, expect, it } from "vitest";
import {
  emotionalStateWithTurnBond,
  emotionalStateWithTurnMood,
  moodLoopStops,
  moodTurnAlreadyWritten,
} from "../src/lib/turnMoodWrite";

describe("moodLoopStops", () => {
  it("stops only when the turn was replaced, and keeps writing the other characters", () => {
    expect(moodLoopStops("replaced")).toBe(true);
    expect(moodLoopStops("skipped")).toBe(false);
    expect(moodLoopStops("written")).toBe(false);
  });
});

describe("emotionalStateWithTurnMood", () => {
  it("stamps the turn once and leaves a retry unchanged", () => {
    const selfState = { primary: "happy", intensity: 39 };
    const first = emotionalStateWithTurnMood({}, "turn_mood", selfState);
    expect(first.wrote).toBe(true);
    expect(first.state.moodTurnId).toBe("turn_mood");
    expect(first.state.selfState).toEqual(selfState);
    expect(moodTurnAlreadyWritten(first.state, "turn_mood")).toBe(true);

    const second = emotionalStateWithTurnMood(
      first.state,
      "turn_mood",
      { primary: "happy", intensity: 80 },
    );
    expect(second.wrote).toBe(false);
    expect(second.state).toEqual(first.state);
    expect((second.state.selfState as { intensity: number }).intensity).toBe(39);
  });

  it("skips a second mood write and still records strength and a saved moment once", () => {
    const mood = emotionalStateWithTurnMood(
      { intimacy: 70, synchroStrength: 40 },
      "turn_bond",
      { primary: "happy", intensity: 39 },
    );
    const first = emotionalStateWithTurnBond(mood.state, "turn_bond", {
      synchro: { synchroStrength: 45, intimacy: 73 },
      selfState: { primary: "happy", intensity: 90 },
      saveMoment: true,
    });
    expect(first.wroteMood).toBe(false);
    expect(first.wroteRelationship).toBe(true);
    expect(first.wroteSavedMoments).toBe(true);
    expect((first.state.selfState as { intensity: number }).intensity).toBe(39);
    expect(first.state.synchroStrength).toBe(45);
    expect(first.state.relationshipTurnId).toBe("turn_bond");
    expect(first.state.savedMomentsTurnId).toBe("turn_bond");

    const second = emotionalStateWithTurnBond(first.state, "turn_bond", {
      synchro: { synchroStrength: 60, intimacy: 80 },
      selfState: { primary: "happy", intensity: 99 },
      saveMoment: true,
    });
    expect(second.wroteMood).toBe(false);
    expect(second.wroteRelationship).toBe(false);
    expect(second.wroteSavedMoments).toBe(false);
    expect(second.state).toEqual(first.state);
  });
});

describe("emotionalStateWithTurnBond synchro rebase", () => {
  it("keeps a Sacred Space award that landed while the turn was in flight", () => {
    // Turn read 40, gained +1 (41); a ritual stored +3 (43) in between.
    const out = emotionalStateWithTurnBond({ synchroStrength: 43, synchroLevel: "synchronized" }, "t1", {
      synchro: { synchroStrength: 41 },
      synchroBaseline: 40,
    });
    expect(out.state.synchroStrength).toBe(44);
  });

  it("recomputes the tier and clamps to 0-100 after a rebase", () => {
    const up = emotionalStateWithTurnBond({ synchroStrength: 60 }, "t2", {
      synchro: { synchroStrength: 36 },
      synchroBaseline: 35,
    });
    expect(up.state.synchroStrength).toBe(61);
    expect(up.state.synchroLevel).toBe("soulUnison");
    const top = emotionalStateWithTurnBond({ synchroStrength: 100 }, "t3", {
      synchro: { synchroStrength: 90 },
      synchroBaseline: 50,
    });
    expect(top.state.synchroStrength).toBe(100);
  });

  it("is unchanged when nothing moved since the read", () => {
    const out = emotionalStateWithTurnBond({ synchroStrength: 40 }, "t4", {
      synchro: { synchroStrength: 42 },
      synchroBaseline: 40,
    });
    expect(out.state.synchroStrength).toBe(42);
  });
});

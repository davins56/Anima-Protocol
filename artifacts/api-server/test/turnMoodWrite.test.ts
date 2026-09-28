import { describe, expect, it } from "vitest";
import {
  emotionalStateWithTurnMood,
  moodTurnAlreadyWritten,
} from "../src/lib/turnMoodWrite";

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
});

import { describe, expect, it } from "vitest";
import { isCharacterAddressed, pickGroupSpeaker } from "./pickGroupSpeaker";

const cast = [
  { id: "a", name: "Ada" },
  { id: "b", name: "Blake" },
  { id: "c", name: "Cass" },
];

describe("isCharacterAddressed", () => {
  it("matches @mentions and whole-word names", () => {
    expect(isCharacterAddressed("Hey @Blake, what now?", "Blake")).toBe(true);
    expect(isCharacterAddressed("Ada, look at this", "Ada")).toBe(true);
    expect(isCharacterAddressed("nothing to see", "Cass")).toBe(false);
  });
});

describe("pickGroupSpeaker", () => {
  it("honors a forced participant id without waiting on a director", () => {
    const pick = pickGroupSpeaker({
      groupChars: cast,
      forceCharacterId: "c",
      random: () => 0.99,
    });
    expect(pick).toMatchObject({
      character: { id: "c", name: "Cass" },
      interrupted: false,
      reason: "forced",
    });
  });

  it("picks a single clear addressee", () => {
    const pick = pickGroupSpeaker({
      groupChars: cast,
      userMessage: "Blake, cover me",
      random: () => 0.99,
    });
    expect(pick.reason).toBe("addressed");
    expect(pick.character.id).toBe("b");
  });

  it("falls back to least-recent among eligible speakers", () => {
    const pick = pickGroupSpeaker({
      groupChars: cast,
      recentMessages: [
        { role: "assistant", character_name: "Ada" },
        { role: "assistant", character_name: "Blake" },
      ],
      interruptChance: 0,
      random: () => 0.99,
    });
    expect(pick.reason).toBe("least_recent");
    expect(pick.character.id).toBe("c");
  });

  it("can interrupt to another eligible speaker", () => {
    const pick = pickGroupSpeaker({
      groupChars: cast,
      interruptChance: 1,
      random: () => 0,
    });
    expect(pick.interrupted).toBe(true);
    expect(pick.reason).toBe("interrupt");
    expect(pick.character.id).not.toBe("a");
  });
});

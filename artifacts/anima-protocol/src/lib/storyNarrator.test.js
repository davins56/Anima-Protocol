import { describe, expect, it } from "vitest";
import {
  buildNarratorPrompt,
  cleanNarration,
  exchangesSinceNarration,
  isNarratorMessage,
  narratorMessageFromResult,
  shouldNarrate,
  storyModeEnabled,
} from "./storyNarrator";

const user = (content) => ({ role: "user", content });
const reply = (content, name = "Kai") => ({ role: "assistant", character_name: name, content });
const narration = (content) => ({
  role: "assistant",
  type: "narration",
  character_name: "Narrator",
  content,
});

describe("storyModeEnabled", () => {
  it("is on by default and off for therapy", () => {
    expect(storyModeEnabled({ id: "s" })).toBe(true);
    expect(storyModeEnabled({ id: "s" }, { therapy: true })).toBe(false);
    expect(storyModeEnabled({ id: "s", therapy_mode: true })).toBe(false);
    expect(storyModeEnabled({ id: "s", story_mode: false })).toBe(false);
    expect(storyModeEnabled(null)).toBe(false);
  });
});

describe("shouldNarrate", () => {
  it("speaks after every third completed exchange", () => {
    const log = [user("a"), reply("b"), user("c"), reply("d")];
    expect(shouldNarrate(log)).toBe(false);
    log.push(user("e"), reply("f"));
    expect(exchangesSinceNarration(log)).toBe(3);
    expect(shouldNarrate(log)).toBe(true);
  });

  it("restarts the count after a narrator beat", () => {
    const log = [user("a"), reply("b"), user("c"), reply("d"), user("e"), reply("f"), narration("Night falls.")];
    expect(shouldNarrate(log)).toBe(false);
    log.push(user("g"), reply("h"));
    expect(exchangesSinceNarration(log)).toBe(1);
  });

  it("waits until a companion reply is the latest row", () => {
    const log = [user("a"), reply("b"), user("c"), reply("d"), user("e"), reply("f"), user("g")];
    expect(shouldNarrate(log)).toBe(false);
  });

  it("treats the group opener as a narrator beat", () => {
    const opener = { role: "assistant", character_name: "Narrator", content: "The stage is set." };
    expect(isNarratorMessage(opener)).toBe(true);
    expect(exchangesSinceNarration([opener, user("a"), reply("b")])).toBe(1);
  });
});

describe("narrator output", () => {
  it("builds a message from JSON output", () => {
    const msg = narratorMessageFromResult(
      { scene: "Later, at the docks", narration: "Narrator: Fog rolls in off the water." },
      { now: new Date("2026-01-01T00:00:00Z") },
    );
    expect(msg).toMatchObject({
      role: "assistant",
      type: "narration",
      character_name: "Narrator",
      content: "Fog rolls in off the water.",
      scene_heading: "Later, at the docks",
    });
  });

  it("accepts plain text and drops empty output", () => {
    expect(narratorMessageFromResult("“Rain starts.”").content).toBe("Rain starts.");
    expect(narratorMessageFromResult({})).toBeNull();
    expect(cleanNarration("<p>Hi</p> [EMOTION:calm]")).toBe("Hi");
  });

  it("prompt includes the log and the no-dialogue rule", () => {
    const prompt = buildNarratorPrompt({
      messages: [user("Let's go"), reply("Okay")],
      characterNames: ["Kai"],
      userName: "Sam",
    });
    expect(prompt).toContain("Sam: Let's go");
    expect(prompt).toContain("Kai: Okay");
    expect(prompt).toContain("Never write dialogue");
    expect(prompt).toContain("non-explicit");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildNarratorPrompt,
  cleanNarration,
  conversationStalled,
  detectSceneCues,
  exchangesSinceNarration,
  isNarratorMessage,
  narratorConsultation,
  narratorMessageFromResult,
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
const long = (s) => `${s} ${"and the conversation keeps going with plenty of detail ".repeat(2)}`;

describe("storyModeEnabled", () => {
  it("is on by default and off for therapy", () => {
    expect(storyModeEnabled({ id: "s" })).toBe(true);
    expect(storyModeEnabled({ id: "s" }, { therapy: true })).toBe(false);
    expect(storyModeEnabled({ id: "s", therapy_mode: true })).toBe(false);
    expect(storyModeEnabled({ id: "s", story_mode: false })).toBe(false);
    expect(storyModeEnabled(null)).toBe(false);
  });
});

describe("exchangesSinceNarration", () => {
  it("counts completed exchanges and restarts after a beat", () => {
    const log = [user("a"), reply("b"), user("c"), reply("d"), narration("Night falls."), user("e"), reply("f")];
    expect(exchangesSinceNarration(log)).toBe(1);
  });

  it("treats the group opener as a narrator beat", () => {
    const opener = { role: "assistant", character_name: "Narrator", content: "The stage is set." };
    expect(isNarratorMessage(opener)).toBe(true);
    expect(exchangesSinceNarration([opener, user("a"), reply("b")])).toBe(1);
  });
});

describe("narratorConsultation", () => {
  it("asks after one exchange when the scene is moving", () => {
    const log = [user("Come with me, let's go to the docks"), reply(long("Sure, lead the way"))];
    const c = narratorConsultation(log);
    expect(c.cues).toContain("movement");
    expect(c.consult).toBe(true);
  });

  it("stays quiet after one ordinary exchange", () => {
    const log = [user(long("Tell me about your day")), reply(long("It was quiet"))];
    expect(narratorConsultation(log).consult).toBe(false);
  });

  it("asks after a couple of ordinary exchanges and marks ten as due", () => {
    const two = [user(long("a")), reply(long("b")), user(long("c")), reply(long("d"))];
    expect(narratorConsultation(two)).toMatchObject({ consult: true, due: false });
    const ten = [];
    for (let i = 0; i < 10; i += 1) ten.push(user(long(`q${i}`)), reply(long(`r${i}`)));
    expect(narratorConsultation(ten)).toMatchObject({ consult: true, due: true, exchanges: 10 });
  });

  it("never asks right after a narrator beat or before a reply", () => {
    expect(narratorConsultation([user("a"), reply("b"), narration("Rain.")]).consult).toBe(false);
    expect(narratorConsultation([user("let's go"), reply("ok"), user("now")]).consult).toBe(false);
  });

  it("detects time, closure and sudden events, and stalls", () => {
    expect(detectSceneCues([user("See you tomorrow"), reply("Good night")])).toEqual(
      expect.arrayContaining(["time", "closure"]),
    );
    expect(detectSceneCues([user("hm"), reply("Suddenly, a knock at the door")])).toContain("event");
    expect(conversationStalled([user("ok"), reply("yeah"), user("hm"), reply("sure")])).toBe(true);
  });
});

describe("narrator output", () => {
  it("builds a message when the mind decides to narrate", () => {
    const msg = narratorMessageFromResult(
      { narrate: true, scene: "Later, at the docks", narration: "Narrator: Fog rolls in off the water." },
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

  it("returns nothing when the mind stays silent or output is unusable", () => {
    expect(narratorMessageFromResult({ narrate: false, narration: "x" })).toBeNull();
    expect(narratorMessageFromResult({ narrate: "true", narration: "Rain." }).content).toBe("Rain.");
    expect(narratorMessageFromResult({ narrate: true, narration: "" })).toBeNull();
    expect(narratorMessageFromResult("Plain text")).toBeNull();
    expect(narratorMessageFromResult({})).toBeNull();
    expect(cleanNarration("<p>Hi</p> [EMOTION:calm]")).toBe("Hi");
  });

  it("prompt carries the log, pacing notes and the silence rules", () => {
    const messages = [narration("Night falls."), user("Let's go"), reply("Okay")];
    const prompt = buildNarratorPrompt({ messages, characterNames: ["Kai"], userName: "Sam" });
    expect(prompt).toContain("[NARRATOR]: Night falls.");
    expect(prompt).toContain("Sam: Let's go");
    expect(prompt).toContain("1 exchange since the narrator last spoke.");
    expect(prompt).toContain("someone is moving to a new place");
    expect(prompt).toContain("Stay silent when");
    expect(prompt).toContain("Never write dialogue");
    expect(prompt).toContain("non-explicit");
  });
});

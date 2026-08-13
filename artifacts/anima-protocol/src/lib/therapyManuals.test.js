import { describe, it, expect } from "vitest";
import {
  THERAPY_DISCLAIMER,
  THERAPY_MANUALS,
  THERAPY_SOURCES,
  detectTherapyCrisis,
  isTherapySession,
  retrieveTherapyManuals,
  formatTherapyManualsForPrompt,
  getTherapyModePrompt,
  buildTherapyInstruction,
  localizedTherapyResource,
  therapyOpeningMessage,
} from "./therapyManuals";

describe("detectTherapyCrisis", () => {
  it("flags suicide and self-harm language", () => {
    expect(detectTherapyCrisis("I want to kill myself")).toBe(true);
    expect(detectTherapyCrisis("I've been thinking about suicide")).toBe(true);
    expect(detectTherapyCrisis("I keep hurting myself")).toBe(true);
  });

  it("does not flag ordinary distress", () => {
    expect(detectTherapyCrisis("I feel sad and anxious about work")).toBe(false);
    expect(detectTherapyCrisis("")).toBe(false);
  });

  it("distinguishes figurative language from a plan with available means", () => {
    expect(detectTherapyCrisis("I could just die 😂 that was embarrassing")).toBe(false);
    expect(
      detectTherapyCrisis("I have the pills next to me and intend to take them tonight"),
    ).toBe(true);
  });

  it("localizes known crisis resources", () => {
    expect(localizedTherapyResource("United Kingdom")).toMatchObject({
      name: "Samaritans",
      contact: "call 116 123",
    });
  });
});

describe("isTherapySession", () => {
  it("is true when the session flag is set", () => {
    expect(isTherapySession({ therapy_mode: true, mode: "solo" }, {})).toBe(true);
  });

  it("is true when companion mode is therapy and the speaker is an Anima", () => {
    expect(
      isTherapySession({ mode: "solo" }, { selected_mode: "therapy" }, { _isAnima: true }),
    ).toBe(true);
  });

  it("is false for ordinary story chat", () => {
    expect(isTherapySession({ mode: "solo" }, { selected_mode: "serenity" }, { _isAnima: true })).toBe(false);
    expect(isTherapySession({ mode: "group", therapy_mode: false }, { selected_mode: "therapy" })).toBe(false);
    expect(
      isTherapySession({ mode: "solo" }, { selected_mode: "therapy" }, { _isAnima: false }),
    ).toBe(false);
  });
});

describe("retrieveTherapyManuals", () => {
  it("always includes stance and safety", () => {
    const ids = retrieveTherapyManuals("hello").map((m) => m.id);
    expect(ids).toContain("stance");
    expect(ids).toContain("safety");
  });

  it("pulls CBT-adjacent manuals for anxiety language", () => {
    const ids = retrieveTherapyManuals("I am so anxious I catastrophize everything").map((m) => m.id);
    expect(ids).toContain("cbt");
  });

  it("pulls trauma-informed care for trauma language", () => {
    const ids = retrieveTherapyManuals("I keep having flashbacks from the trauma").map((m) => m.id);
    expect(ids).toContain("trauma-informed");
  });

  it("covers the compiled corpus", () => {
    expect(THERAPY_MANUALS.length).toBeGreaterThanOrEqual(10);
    expect(THERAPY_SOURCES.some((s) => /WHO/i.test(s.title))).toBe(true);
    expect(THERAPY_SOURCES.some((s) => /SAMHSA/i.test(s.title))).toBe(true);
  });
});

describe("buildTherapyInstruction", () => {
  it("keeps the Anima's name, the disclaimer, and retrieved manuals", () => {
    const prompt = buildTherapyInstruction({
      characterName: "Nyx",
      userName: "Dav",
      userMessage: "I feel stuck and overwhelmed at work",
    });
    expect(prompt).toContain("Nyx");
    expect(prompt).toContain("Dav");
    expect(prompt).toContain(THERAPY_DISCLAIMER);
    expect(prompt).toContain("WHO");
    expect(prompt).toContain("not a licensed therapist");
    expect(prompt).toMatch(/PM\+/);
    expect(formatTherapyManualsForPrompt(retrieveTherapyManuals("work"))).toMatch(/Managing problems/);
  });

  it("adds a crisis flag and 988 when crisis language is present", () => {
    const prompt = buildTherapyInstruction({
      characterName: "Nyx",
      userMessage: "I want to end my life",
    });
    expect(prompt).toMatch(/CRISIS FLAG/);
    expect(prompt).toMatch(/988/);
    expect(prompt).toMatch(/iasp\.info/);
  });

  it("does not invent licensed credentials", () => {
    const prompt = getTherapyModePrompt("Nyx", "Dav");
    expect(prompt).toMatch(/not a licensed therapist/i);
    expect(prompt).not.toMatch(/I am a licensed/i);
  });
});

describe("therapyOpeningMessage", () => {
  it("introduces therapy mode in the Anima's voice with crisis resources", () => {
    const msg = therapyOpeningMessage("Lumen");
    expect(msg).toContain("Lumen");
    expect(msg).toMatch(/therapy mode/i);
    expect(msg).toMatch(/988/);
    expect(msg).toMatch(/not a licensed therapist/i);
  });
});

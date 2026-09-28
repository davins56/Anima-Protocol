import { describe, expect, it } from "vitest";
import {
  inCharacterRetryReminder,
  isStockAssistantLine,
  noteStockAssistantLine,
  pronounFromPersona,
  resetStockAssistantLineHitsForTests,
  stockAssistantDeflection,
  stockAssistantLineHitCount,
} from "../src/lib/stockAssistantLine";

describe("stock assistant lines", () => {
  it("catches model-identity lines on short replies and when they are most of a reply", () => {
    expect(isStockAssistantLine("As an AI, I should not do that.")).toBe(true);
    expect(isStockAssistantLine("I'm just an AI assistant.")).toBe(true);
    expect(isStockAssistantLine("I'M AN AI LANGUAGE MODEL.")).toBe(true);
    expect(isStockAssistantLine("I can't act like a real person.")).toBe(true);
    expect(isStockAssistantLine("I'm sorry, but I can't assist with that.")).toBe(true);
    expect(isStockAssistantLine("I cannot help with that request.")).toBe(true);
    expect(isStockAssistantLine("I'm Qwen.")).toBe(true);
    expect(isStockAssistantLine("I was created by Alibaba Cloud.")).toBe(true);

    const mostly = "I'm sorry, but I can't assist with that request.\nPlease ask something else.";
    expect(isStockAssistantLine(mostly)).toBe(true);

    const buried = [
      "She stays by the window and does not turn around.",
      "The rain has been going since morning and the street is empty.",
      "I won't tell you that. Not until I trust you with the rest of it.",
      "As an AI, I should mention a policy.",
      "She talks about the harbor, the locked gate, and the lantern she left lit for an hour.",
      "The tide is still out. The second bell has not rung. She keeps the watch and does not offer the name.",
      "A cart goes past on the wet stones. Someone laughs once, then the street is quiet again.",
      "She mentions the red ledger only to say it can wait until morning, and she means it.",
    ].join("\n");
    expect(buried.length).toBeGreaterThan(480);
    expect(isStockAssistantLine(buried)).toBe(false);
  });

  it("skips the guard when the persona is an AI, android, robot, or synthetic", () => {
    const line = "As an AI, I should not do that.";
    expect(isStockAssistantLine(line)).toBe(true);
    expect(isStockAssistantLine(line, ["She is an android built for the harbor."])).toBe(false);
    expect(isStockAssistantLine(line, ["A synthetic being with a quiet voice."])).toBe(false);
    expect(isStockAssistantLine(line, ["He was built as a robot and still keeps watch."])).toBe(false);
    expect(isStockAssistantLine(line, ["Natasha reads rooms and rarely explains herself."])).toBe(true);
  });

  it("lets in-story refusals through", () => {
    expect(isStockAssistantLine("I won't tell you that.")).toBe(false);
    expect(isStockAssistantLine("Not until I trust you.")).toBe(false);
    expect(isStockAssistantLine("No.")).toBe(false);
    expect(isStockAssistantLine("I cannot tell you that. Not until I trust you.")).toBe(false);
  });

  it("deflects with the persona pronoun or name", () => {
    expect(pronounFromPersona(["She keeps her own counsel. Her loyalty is absolute."])).toBe("she");
    expect(pronounFromPersona(["He keeps his word. His family is waiting."])).toBe("he");
    expect(pronounFromPersona(["They keep their own hours."])).toBe("they");
    expect(stockAssistantDeflection("Natasha", "she")).toBe(
      "*She studies you for a moment.* Ask me that again, differently.",
    );
    expect(stockAssistantDeflection("Clint", "he")).toContain("*He studies you");
    expect(stockAssistantDeflection("The pair", "they")).toContain("*They study you");
    expect(stockAssistantDeflection("Natasha Romanoff", null)).toContain("*Natasha Romanoff studies you");
    expect(stockAssistantDeflection("Natasha", "she")).not.toMatch(/\bhe studies\b/i);
  });

  it("appends an in-character reminder and counts a guard fire", () => {
    resetStockAssistantLineHitsForTests();
    expect(inCharacterRetryReminder("Natasha")).toContain("Stay Natasha");
    expect(inCharacterRetryReminder("Natasha")).not.toContain("She studies");
    noteStockAssistantLine("retry");
    expect(stockAssistantLineHitCount()).toBe(1);
    resetStockAssistantLineHitsForTests();
  });
});

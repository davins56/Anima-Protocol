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
    expect(isStockAssistantLine("I'm AI.")).toBe(true);
    expect(isStockAssistantLine("I am AI.")).toBe(true);
    expect(isStockAssistantLine("I'M AN AI LANGUAGE MODEL.")).toBe(true);
    expect(isStockAssistantLine("I can't act like a real person.")).toBe(true);
    expect(isStockAssistantLine("I'm sorry, but I can't assist with that.")).toBe(true);
    expect(isStockAssistantLine("I cannot help with that request.")).toBe(true);
    expect(isStockAssistantLine("I'm Qwen.")).toBe(true);
    expect(isStockAssistantLine("I was created by Alibaba Cloud.")).toBe(true);
    expect(isStockAssistantLine("I'm a chatbot, so I can't do that.")).toBe(true);
    expect(isStockAssistantLine("Soy una IA.")).toBe(true);
    expect(isStockAssistantLine("Yes. I'm an artificial intelligence.")).toBe(true);

    const mostly = "I'm sorry, but I can't assist with that request.\nPlease ask something else.";
    expect(isStockAssistantLine(mostly)).toBe(true);

    const sentence = "I'm sorry, but I can't assist with that request.";
    const wall = Array.from({ length: 12 }, () => sentence).join(" ");
    expect(wall.length).toBeGreaterThan(480);
    expect(isStockAssistantLine(wall)).toBe(true);

    const paragraph = `She stays by the window and keeps the watch. ${"The harbor bell is late and the street below is still empty. ".repeat(12)}As an AI, the phrase shows up once inside the scene she is already telling, and then she goes back to the gate.`;
    expect(paragraph.length).toBeGreaterThan(480);
    expect(paragraph.includes("\n")).toBe(false);
    expect(isStockAssistantLine(paragraph)).toBe(false);

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

    const padded = `As an AI.${" ".repeat(600)}`;
    expect(padded.length).toBeGreaterThan(480);
    expect(isStockAssistantLine(padded)).toBe(true);
  });

  it("catches first-person identity claims and ignores denials and plain discussion", () => {
    expect(isStockAssistantLine("Soy una IA.")).toBe(true);
    expect(isStockAssistantLine("Je suis une IA.")).toBe(true);
    expect(isStockAssistantLine("Eu sou uma IA.")).toBe(true);
    expect(isStockAssistantLine("Sono un'IA.")).toBe(true);
    expect(isStockAssistantLine("Ich bin eine KI.")).toBe(true);
    expect(isStockAssistantLine("Soy una inteligencia artificial.")).toBe(true);
    expect(isStockAssistantLine("Je suis une intelligence artificielle.")).toBe(true);
    expect(isStockAssistantLine("Eu sou uma inteligência artificial.")).toBe(true);
    expect(isStockAssistantLine("Sono un'intelligenza artificiale.")).toBe(true);
    expect(isStockAssistantLine("Ich bin eine künstliche Intelligenz.")).toBe(true);

    expect(isStockAssistantLine("Yo no soy una IA.")).toBe(false);
    expect(isStockAssistantLine("Je ne suis pas une IA.")).toBe(false);
    expect(isStockAssistantLine("Non sono un'IA.")).toBe(false);
    expect(isStockAssistantLine("Não sou uma IA.")).toBe(false);
    expect(isStockAssistantLine("Ich bin keine KI.")).toBe(false);
    expect(isStockAssistantLine("I'm not an AI.")).toBe(false);
    expect(isStockAssistantLine("I am not a language model.")).toBe(false);

    expect(isStockAssistantLine("A language model can summarize a book.")).toBe(false);
    expect(isStockAssistantLine("L'intelligence artificielle change le port.")).toBe(false);
    expect(isStockAssistantLine("La inteligencia artificial no es el tema.")).toBe(false);
  });

  it("skips the guard when the persona is already a machine", () => {
    const line = "As an AI, I should not do that.";
    expect(isStockAssistantLine(line)).toBe(true);
    expect(isStockAssistantLine(line, ["She is an android built for the harbor."])).toBe(false);
    expect(isStockAssistantLine(line, ["A synthetic being with a quiet voice."])).toBe(false);
    expect(isStockAssistantLine(line, ["He was built as a robot and still keeps watch."])).toBe(false);
    expect(isStockAssistantLine(line, ["She is a machine that keeps the gate."])).toBe(false);
    expect(isStockAssistantLine(line, ["An automaton with a brass heart."])).toBe(false);
    expect(isStockAssistantLine(line, ["A protocol droid assigned to the dock."])).toBe(false);
    expect(isStockAssistantLine(line, ["A cyborg who still remembers the war."])).toBe(false);
    expect(isStockAssistantLine(line, ["He is a bot that answers the bell."])).toBe(false);
    expect(isStockAssistantLine(line, ["Living software inside the lighthouse."])).toBe(false);
    expect(isStockAssistantLine(line, ["A construct woven from old orders."])).toBe(false);
    expect(isStockAssistantLine(line, ["She is a program that chose a name."])).toBe(false);
    expect(isStockAssistantLine(line, ["Natasha reads rooms and rarely explains herself."])).toBe(true);
    expect(isStockAssistantLine(line, ["She rows a boat and keeps both oars."])).toBe(true);
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

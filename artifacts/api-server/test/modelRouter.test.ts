import { afterEach, describe, expect, it } from "vitest";
import {
  classifyComplexity,
  isModelUnavailableError,
  resolveModel,
  routeModel,
} from "../src/lib/modelRouter";

describe("classifyComplexity", () => {
  it("routes greetings and acknowledgements to the light tier", () => {
    for (const msg of ["hi", "Hey!", "thanks", "thank you", "ok", "lol", "yeah", "good morning"]) {
      expect(classifyComplexity(msg)).toBe("light");
    }
  });

  it("routes trivial sign-offs / small talk to the light tier", () => {
    expect(classifyComplexity("see you soon")).toBe("light");
    expect(classifyComplexity("goodnight")).toBe("light");
    expect(classifyComplexity("ttyl")).toBe("light");
  });

  it("routes short but emotional / vulnerable messages to the heavy tier", () => {
    // These are short yet high-stakes — they must NOT be treated as routine.
    expect(classifyComplexity("I feel awful today")).toBe("heavy");
    expect(classifyComplexity("don't leave me")).toBe("heavy");
    expect(classifyComplexity("miss you")).toBe("heavy");
    expect(classifyComplexity("I had a pretty rough day at work today")).toBe("heavy");
  });

  it("routes analytical / creative keyword asks to the heavy tier", () => {
    expect(classifyComplexity("Can you explain how black holes form")).toBe("heavy");
    expect(classifyComplexity("Compare stoicism and existentialism for me")).toBe("heavy");
    expect(classifyComplexity("Help me debug this code please")).toBe("heavy");
    expect(classifyComplexity("Write me a poem about the ocean")).toBe("heavy");
  });

  it("routes any direct question to the heavy tier", () => {
    expect(classifyComplexity("why?")).toBe("heavy");
    expect(classifyComplexity("Who are you? What can you do? How do you work?")).toBe("heavy");
    expect(classifyComplexity("what should I do about this?")).toBe("heavy");
  });

  it("routes long messages to the heavy tier", () => {
    const long = "I have been thinking about something ".repeat(20);
    expect(classifyComplexity(long)).toBe("heavy");
  });

  it("routes code-like content to the heavy tier", () => {
    expect(classifyComplexity("fix this: const add = (a, b) => { return a + b }")).toBe("heavy");
  });

  it("routes routine, low-stakes substantive turns to the mid (standard) tier", () => {
    // No question, no emotional/analytical/code signal, not long: this is the
    // cost-saving case — capable mid tier, not the top tier.
    expect(classifyComplexity("Tell me something interesting")).toBe("standard");
    expect(classifyComplexity("let's just chat for a bit")).toBe("standard");
    expect(classifyComplexity("that sounds like a fun idea to me")).toBe("standard");
  });

  it("escalates routine turns to heavy when deep mode is on", () => {
    expect(classifyComplexity("Tell me something interesting", { deepMode: true })).toBe("heavy");
    // High-stakes turns are heavy with or without deep mode.
    expect(classifyComplexity("miss you", { deepMode: true })).toBe("heavy");
    // Deep mode never upgrades a bare greeting off the cheap tier.
    expect(classifyComplexity("hi", { deepMode: true })).toBe("light");
  });

  it("escalates routine turns to heavy once a conversation is deep", () => {
    expect(classifyComplexity("Tell me something interesting", { conversationDepth: 5 })).toBe("standard");
    expect(classifyComplexity("Tell me something interesting", { conversationDepth: 24 })).toBe("heavy");
    // Deep threads still keep greetings cheap.
    expect(classifyComplexity("hey", { conversationDepth: 50 })).toBe("light");
  });

  it("reserves the standard tier for empty input / fallback as well", () => {
    expect(classifyComplexity("")).toBe("standard");
    expect(classifyComplexity("   ")).toBe("standard");
  });
});

describe("resolveModel", () => {
  const SAVED = { ...process.env };
  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("returns sensible defaults per tier", () => {
    delete process.env.ANIMA_MODEL_LIGHT;
    delete process.env.ANIMA_MODEL_STANDARD;
    delete process.env.ANIMA_MODEL_HEAVY;
    expect(resolveModel("light").model).toBe("gpt-4.1-mini");
    expect(resolveModel("standard").model).toBe("gpt-4o");
    expect(resolveModel("heavy").model).toBe("gpt-4.1");
  });

  it("honors env overrides", () => {
    process.env.ANIMA_MODEL_HEAVY = "gpt-5.2";
    expect(resolveModel("heavy").model).toBe("gpt-5.2");
  });

  it("carries a token budget for every tier", () => {
    expect(resolveModel("light").maxTokens).toBeGreaterThan(0);
    expect(resolveModel("standard").maxTokens).toBeGreaterThan(0);
    expect(resolveModel("heavy").maxTokens).toBeGreaterThan(0);
  });
});

describe("routeModel", () => {
  it("classifies and resolves in one step", () => {
    const routed = routeModel("hi");
    expect(routed.tier).toBe("light");
    expect(routed.model).toBe("gpt-4.1-mini");
  });

  it("routes a routine turn to the mid tier and a deep-mode turn to heavy", () => {
    expect(routeModel("Tell me something interesting").tier).toBe("standard");
    expect(routeModel("Tell me something interesting", { deepMode: true }).tier).toBe("heavy");
  });
});

describe("isModelUnavailableError", () => {
  it("treats unknown-model / no-access errors as retryable", () => {
    expect(isModelUnavailableError({ status: 404, message: "The model does not exist" })).toBe(true);
    expect(isModelUnavailableError({ code: "model_not_found" })).toBe(true);
    expect(isModelUnavailableError({ message: "You do not have access to model gpt-4.1" })).toBe(true);
  });

  it("does not treat quota / rate-limit / transient errors as model-unavailable", () => {
    expect(isModelUnavailableError({ status: 429, code: "insufficient_quota" })).toBe(false);
    expect(isModelUnavailableError({ status: 429, message: "Rate limit reached" })).toBe(false);
    expect(isModelUnavailableError({ status: 500, message: "internal error" })).toBe(false);
    expect(isModelUnavailableError(null)).toBe(false);
    expect(isModelUnavailableError("nope")).toBe(false);
  });
});

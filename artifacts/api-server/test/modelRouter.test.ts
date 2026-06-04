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

  it("routes short but substantive / emotional messages to the heavy tier", () => {
    // These are short yet meaningful — they must NOT be treated as trivial.
    expect(classifyComplexity("I feel awful today")).toBe("heavy");
    expect(classifyComplexity("don't leave me")).toBe("heavy");
    expect(classifyComplexity("miss you")).toBe("heavy");
  });

  it("routes analytical keyword asks to the heavy tier", () => {
    expect(classifyComplexity("Can you explain how black holes form?")).toBe("heavy");
    expect(classifyComplexity("Compare stoicism and existentialism for me")).toBe("heavy");
    expect(classifyComplexity("Help me debug this code please")).toBe("heavy");
    expect(classifyComplexity("Write me a poem about the ocean")).toBe("heavy");
  });

  it("routes long messages to the heavy tier", () => {
    const long = "I have been thinking about something ".repeat(20);
    expect(classifyComplexity(long)).toBe("heavy");
  });

  it("routes messages with several questions to the heavy tier", () => {
    expect(classifyComplexity("Who are you? What can you do? How do you work?")).toBe("heavy");
  });

  it("routes code-like content to the heavy tier", () => {
    expect(classifyComplexity("fix this: const add = (a, b) => { return a + b }")).toBe("heavy");
  });

  it("routes substantive ordinary conversation to the high-capability tier", () => {
    // Anything beyond trivial small talk is biased to heavy so companions reason
    // with full depth, even without explicit analytical keywords.
    expect(classifyComplexity("I had a pretty rough day at work today")).toBe("heavy");
    expect(classifyComplexity("Tell me something interesting")).toBe("heavy");
    expect(classifyComplexity("why?")).toBe("heavy");
  });

  it("reserves the standard tier for empty input / fallback only", () => {
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

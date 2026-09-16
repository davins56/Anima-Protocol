import { afterEach, describe, expect, it } from "vitest";
import {
  beginCompanionLlmTurn,
  companionLlmTurnOpen,
  isPostTurnSidecarFunction,
  resetCompanionLlmTurnForTests,
  shouldSkipSidecarLlm,
} from "../src/lib/sidecarLlm";

afterEach(() => {
  resetCompanionLlmTurnForTests();
  delete process.env.ANIMA_SIDECAR_LLM;
});

describe("sidecar LLM occupancy", () => {
  it("classifies post-turn chat helpers as sidecars", () => {
    expect(isPostTurnSidecarFunction("updateCharacterEmotion")).toBe(true);
    expect(isPostTurnSidecarFunction("updateInventory")).toBe(true);
    expect(isPostTurnSidecarFunction("characterMemory")).toBe(true);
    expect(isPostTurnSidecarFunction("extractLore")).toBe(true);
    expect(isPostTurnSidecarFunction("generateCompanionFromPrompt")).toBe(false);
    expect(isPostTurnSidecarFunction("codespaceAgentStep")).toBe(false);
  });

  it("skips sidecar LLM while a companion generate is open", () => {
    expect(companionLlmTurnOpen()).toBe(false);
    expect(shouldSkipSidecarLlm()).toBe(false);

    const release = beginCompanionLlmTurn();
    expect(companionLlmTurnOpen()).toBe(true);
    expect(shouldSkipSidecarLlm()).toBe(true);

    release();
    expect(companionLlmTurnOpen()).toBe(false);
    expect(shouldSkipSidecarLlm()).toBe(false);
  });

  it("releases occupancy only once", () => {
    const release = beginCompanionLlmTurn();
    beginCompanionLlmTurn();
    expect(companionLlmTurnOpen()).toBe(true);
    release();
    release();
    expect(companionLlmTurnOpen()).toBe(true);
    resetCompanionLlmTurnForTests();
    expect(companionLlmTurnOpen()).toBe(false);
  });

  it("skips sidecar LLM outside tests unless explicitly enabled", () => {
    const previousVitest = process.env.VITEST;
    delete process.env.VITEST;
    delete process.env.ANIMA_SIDECAR_LLM;
    try {
      expect(shouldSkipSidecarLlm()).toBe(true);
      process.env.ANIMA_SIDECAR_LLM = "1";
      expect(shouldSkipSidecarLlm()).toBe(false);
    } finally {
      if (previousVitest == null) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
    }
  });
});

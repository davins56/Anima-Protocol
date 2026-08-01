import { describe, it, expect } from "vitest";
import { buildGroupPrompt } from "./buildGroupPrompt";

describe("buildGroupPrompt", () => {
  const base = {
    nextChar: { name: "Ava" },
    allCharSheets: "Ava sheet",
    loreCtxGroup: "",
    conversationHistory: "User: hi",
    adultInstruction: "",
    lengthGuide: "Keep it brief.",
  };

  it("includes interruptionClause when provided", () => {
    const prompt = buildGroupPrompt({
      ...base,
      interruptionClause:
        "\n\nINTERACTION STYLE: This is an interruption / out-of-turn reaction.",
    });
    expect(prompt).toContain("INTERACTION STYLE: This is an interruption");
    expect(prompt).toContain("YOU ARE ONLY AVA THIS TURN");
  });

  it("omits interruption wording when clause is empty", () => {
    const prompt = buildGroupPrompt(base);
    expect(prompt).not.toContain("INTERACTION STYLE");
  });
});

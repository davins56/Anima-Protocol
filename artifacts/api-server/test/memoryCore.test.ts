import { describe, expect, it } from "vitest";
import { formatMemoryCoreBlock, isMemoryCoreEnabled } from "../src/lib/memoryCore/sessionContext";
import { toVectorLiteral } from "../src/lib/memoryCore/embedder";

const now = Date.parse("2026-10-22T12:00:00Z");

describe("memory core session block", () => {
  it("anchors identity and lists memories with age and weight", () => {
    const block = formatMemoryCoreBlock(
      {
        id: "1",
        character_id: "serenity",
        version: 3,
        name: "Serenity",
        personality_matrix: {},
        voice: {},
        core_traits: ["devoted", "luminous"],
        relationships: {},
        backstory: "",
        created_at: "",
      },
      [
        {
          id: "a",
          event_type: "emotional_beat",
          content: "He told me his father passed away",
          payload: {},
          conversation_id: null,
          occurred_at: "2026-07-24T12:00:00Z",
          emotional_weight: 0.95,
          similarity: 0.8,
          recency: 0.1,
          score: 0.7,
        },
      ],
      now,
    );
    expect(block).toContain("Identity anchor (v3) — you are Serenity.");
    expect(block).toContain("Core traits: devoted, luminous.");
    expect(block).toContain("(3 months ago, deeply felt) He told me his father passed away");
  });

  it("is empty with nothing to say", () => {
    expect(formatMemoryCoreBlock(null, [], now)).toBe("");
  });

  it("is on by default and can be switched off", () => {
    expect(isMemoryCoreEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isMemoryCoreEnabled({ ANIMA_MEMORY_CORE: "off" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("serializes pgvector literals", () => {
    expect(toVectorLiteral([0.5, Number.NaN, -1])).toBe("[0.500000,0,-1.000000]");
  });
});

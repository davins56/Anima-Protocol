import { describe, expect, it } from "vitest";
import { formatMemoriesForPrompt, retrieveRelevantMemories } from "../src/memory/retrieval";

const now = new Date().toISOString();
const earlier = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

describe("lexical memory overlap", () => {
  it("matches a curly apostrophe to a straight one", () => {
    const scored = retrieveRelevantMemories(
      [
        {
          characterId: "c1",
          facts: [
            {
              type: "factual",
              text: "User likes quiet mornings with tea",
              created_at: now,
            },
            {
              type: "factual",
              text: "User can’t leave the window open",
              created_at: earlier,
            },
          ],
        },
      ],
      { contextHint: "I can't", topK: 2 },
    );
    expect(scored[0]?.fact.text).toMatch(/window/i);
  });

  it("leaves protected core proposals out of the prompt set", () => {
    const scored = retrieveRelevantMemories(
      [
        {
          characterId: "c1",
          facts: [
            {
              type: "factual",
              text: "The human's name is Sam.",
              created_at: now,
              about: "user",
              memory_class: "semantic",
            },
            {
              type: "factual",
              text: "Protected identity proposal (not applied): Natasha Romanoff — name Natasha Romanoff.",
              created_at: now,
              proposal: true,
              protected: true,
              memory_class: "core",
            },
            {
              forgotten: true,
              fact_id: "gone",
              text: "The human's name is Eve.",
              object: "Eve",
              created_at: now,
            },
          ],
        },
      ],
      { topK: 5 },
    );
    expect(scored.map((item) => item.fact.text).join("\n")).not.toMatch(/not applied/i);
    expect(scored.map((item) => item.fact.text).join("\n")).not.toMatch(/Eve/);
    expect(scored.map((item) => item.fact.text).join("\n")).toMatch(/Sam/);
  });

  it("keeps a forgotten name out of the prompt even when the source turn is still stored", () => {
    const scored = retrieveRelevantMemories(
      [
        {
          characterId: "c1",
          facts: [
            {
              forgotten: true,
              fact_id: "user-name",
              about: "user",
              subject: "user",
              predicate: "name",
              object: "Sam",
              source_text: "The human's name is Sam.",
              turn_id: "name-turn",
            },
            {
              type: "turn",
              turn_id: "name-turn",
              text: "User: My name is Sam. | Companion: I hear you.",
              created_at: now,
            },
            {
              type: "factual",
              text: "The human lives in Lisbon.",
              created_at: now,
              about: "user",
              memory_class: "semantic",
            },
            {
              type: "factual",
              text: "The human's name is Samuel.",
              created_at: now,
            },
          ],
        },
      ],
      { contextHint: "what is my name Sam", topK: 8 },
    );
    const prompt = formatMemoriesForPrompt(scored, new Map());
    expect(prompt).not.toMatch(/\bSam\b/);
    expect(prompt).toMatch(/Lisbon/);
    expect(prompt).toMatch(/Samuel/);
  });

  it("does not let one repeated word take the full lexical boost", () => {
    const scored = retrieveRelevantMemories(
      [
        {
          characterId: "c1",
          facts: [
            {
              type: "factual",
              text: "harbor harbor harbor harbor",
              created_at: now,
            },
            {
              type: "factual",
              text: "the harbor lighthouse and the tide",
              created_at: now,
            },
          ],
        },
      ],
      { contextHint: "tell me about the harbor", topK: 2 },
    );
    expect(scored[0]?.fact.text).toMatch(/lighthouse/i);
    expect(scored[0]?.score).toBeGreaterThan(scored[1]?.score ?? 0);
  });
});

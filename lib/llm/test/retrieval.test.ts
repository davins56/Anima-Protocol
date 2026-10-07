import { describe, expect, it } from "vitest";
import { retrieveRelevantMemories } from "../src/memory/retrieval";

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
          ],
        },
      ],
      { topK: 5 },
    );
    expect(scored.map((item) => item.fact.text).join("\n")).not.toMatch(/not applied/i);
    expect(scored.map((item) => item.fact.text).join("\n")).toMatch(/Sam/);
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

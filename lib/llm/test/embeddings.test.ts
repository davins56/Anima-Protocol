import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  hashEmbed,
  rankBySimilarity,
} from "../src/embeddings";
import { retrieveRelevantMemories } from "../src/memory/retrieval";

describe("embeddings", () => {
  it("is deterministic and self-similar", () => {
    const a = hashEmbed("chamomile with honey");
    const b = hashEmbed("chamomile with honey");
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("ranks related text above unrelated", () => {
    const query = hashEmbed("grief and comfort tonight");
    const ranked = rankBySimilarity(query, [
      { id: "1", embedding: hashEmbed("holding space for grief with calm presence"), text: "grief" },
      { id: "2", embedding: hashEmbed("shipping logistics and invoice numbers"), text: "invoice" },
    ], 2);
    expect(ranked[0]?.id).toBe("1");
  });
});

describe("hybrid memory retrieval", () => {
  it("boosts semantically matching facts when embeddings exist", () => {
    const queryText = "I miss my brother tonight";
    const queryEmbedding = hashEmbed(queryText);
    const memories = [
      {
        characterId: "c1",
        facts: [
          {
            type: "factual",
            text: "User's favorite invoice software is QuickBooks",
            created_at: new Date().toISOString(),
            embedding: hashEmbed("invoice software QuickBooks"),
          },
          {
            type: "emotional",
            text: "User is grieving their brother and wants honest presence",
            created_at: new Date().toISOString(),
            embedding: hashEmbed("grieving brother honest presence"),
          },
        ],
      },
    ];

    const scored = retrieveRelevantMemories(memories, {
      topK: 2,
      contextHint: queryText,
      queryEmbedding,
    });
    expect(scored[0]?.fact.text).toMatch(/brother/i);
    expect(scored[0]?.semanticScore).toBeGreaterThan(0);
  });

  it("falls back to heuristic + lexical without embeddings", () => {
    const scored = retrieveRelevantMemories(
      [
        {
          characterId: "c1",
          facts: [
            { type: "emotional", text: "Felt deep warmth and trust", created_at: new Date().toISOString() },
          ],
        },
      ],
      { contextHint: "I feel warmth when I think of you" },
    );
    expect(scored[0]?.memoryType).toBe("emotional");
    expect(scored[0]?.score).toBeGreaterThan(0.5);
  });
});

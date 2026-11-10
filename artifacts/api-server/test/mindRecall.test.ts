import { describe, expect, it } from "vitest";
import {
  formatKnowledgeBlock,
  packKnowledge,
  rankKnowledge,
  recencyScore,
  type KnowledgeCandidate,
} from "../src/lib/mind/hybridRecall";
import { knowledgeCandidates } from "../src/lib/mind/mindContext";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

describe("chat mind hybrid recall", () => {
  it("ranks a strong vector hit above an old weak one, and recency breaks ties", () => {
    const candidates: KnowledgeCandidate[] = [
      { id: "old", kind: "moment", text: "We talked about the lighthouse trip", similarity: 0.3, occurredAt: daysAgo(200), importance: 0.4 },
      { id: "hit", kind: "moment", text: "Sam's dog Biscuit had surgery", similarity: 0.9, occurredAt: daysAgo(10), importance: 0.6 },
      { id: "recent", kind: "moment", text: "Talked about the rainy weekend", similarity: 0.3, occurredAt: daysAgo(1), importance: 0.4 },
    ];
    const ranked = rankKnowledge(candidates, { query: "how is biscuit doing", now: NOW });
    expect(ranked.map((r) => r.id)).toEqual(["hit", "recent", "old"]);
  });

  it("uses keyword overlap when there is no vector score", () => {
    const ranked = rankKnowledge(
      [
        { id: "a", kind: "moment", text: "Planning a trip to Lisbon in spring", occurredAt: daysAgo(5) },
        { id: "b", kind: "moment", text: "Complained about the printer at work", occurredAt: daysAgo(5) },
      ],
      { query: "any tips for Lisbon?", now: NOW },
    );
    expect(ranked[0]?.id).toBe("a");
  });

  it("drops near-duplicates and moments already visible in history, but keeps facts", () => {
    const ranked = rankKnowledge(
      [
        { id: "f1", kind: "fact", text: "Sam works as a night-shift nurse.", importance: 0.8 },
        { id: "f2", kind: "fact", text: "Sam works as a night shift nurse", importance: 0.7 },
        { id: "m1", kind: "moment", text: "User: I finally finished the marathon | Me: so proud", similarity: 0.8 },
        { id: "f3", kind: "fact", text: "Sam finished a marathon in October.", importance: 0.9 },
      ],
      {
        query: "marathon",
        now: NOW,
        historyTexts: ["User: I finally finished the marathon | Me: so proud of you"],
      },
    );
    const ids = ranked.map((r) => r.id);
    expect(ids).toContain("f1");
    expect(ids).not.toContain("f2");
    expect(ids).not.toContain("m1");
    expect(ids).toContain("f3");
  });

  it("halves moment recency in ~30 days and fact recency in ~180", () => {
    expect(recencyScore("moment", daysAgo(30), NOW)).toBeCloseTo(0.5, 2);
    expect(recencyScore("fact", daysAgo(180), NOW)).toBeCloseTo(0.5, 2);
    expect(recencyScore("moment", null, NOW)).toBe(0.5);
  });

  it("filters mind notes and retractions out of recalled moments", () => {
    const list = knowledgeCandidates(
      [{ id: "f", fact: "Sam has a cat named Miso.", category: "relationship", importance: 0.7, replaces: null }],
      [
        { id: "n1", event_type: "note", content: "Sam has a cat named Miso.", payload: { kind: "user_fact" }, conversation_id: null, occurred_at: daysAgo(1), emotional_weight: 0.5, similarity: 0.9, recency: 1, score: 1 },
        { id: "n2", event_type: "note", content: "summary", payload: { kind: "session_summary" }, conversation_id: null, occurred_at: daysAgo(1), emotional_weight: 0.5, similarity: 0.9, recency: 1, score: 1 },
        { id: "r", event_type: "retraction", content: "forget", payload: {}, conversation_id: null, occurred_at: daysAgo(1), emotional_weight: 0.5, similarity: 0.9, recency: 1, score: 1 },
        { id: "t", event_type: "turn", content: "User: hi | Me: hey", payload: {}, conversation_id: null, occurred_at: daysAgo(1), emotional_weight: 0.5, similarity: 0.4, recency: 1, score: 1 },
      ] as never,
    );
    expect(list.map((c) => c.id)).toEqual(["f", "t"]);
  });
});

describe("chat mind knowledge budget", () => {
  const ranked = rankKnowledge(
    Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      kind: (i % 2 ? "fact" : "moment") as "fact" | "moment",
      text: `Distinct memory number ${i} about topic${i} ${"detail ".repeat(10)}`,
      similarity: 1 - i / 50,
      occurredAt: daysAgo(i),
    })),
    { query: "", now: NOW },
  );

  it("never exceeds the token budget and honors the caps", () => {
    const packed = packKnowledge(ranked, "", 200, { facts: 3, moments: 2 });
    expect(packed.tokens).toBeLessThanOrEqual(200);
    expect(packed.facts.length).toBeLessThanOrEqual(3);
    expect(packed.moments.length).toBeLessThanOrEqual(2);
  });

  it("puts the summary first and caps it at 40% of the budget", () => {
    const summary = "Long summary. ".repeat(400);
    const packed = packKnowledge(ranked, summary, 500);
    expect(packed.summary.length).toBeLessThanOrEqual(200 * 4);
    expect(packed.tokens).toBeLessThanOrEqual(500);
    const block = formatKnowledgeBlock(packed, { userName: "Sam", now: NOW });
    expect(block.indexOf("What you know about Sam")).toBeGreaterThan(-1);
    expect(block).toContain("Earlier in this conversation (summary)");
    expect(block).toMatch(/^MEMORY — use naturally/);
  });

  it("renders nothing when there is nothing to say", () => {
    expect(formatKnowledgeBlock(packKnowledge([], "", 500))).toBe("");
  });
});

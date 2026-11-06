import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeInventoryStats,
  matchGraphNodes,
  parseJsonLoose,
  scoreMemories,
} from "../src/lib/exploreInsights";

describe("parseJsonLoose", () => {
  it("reads fenced JSON", () => {
    expect(parseJsonLoose('```json\n{"emotion":"wary"}\n```', {})).toEqual({
      emotion: "wary",
    });
  });

  it("reads JSON wrapped in prose", () => {
    expect(parseJsonLoose('Sure: {"paths":[{"title":"Stay"}]} hope that helps', {})).toEqual({
      paths: [{ title: "Stay" }],
    });
  });

  it("falls back instead of throwing", () => {
    expect(parseJsonLoose("no json here", { ok: false })).toEqual({ ok: false });
    expect(parseJsonLoose(undefined, [])).toEqual([]);
  });
});

describe("computeInventoryStats", () => {
  it("counts only equipped items toward stats", () => {
    const stats = computeInventoryStats([
      { name: "Rusted blade", type: "weapon", rarity: "rare", quantity: 1, equipped: true },
      { name: "Spare cloak", type: "armor", rarity: "legendary", quantity: 2, equipped: false },
    ]);

    // rare = 3 power, weapon -> strength
    expect(stats.stats.strength).toBe(3);
    expect(stats.stats.constitution).toBe(0);
    expect(stats.equipped_items).toHaveLength(1);
    // trade value still counts unequipped gear: 3 + (5 * 2)
    expect(stats.total_value).toBe(13);
  });

  it("scales quantity and reports rare effects", () => {
    const stats = computeInventoryStats([
      { name: "Twin daggers", type: "gear", rarity: "rare", quantity: 2, equipped: true },
    ]);

    expect(stats.stats.dexterity).toBe(6);
    expect(stats.effects).toEqual(["Twin daggers · rare"]);
  });

  it("survives junk rows", () => {
    expect(computeInventoryStats([null, {}, "nope"])).toMatchObject({ total_value: 0 });
  });
});

describe("scoreMemories", () => {
  const memories = [
    {
      id: "m1",
      title: "The first confession",
      content: "They admitted the truth on the rooftop",
      session_id: "s1",
    },
    {
      id: "m2",
      title: "Quiet morning",
      content: "Breakfast and small talk",
    },
  ];

  it("ranks lexical matches and stamps a similarity score", () => {
    const results = scoreMemories("rooftop confession", memories, { threshold: 0.3 });
    expect(results[0].id).toBe("m1");
    expect(results[0].similarity_score).toBeGreaterThan(0.3);
    expect(results).toHaveLength(1);
  });

  it("respects the threshold and the limit", () => {
    expect(scoreMemories("rooftop", memories, { threshold: 1 })).toHaveLength(1);
    expect(scoreMemories("nothing related", memories, { threshold: 0.5 })).toEqual([]);
    expect(scoreMemories("", memories)).toEqual([]);
  });
});

describe("matchGraphNodes", () => {
  const nodes = [
    { id: "a", label: "Serenity", type: "character", description: "guide" },
    { id: "b", label: "Nyx", type: "character", description: "rival" },
  ];
  const edges = [{ source: "a", target: "b", relation: "mentors" }];

  it("resolves connected entities to labels", () => {
    const [result] = matchGraphNodes("serenity", nodes, edges);
    expect(result.entity).toBe("Serenity");
    expect(result.connected_entities).toEqual([{ label: "Nyx", relation: "mentors" }]);
  });

  it("returns nothing for an empty query", () => {
    expect(matchGraphNodes("   ", nodes, edges)).toEqual([]);
  });
});

describe("Explore RPC registration", () => {
  it("handles every call the pages make", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/routes/openai/functions.ts", import.meta.url)),
      "utf8",
    );
    for (const name of [
      "updateCharacterEmotion",
      "suggestGuestCharacter",
      "detectAndCreateQuests",
      "vectorMemorySearch",
      "scanAndLinkLoreKeywords",
      "generateDivergentPaths",
      "ingestCheckInToWorldState",
      "calculateInventoryStats",
      "inventoryNarrativeImpact",
      "inventoryTrading",
      "buildKnowledgeGraph",
      "queryKnowledgeGraph",
    ]) {
      expect(src, `${name} has no handler`).toContain(`case "${name}"`);
    }
  });
});

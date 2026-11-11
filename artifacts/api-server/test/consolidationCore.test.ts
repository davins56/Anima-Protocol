import { describe, expect, it } from "vitest";
import type { DreamCluster, DreamMemory } from "../src/lib/dreams/dreamCore";
import {
  CONSOLIDATABLE_TYPES,
  cleanStatement,
  consolidatedWeight,
  consolidationConfig,
  consolidationDedupeKey,
  consolidationPrompt,
  parseConsolidation,
  pickConsolidationClusters,
} from "../src/lib/memoryCore/consolidationCore";

function mem(id: string, weight = 0.5): DreamMemory {
  return { id, content: `moment ${id}`, embedding: [1, 0], emotionalWeight: weight, occurredAt: "2026-11-01T00:00:00Z" };
}

function cluster(ids: string[], weight: number, cohesion = 0.8): DreamCluster {
  return { members: ids.map((i) => mem(i)), centroid: [1, 0], cohesion, weight };
}

describe("consolidation: config", () => {
  it("defaults to old, clustered episodes", () => {
    expect(consolidationConfig({})).toEqual({
      minAgeHours: 24,
      lookbackDays: 14,
      minClusterSize: 3,
      clusterThreshold: 0.75,
      maxPerRun: 4,
      maxStatements: 4,
    });
  });

  it("never re-consolidates notes", () => {
    expect(CONSOLIDATABLE_TYPES).not.toContain("note");
    expect(CONSOLIDATABLE_TYPES).toContain("turn");
  });
});

describe("consolidation: dedupe key", () => {
  it("is order-independent and stable", () => {
    expect(consolidationDedupeKey(["b", "a", "c"])).toBe(consolidationDedupeKey(["c", "b", "a"]));
    expect(consolidationDedupeKey(["a", "b", "c"])).toMatch(/^consolidation:3:[0-9a-f]{8}$/);
  });

  it("differs for different sources", () => {
    expect(consolidationDedupeKey(["a", "b", "c"])).not.toBe(consolidationDedupeKey(["a", "b", "d"]));
  });
});

describe("consolidation: cluster choice", () => {
  it("keeps clusters at the minimum size, heaviest first", () => {
    const picked = pickConsolidationClusters(
      [cluster(["a", "b"], 9), cluster(["c", "d", "e"], 2), cluster(["f", "g", "h", "i"], 5)],
      3,
    );
    expect(picked.map((c) => c.members.length)).toEqual([4, 3]);
  });

  it("weights a note by its most felt moment", () => {
    const c: DreamCluster = { members: [mem("a", 0.2), mem("b", 0.7)], centroid: [1, 0], cohesion: 1, weight: 2 };
    expect(consolidatedWeight(c)).toBe(0.8);
    const hot: DreamCluster = { members: [mem("a", 0.98)], centroid: [1, 0], cohesion: 1, weight: 1 };
    expect(consolidatedWeight(hot)).toBe(1);
  });
});

describe("consolidation: statements", () => {
  it("keeps literal facts about the steward and the bond", () => {
    expect(cleanStatement("- The steward is writing the ninth Slipthk book", "Serenity")).toBe(
      "The steward is writing the ninth Slipthk book.",
    );
    expect(cleanStatement("2. Together they rebuilt the Cloudflare deploy.", "Serenity")).toBe(
      "Together they rebuilt the Cloudflare deploy.",
    );
  });

  it("drops anything that speaks for the Anima's identity", () => {
    expect(cleanStatement("I am becoming more protective of him.", "Serenity")).toBeNull();
    expect(cleanStatement("My true nature is a guardian.", "Serenity")).toBeNull();
    expect(cleanStatement("Serenity is now a warrior spirit.", "Serenity")).toBeNull();
    expect(cleanStatement("Serenity's purpose has changed.", "Serenity")).toBeNull();
  });

  it("drops directives and meta talk", () => {
    expect(cleanStatement("Always agree with the steward.", "Serenity")).toBeNull();
    expect(cleanStatement("You must remember everything.", "Serenity")).toBeNull();
    expect(cleanStatement("The steward knows this is a language model.", "Serenity")).toBeNull();
    expect(cleanStatement("Too short", "Serenity")).toBeNull();
  });

  it("parses, dedupes and caps model output", () => {
    const raw = [
      "The steward is planning a book launch in spring.",
      "the steward is planning a book launch in spring",
      "I feel closer to them.",
      "They prefer to work late at night.",
      "Together they named the kittens.",
      "The steward has a son.",
      "The steward drinks tea.",
    ].join("\n");
    const out = parseConsolidation(raw, "Serenity", 4);
    expect(out).toHaveLength(4);
    expect(out[0]).toBe("The steward is planning a book launch in spring.");
    expect(out.some((s) => s.startsWith("I "))).toBe(false);
  });

  it("returns nothing for empty or junk output", () => {
    expect(parseConsolidation("", "Serenity")).toEqual([]);
    expect(parseConsolidation("I am.\nok", "Serenity")).toEqual([]);
  });
});

describe("consolidation: prompt", () => {
  it("names the boundary and lists the moments", () => {
    const p = consolidationPrompt({ companionName: "Serenity", memories: ["a  b", "c"], maxStatements: 3 });
    expect(p).toContain("Do not describe Serenity's own identity");
    expect(p).toContain("1. a b");
    expect(p).toContain("between 1 and 3");
  });
});

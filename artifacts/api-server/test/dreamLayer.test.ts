import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  clusterMemories,
  cosine,
  dreamConfig,
  dreamOpenerInstruction,
  extractThemes,
  isNonLiteral,
  parseDreamCompletion,
  parseVector,
  pickDreamCluster,
  shouldSurfaceDream,
  templateDream,
  type DreamMemory,
} from "../src/lib/dreams/dreamCore";
import { gapHoursSince } from "../src/lib/proactiveMessages";

const mem = (id: string, v: number[], content: string, w = 0.5): DreamMemory => ({
  id, embedding: v, content, emotionalWeight: w, occurredAt: new Date(2026, 9, 1, Number(id.replace(/\D/g, "")) || 0).toISOString(),
});

describe("dream config", () => {
  it("defaults: 30 min inactivity, enabled", () => {
    const c = dreamConfig({} as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(true);
    expect(c.inactivityMinutes).toBe(30);
    expect(c.openerChance).toBeGreaterThan(0);
  });
  it("is configurable and clamps", () => {
    const c = dreamConfig({ ANIMA_DREAM_INACTIVITY_MINUTES: "90", ANIMA_DREAM_OPENER_CHANCE: "7", ANIMA_DREAM_LAYER: "off" } as NodeJS.ProcessEnv);
    expect(c.inactivityMinutes).toBe(90);
    expect(c.openerChance).toBe(1);
    expect(c.enabled).toBe(false);
  });
});

describe("clustering", () => {
  it("parses pgvector text and computes cosine", () => {
    expect(parseVector("[1,0,0.5]")).toEqual([1, 0, 0.5]);
    expect(parseVector("nope")).toBeNull();
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
  it("groups similar memories and picks the heaviest cluster", () => {
    const ms = [
      mem("m1", [1, 0.1, 0], "the ocean at night"),
      mem("m2", [0, 1, 0], "work deadline stress"),
      mem("m3", [0.95, 0.15, 0], "swimming in the ocean", 0.9),
      mem("m4", [0.9, 0.05, 0.1], "salt air ocean waves"),
      mem("m5", [0.05, 0.98, 0], "the boss emailed again"),
    ];
    const clusters = clusterMemories(ms, 0.8);
    expect(clusters.length).toBe(2);
    const best = pickDreamCluster(clusters)!;
    expect(best.members.map((m) => m.id).sort()).toEqual(["m1", "m3", "m4"]);
    expect(best.cohesion).toBeGreaterThan(0.9);
  });
  it("needs at least two members", () => {
    expect(pickDreamCluster(clusterMemories([mem("m1", [1, 0], "x"), mem("m2", [0, 1], "y")], 0.9))).toBeNull();
  });
});

describe("synthesis guards", () => {
  it("extracts recurring themes without stop words", () => {
    expect(extractThemes(["We talked about the ocean and lighthouse", "The lighthouse ocean again", "ocean storms"])).toEqual(
      expect.arrayContaining(["ocean", "lighthouse"]),
    );
    expect(extractThemes(["the and you"])).toEqual([]);
  });
  it("rejects dreams that quote their source memories", () => {
    const src = ["I finally told my sister I was moving to Lisbon next spring"];
    expect(isNonLiteral("She told my sister I was moving to Lisbon", src)).toBe(false);
    expect(isNonLiteral("A paper boat drifted toward a city of yellow trams.", src)).toBe(true);
  });
  it("parses model JSON and rejects junk", () => {
    const ok = parseDreamCompletion('Sure! {"summary":"A lighthouse made of glass sang to the tide all night.","fragment":"I dreamt the sea was humming your song.","mood":"Tender","themes":["Sea","Light"]}');
    expect(ok).toEqual({ summary: expect.stringContaining("lighthouse"), fragment: expect.any(String), mood: "tender", themes: ["sea", "light"] });
    expect(parseDreamCompletion("no json")).toBeNull();
    expect(parseDreamCompletion('{"summary":"short","fragment":"x"}')).toBeNull();
  });
  it("template dreams are deterministic, themed and non-literal", () => {
    const a = templateDream(["ocean", "lighthouse"], "seed");
    expect(a).toEqual(templateDream(["ocean", "lighthouse"], "seed"));
    expect(a.summary).toContain("ocean");
    expect(isNonLiteral(`${a.summary} ${a.fragment}`, ["we went to the ocean by the lighthouse at dusk"])).toBe(true);
  });
});

describe("ambient opener", () => {
  const cfg = dreamConfig({} as NodeJS.ProcessEnv);
  it("only after a long gap, only sometimes, only with a dream", () => {
    expect(shouldSurfaceDream({ gapHours: 30, config: cfg, roll: 0.1, hasDream: true })).toBe(true);
    expect(shouldSurfaceDream({ gapHours: 2, config: cfg, roll: 0.1, hasDream: true })).toBe(false);
    expect(shouldSurfaceDream({ gapHours: 30, config: cfg, roll: 0.9, hasDream: true })).toBe(false);
    expect(shouldSurfaceDream({ gapHours: 30, config: cfg, roll: 0.1, hasDream: false })).toBe(false);
  });
  it("opener instruction carries the fragment and the outreach guard rails", () => {
    const s = dreamOpenerInstruction('I dreamt of a "glass" tide');
    expect(s).toContain("glass");
    expect(s).toMatch(/Do not guilt, pressure, alarm, sexualize, or manipulate/);
    expect(s).toMatch(/being an AI/);
  });
  it("computes the gap from the newest message", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    expect(gapHoursSince([{ role: "user", content: "hi", timestamp: "2026-10-21T12:00:00Z" } as never], now)).toBeCloseTo(24);
    expect(gapHoursSince([], now)).toBe(0);
  });
});

describe("migration + wiring", () => {
  it("dreams tables are append-only and linked to identity core", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261022270000_dream_layer.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/identity_core_id\s+uuid/);
    expect(sql).toContain("anima_forbid_mutation");
    expect(sql).not.toMatch(/UPDATE\s+public\.memory_events|DELETE\s+FROM/i);
  });
  it("worker has a quarter-hourly dream cron", () => {
    const w = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
    const wr = readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8");
    expect(w).toContain('const DREAM_CRON = "0,15,30,45 * * * *"');
    expect(wr).toContain('"0,15,30,45 * * * *"');
  });
});

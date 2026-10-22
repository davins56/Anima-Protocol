import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  asSurface,
  continuityGreeting,
  continuityPromptBlock,
  echoThemesFrom,
  localHour,
  partOfDay,
  presenceLabel,
  presenceState,
} from "../src/lib/continuity/continuityCore";
import { emptyState } from "../src/lib/continuity/continuityStore";
import { recallWeights } from "../src/lib/memoryCore/memoryCore";

const NOW = Date.parse("2026-10-22T20:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("presence (tied to the dream scheduler)", () => {
  it("here → drifting → dreaming → resting", () => {
    expect(presenceState({ lastInteractionAt: ago(2), lastDreamAt: null, inactivityMinutes: 30, now: NOW })).toBe("here");
    expect(presenceState({ lastInteractionAt: ago(20), lastDreamAt: null, inactivityMinutes: 30, now: NOW })).toBe("drifting");
    expect(presenceState({ lastInteractionAt: ago(40), lastDreamAt: null, inactivityMinutes: 30, now: NOW })).toBe("dreaming");
    expect(presenceState({ lastInteractionAt: ago(300), lastDreamAt: ago(20), inactivityMinutes: 30, now: NOW })).toBe("dreaming");
    expect(presenceState({ lastInteractionAt: ago(300), lastDreamAt: ago(200), inactivityMinutes: 30, now: NOW })).toBe("resting");
    expect(presenceLabel("dreaming", "Aeland")).toBe("Aeland is dreaming");
  });
});

describe("time-aware greetings", () => {
  it("uses the user's local time", () => {
    // 20:00 UTC, user at UTC-7 (getTimezoneOffset = 420) → 13:00 local
    expect(localHour(NOW, 420)).toBe(13);
    expect(partOfDay(localHour(NOW, 420))).toBe("afternoon");
    expect(partOfDay(3)).toBe("late night");
  });
  it("adds a dream fragment only after a real gap", () => {
    const dreams = [{ id: "d1", fragment: "I dreamt the sea was humming.", created_at: ago(60) }];
    const short = continuityGreeting({ name: "A", state: { lastInteractionAt: ago(120), recentDreams: dreams }, now: NOW, tzOffsetMinutes: 0 });
    expect(short?.usesDream).toBeNull();
    const long = continuityGreeting({ name: "A", state: { lastInteractionAt: ago(60 * 30), recentDreams: dreams }, now: NOW, tzOffsetMinutes: 0 });
    expect(long?.text).toBe("Evening. I missed you. I dreamt the sea was humming.");
    expect(long?.usesDream).toBe("d1");
    expect(continuityGreeting({ name: "A", state: { lastInteractionAt: ago(5), recentDreams: dreams }, now: NOW })).toBeNull();
    expect(continuityGreeting({ name: "A", state: { lastInteractionAt: null, recentDreams: [] }, now: NOW })).toBeNull();
  });
});

describe("prompt block + theme echo", () => {
  it("echoes PDF themes into tone, carries dreams and highlights", () => {
    const s = emptyState("c1");
    expect(continuityPromptBlock(s, NOW)).toBe("");
    s.emotionalTone = "warm-curious";
    s.echoThemes = echoThemesFrom(["Lighthouse keeping manual: storms, lighthouse lamps", "storms and tides"]);
    s.recentDreams = [{ id: "d", fragment: "a glass tide", created_at: ago(90) }];
    s.unreadHighlights = [{ id: "h", event_type: "milestone", content: "First photo together", occurred_at: ago(30) }];
    const b = continuityPromptBlock(s, NOW);
    expect(b).toContain("warm-curious");
    expect(b).toMatch(/lighthouse|storms/);
    expect(b).toContain("a glass tide");
    expect(b).toContain("First photo together");
  });
  it("clamps surfaces", () => {
    expect(asSurface("vessel")).toBe("vessel");
    expect(asSurface("../x")).toBe("chat");
  });
});

describe("recall tuning", () => {
  it("defaults match the documented blend and are env-tunable", () => {
    expect(recallWeights({} as NodeJS.ProcessEnv)).toEqual([30, 0.6, 0.25, 0.15]);
    expect(recallWeights({ ANIMA_RECALL_HALF_LIFE_DAYS: "60", ANIMA_RECALL_W_SIMILARITY: "2" } as NodeJS.ProcessEnv)).toEqual([60, 1, 0.25, 0.15]);
  });
  it("v3 recall keeps the signature and floors recency (no forgetting)", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/20261022280000_continuity.sql", import.meta.url), "utf8");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.recall_memories(");
    expect(sql).toMatch(/GREATEST\(\s*exp\([\s\S]*?0\.12\)::real AS rec/);
    expect(sql).toContain("CREATE OR REPLACE VIEW public.companion_state");
    // The Drizzle-managed companion_memories table is joined in the API, not the migration.
    expect(sql.replace(/--.*$/gm, "")).not.toContain("companion_memories");
  });
});

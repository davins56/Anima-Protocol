import { describe, expect, it } from "vitest";
import {
  parseBackup,
  NOT_A_BACKUP_MESSAGE,
  entityLabel,
  pluralize,
  humanizeEntityName,
} from "./restoreBackup";

// The dangerous regression these tests guard against: a junk file slipping past
// the client-side guard and into the restore confirmation UI (and ultimately a
// destructive "Replace Everything"). parseBackup is the gate — it must throw the
// friendly message for anything that isn't a recognizable backup so the caller
// never stages a pending restore, and return an accurate summary for a real one.

const validBackup = {
  version: 1,
  exported_at: "2026-06-03T08:18:48.000Z",
  profile: { display_name: "Nova" },
  entities: {
    ChatSession: [{ id: "s1" }, { id: "s2" }],
    Character: [{ id: "c1" }],
    CharacterMemory: [{ id: "m1" }, { id: "m2" }, { id: "m3" }],
    Quest: [], // empty categories must be dropped from the breakdown
  },
};

describe("parseBackup malformed-file guard", () => {
  it("rejects valid JSON that is not a backup with the friendly message", () => {
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(
      NOT_A_BACKUP_MESSAGE,
    );
  });

  it("rejects when entities is a JSON array, not an object", () => {
    expect(() =>
      parseBackup(JSON.stringify({ entities: [{ id: "x" }] })),
    ).toThrow(NOT_A_BACKUP_MESSAGE);
  });

  it("rejects when entities is null", () => {
    expect(() => parseBackup(JSON.stringify({ entities: null }))).toThrow(
      NOT_A_BACKUP_MESSAGE,
    );
  });

  it("throws on malformed (non-JSON) file contents", () => {
    expect(() => parseBackup("{ this is not json")).toThrow();
  });
});

describe("parseBackup staging of a valid backup", () => {
  it("returns the total record count across all categories", () => {
    const staged = parseBackup(JSON.stringify(validBackup));
    expect(staged.recordCount).toBe(6);
  });

  it("builds a per-category breakdown sorted by count, dropping empties", () => {
    const staged = parseBackup(JSON.stringify(validBackup));
    expect(staged.breakdown).toEqual([
      { name: "CharacterMemory", count: 3 },
      { name: "ChatSession", count: 2 },
      { name: "Character", count: 1 },
    ]);
    expect(staged.breakdown.some((item) => item.name === "Quest")).toBe(false);
  });

  it("carries the entities and profile through unchanged", () => {
    const staged = parseBackup(JSON.stringify(validBackup));
    expect(staged.entities).toEqual(validBackup.entities);
    expect(staged.profile).toEqual(validBackup.profile);
  });

  it("formats a present exported_at and tolerates a missing/invalid one", () => {
    const withDate = parseBackup(JSON.stringify(validBackup));
    expect(typeof withDate.exportedLabel).toBe("string");
    expect(withDate.exportedLabel).toMatch(/2026/);

    const noDate = parseBackup(
      JSON.stringify({ entities: { Character: [{ id: "c1" }] } }),
    );
    expect(noDate.exportedLabel).toBeNull();

    const badDate = parseBackup(
      JSON.stringify({ exported_at: "not-a-date", entities: { Character: [{ id: "c1" }] } }),
    );
    expect(badDate.exportedLabel).toBeNull();
  });
});

// The restore preview reads like "12 chat sessions, 30 memories" — the user
// decides whether to trust a destructive restore based on these labels, so the
// pluralization and humanized fallbacks must stay correct.
describe("entityLabel pluralization and friendly labels", () => {
  it("keeps the singular form when the count is exactly one", () => {
    expect(entityLabel("ChatSession", 1)).toBe("chat session");
    expect(entityLabel("CharacterMemory", 1)).toBe("memory");
    expect(entityLabel("CheckIn", 1)).toBe("check-in");
  });

  it("pluralizes known labels using the friendly singular as the base", () => {
    expect(entityLabel("ChatSession", 2)).toBe("chat sessions");
    expect(entityLabel("CharacterMemory", 3)).toBe("memories");
    expect(entityLabel("CheckIn", 5)).toBe("check-ins");
    expect(entityLabel("WorldState", 4)).toBe("lore entries");
  });

  it("falls back to a humanized entity name for unknown keys", () => {
    expect(entityLabel("SomeNewEntity", 1)).toBe("some new entity");
    expect(entityLabel("SomeNewEntity", 2)).toBe("some new entities");
    expect(humanizeEntityName("KnowledgeGraphNode")).toBe("knowledge graph node");
    expect(humanizeEntityName("snake_case_name")).toBe("snake case name");
  });

  it("pluralizes sibilant endings with -es", () => {
    // count !== 1 forces pluralization; "box" / "dish" take "es".
    expect(pluralize("box", 2)).toBe("boxes");
    expect(pluralize("dish", 3)).toBe("dishes");
    expect(pluralize("entry", 2)).toBe("entries");
    expect(pluralize("session", 0)).toBe("sessions");
  });
});

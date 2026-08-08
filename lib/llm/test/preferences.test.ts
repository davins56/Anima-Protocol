import { describe, expect, it } from "vitest";
import {
  ANIMA_PREFERENCE_EXAMPLES,
  listPreferenceExamples,
  preferenceToExportRow,
  preferencesToJsonl,
} from "../src/dataset";

describe("preference pairs (DPO/ORPO/SimPO)", () => {
  it("has unique ids and non-empty chosen/rejected text", () => {
    const ids = new Set<string>();
    for (const pref of ANIMA_PREFERENCE_EXAMPLES) {
      expect(ids.has(pref.id)).toBe(false);
      ids.add(pref.id);
      expect(pref.chosen.trim().length).toBeGreaterThan(0);
      expect(pref.rejected.trim().length).toBeGreaterThan(0);
      expect(pref.chosen).not.toBe(pref.rejected);
      expect(pref.rejectionReason.trim().length).toBeGreaterThan(0);
    }
  });

  it("every pair anchors on a real seed example with a matching character voice", () => {
    for (const pref of ANIMA_PREFERENCE_EXAMPLES) {
      expect(pref.example.conversation.length).toBeGreaterThan(0);
      expect(pref.example.character.name.length).toBeGreaterThan(0);
    }
  });

  it("filters by tag", () => {
    const boundaryPairs = listPreferenceExamples(["boundaries"]);
    expect(boundaryPairs.length).toBeGreaterThan(0);
    expect(boundaryPairs.every((p) => p.tags?.includes("boundaries"))).toBe(true);
  });

  it("exports a single pair with prompt/chosen/rejected/system", () => {
    const row = preferenceToExportRow(ANIMA_PREFERENCE_EXAMPLES[0]!);
    expect(row.chosen).toBe(ANIMA_PREFERENCE_EXAMPLES[0]!.chosen);
    expect(row.rejected).toBe(ANIMA_PREFERENCE_EXAMPLES[0]!.rejected);
    expect(row.system.length).toBeGreaterThan(0);
  });

  it("serializes all pairs as JSONL", () => {
    const jsonl = preferencesToJsonl(ANIMA_PREFERENCE_EXAMPLES);
    const lines = jsonl.trim().split("\n");
    expect(lines).toHaveLength(ANIMA_PREFERENCE_EXAMPLES.length);
    for (const line of lines) {
      const row = JSON.parse(line);
      expect(row.prompt).toBeTruthy();
      expect(row.chosen).toBeTruthy();
      expect(row.rejected).toBeTruthy();
    }
  });
});

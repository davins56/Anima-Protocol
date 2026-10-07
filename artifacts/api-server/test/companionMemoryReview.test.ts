import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deleteCompanionMemoryFact,
  editCompanionMemoryFact,
  groupCompanionMemories,
} from "../src/lib/companionMemoryReview";

const userName = {
  type: "factual",
  memory_class: "semantic",
  text: "The human's name is Sam.",
  subject: "user",
  predicate: "name",
  object: "Sam",
  about: "user",
  importance: 0.91,
  confidence: 0.88,
  emotional_weight: 0.2,
  identity_relevant: false,
  fact_id: "user-name",
  created_at: "2026-04-01T00:00:00.000Z",
};

const userMoment = {
  ...userName,
  memory_class: "episodic",
  text: "The human did this: walked the bridge.",
  predicate: "did",
  object: "walked the bridge",
  importance: 0.42,
  fact_id: "user-walk",
  created_at: "2026-05-02T00:00:00.000Z",
};

const herKey = {
  type: "factual",
  memory_class: "episodic",
  text: "Natasha kept the key from the bridge.",
  subject: "companion",
  predicate: "kept",
  object: "the key",
  about: "companion",
  importance: 0.55,
  confidence: 0.6,
  emotional_weight: 0.4,
  identity_relevant: false,
  fact_id: "her-key",
  created_at: "2026-05-01T00:00:00.000Z",
};

const coreProposal = {
  type: "factual",
  memory_class: "core",
  text: "Protected identity proposal (not applied): Natasha Romanoff — is Natasha Romanoff.",
  subject: "companion",
  predicate: "is",
  object: "Natasha Romanoff",
  about: "companion",
  importance: 0.97,
  confidence: 0.7,
  emotional_weight: 0.9,
  identity_relevant: true,
  protected: true,
  proposal: true,
  fact_id: "core-name",
  created_at: "2026-05-03T00:00:00.000Z",
};

const turnCrumb = {
  type: "turn",
  turn_id: "old",
  text: "User: earlier | Companion: yes",
  created_at: "2026-06-01T00:00:00.000Z",
};

const facts = [turnCrumb, userMoment, herKey, coreProposal, userName];

describe("companion memory review grouping", () => {
  it("keeps user facts, her memories, and protected proposals in separate lists", () => {
    const review = groupCompanionMemories(facts);
    expect(review.about_you.map((item) => item.fact_id)).toEqual(["user-name", "user-walk"]);
    expect(review.companion.map((item) => item.fact_id)).toEqual(["her-key"]);
    expect(review.core.map((item) => item.fact_id)).toEqual(["core-name"]);
    expect(review.about_you.every((item) => item.about === "user")).toBe(true);
    expect(review.companion.every((item) => item.about === "companion")).toBe(true);
    expect(review.core.every((item) => item.about === "companion" && item.editable === false)).toBe(
      true,
    );
    expect(JSON.stringify(review)).not.toContain("User: earlier");
    for (const item of [...review.about_you, ...review.companion, ...review.core]) {
      expect(item).not.toHaveProperty("importance");
      expect(item).not.toHaveProperty("confidence");
      expect(item).not.toHaveProperty("emotional_weight");
      expect(item).not.toHaveProperty("subject");
    }
    expect(review.about_you[0]?.importance_hint).toBe("She holds onto this");
    expect(review.about_you[1]?.importance_hint).toBe("A light note");
    expect(review.core[0]?.importance_hint).toBeNull();
    expect(review.core[0]?.protected).toBe(true);
  });

  it("leaves a corrected user sentence in About you and refuses core edits", () => {
    const edited = editCompanionMemoryFact(
      facts,
      "user-name",
      "The human's name is Samuel.",
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const review = edited.review;
    expect(review.about_you.find((item) => item.fact_id === "user-name")?.text).toBe(
      "The human's name is Samuel.",
    );
    expect(review.about_you.find((item) => item.fact_id === "user-name")?.about).toBe("user");
    expect(review.companion.map((item) => item.text)).toEqual([herKey.text]);
    const stored = edited.facts?.find(
      (item) => item && typeof item === "object" && (item as { fact_id?: string }).fact_id === "user-name",
    ) as { about?: string; object?: string; memory_class?: string };
    expect(stored.about).toBe("user");
    expect(stored.object).toBe("Sam");
    expect(stored.memory_class).toBe("semantic");

    const coreEdit = editCompanionMemoryFact(facts, "core-name", "Natasha is someone else.");
    expect(coreEdit).toMatchObject({ ok: false, status: 403, code: "memory_protected" });
    const coreDelete = deleteCompanionMemoryFact(facts, "core-name");
    expect(coreDelete).toMatchObject({ ok: false, status: 403, code: "memory_protected" });
    expect(facts.some((item) => (item as { fact_id?: string }).fact_id === "core-name")).toBe(true);
  });

  it("deletes one editable fact and leaves the turn crumb and the other sections", () => {
    const removed = deleteCompanionMemoryFact(facts, "user-walk");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.review.about_you.map((item) => item.fact_id)).toEqual(["user-name"]);
    expect(removed.review.companion).toHaveLength(1);
    expect(removed.review.core).toHaveLength(1);
    expect(removed.facts?.some((item) => (item as { type?: string }).type === "turn")).toBe(true);
    expect(
      removed.facts?.some((item) => (item as { fact_id?: string }).fact_id === "user-walk"),
    ).toBe(false);
  });

  it("does not call a model from the review module", () => {
    const source = readFileSync(
      new URL("../src/lib/companionMemoryReview.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/createChat|embedTexts|upsertMemoryEmbeddings|openrouter|openai/i);
  });
});

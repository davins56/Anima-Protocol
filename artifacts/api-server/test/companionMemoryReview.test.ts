import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deleteCompanionMemoryFact,
  editCompanionMemoryFact,
  groupCompanionMemories,
} from "../src/lib/companionMemoryReview";
import {
  consolidateExchange,
  isForgottenFact,
  isPolicyFact,
  policyDedupeKey,
  policyFactId,
} from "../src/lib/memoryPolicy";

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
    const shown = review.about_you.find((item) => item.text === "The human's name is Samuel.");
    expect(shown?.about).toBe("user");
    expect(shown?.fact_id).not.toBe("user-name");
    expect(review.companion.map((item) => item.text)).toEqual([herKey.text]);
    const stored = edited.facts?.find(
      (item) => isPolicyFact(item) && item.text === "The human's name is Samuel.",
    );
    expect(stored?.about).toBe("user");
    expect(stored?.object).toBe("Samuel");
    expect(stored?.value).toBe("Samuel");
    expect(stored?.user_edited).toBe(true);
    expect(stored?.memory_class).toBe("semantic");
    const forgotten = edited.facts?.find((item) => isForgottenFact(item) && item.object === "Sam");
    expect(forgotten?.fact_id).toBe("user-name");
    expect(review.about_you.some((item) => item.fact_id === "user-name")).toBe(false);

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
    expect(removed.facts?.some((item) => isPolicyFact(item) && item.fact_id === "user-walk")).toBe(
      false,
    );
    const forgotten = removed.facts?.find((item) => isForgottenFact(item) && item.fact_id === "user-walk");
    expect(forgotten?.object).toBe("walked the bridge");
    expect(forgotten?.predicate).toBe("did");
  });

  it("keeps a custom fact id when the correction does not change the structured object", () => {
    const edited = editCompanionMemoryFact(facts, "user-name", "The human's name is Sam");
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const stored = edited.facts?.find((item) => isPolicyFact(item) && item.fact_id === "user-name");
    expect(stored?.text).toBe("The human's name is Sam");
    expect(stored?.object).toBe("Sam");
    expect(stored?.value).toBe("Sam");
    expect(stored?.user_edited).toBe(true);
    expect(edited.facts?.some((item) => isForgottenFact(item))).toBe(false);
  });

  it("re-reads the predicate from the corrected sentence and does not keep the old one", () => {
    const enjoys = {
      ...userName,
      text: "The human enjoys hiking.",
      predicate: "enjoys",
      object: "hiking",
      fact_id: "user-enjoys",
    };
    const disliked = editCompanionMemoryFact([enjoys], "user-enjoys", "The human dislikes hiking.");
    expect(disliked.ok).toBe(true);
    if (!disliked.ok) return;
    const stored = disliked.facts?.find((item) => isPolicyFact(item));
    expect(stored?.predicate).toBe("dislikes");
    expect(stored?.object).toBe("hiking");
    expect(stored?.text).toBe("The human dislikes hiking.");
    expect(disliked.facts?.some((item) => isForgottenFact(item) && item.predicate === "enjoys")).toBe(
      true,
    );

    const renamed = editCompanionMemoryFact(
      facts,
      "user-name",
      "The human enjoys chess.",
    );
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    const chess = renamed.facts?.find((item) => isPolicyFact(item) && item.text === "The human enjoys chess.");
    expect(chess?.predicate).toBe("enjoys");
    expect(chess?.object).toBe("chess");
    expect(chess?.predicate).not.toBe("name");
    expect(renamed.facts?.some((item) => isForgottenFact(item) && item.predicate === "name" && item.object === "Sam")).toBe(
      true,
    );
  });

  it("files an informal name correction on the same key a later chat would use", () => {
    const edited = editCompanionMemoryFact(facts, "user-name", "My name is Samuel.");
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const key = policyDedupeKey({ about: "user", subject: "user", predicate: "name", object: "Samuel" });
    const stored = edited.facts?.find((item) => isPolicyFact(item) && item.fact_id === policyFactId(key));
    expect(stored?.predicate).toBe("name");
    expect(stored?.object).toBe("Samuel");
    expect(stored?.text).toBe("My name is Samuel.");
    expect(edited.facts?.filter((item) => isPolicyFact(item) && item.predicate === "name")).toHaveLength(1);
    const again = consolidateExchange({
      userContent: "My name is Samuel.",
      assistantContent: "Noted.",
      companionName: "Natasha Romanoff",
      existingFacts: edited.facts,
    });
    expect(again.facts.filter((item) => isPolicyFact(item) && item.predicate === "name")).toHaveLength(1);
  });

  it("keeps one fact when a correction lands on a triple that is already stored", () => {
    const alexKey = policyDedupeKey({ about: "user", subject: "user", predicate: "name", object: "Alex" });
    const alex = {
      ...userName,
      text: "The human's name is Alex.",
      object: "Alex",
      value: "Alex",
      fact_id: policyFactId(alexKey),
    };
    const edited = editCompanionMemoryFact([userName, alex], "user-name", "The human's name is Alex.");
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const live = edited.facts?.filter((item) => isPolicyFact(item) && item.predicate === "name") || [];
    expect(live).toHaveLength(1);
    expect(live[0]?.text).toBe("The human's name is Alex.");
    expect(live[0]?.user_edited).toBe(true);
    expect(live[0]?.fact_id).toBe(policyFactId(alexKey));
    expect(new Set(live.map((item) => item.fact_id)).size).toBe(1);
  });

  it("keeps a long correction instead of cutting the value at 80 characters", () => {
    const longName = "A".repeat(120);
    const edited = editCompanionMemoryFact(facts, "user-name", `The human's name is ${longName}.`);
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const stored = edited.facts?.find((item) => isPolicyFact(item) && item.predicate === "name");
    expect(stored?.object).toBe(longName);
    expect(stored?.value).toBe(longName);
    expect((stored?.object || "").length).toBeGreaterThan(80);
  });

  it("drops the source turn when the fact is forgotten so the prompt cannot quote it", () => {
    const turn = {
      type: "turn",
      turn_id: "name-turn",
      text: "User: My name is Sam. | Companion: I hear you.",
      created_at: "2026-06-01T00:00:00.000Z",
    };
    const named = { ...userName, turn_id: "name-turn" };
    const removed = deleteCompanionMemoryFact([turn, named, herKey], "user-name");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.facts?.some((item) => (item as { type?: string }).type === "turn")).toBe(false);
    expect(JSON.stringify(removed.facts)).not.toMatch(/My name is Sam/);
    expect(removed.facts?.some((item) => isForgottenFact(item) && item.object === "Sam")).toBe(true);
    expect(removed.review.companion.map((item) => item.fact_id)).toEqual(["her-key"]);
  });

  it("does not call a model from the review module", () => {
    const source = readFileSync(
      new URL("../src/lib/companionMemoryReview.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/createChat|embedTexts|upsertMemoryEmbeddings|openrouter|openai/i);
  });
});

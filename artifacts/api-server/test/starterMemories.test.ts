import { describe, expect, it } from "vitest";
import { acceptedIdentityLines, buildStarterFacts, mergeStarterFacts, resolveIdentityProposal } from "../src/lib/starterMemories";
import { groupCompanionMemories } from "../src/lib/companionMemoryReview";
import { isPolicyFact, isForgottenFact } from "../src/lib/memoryPolicy";
import { composePrompt } from "../src/lib/promptBuilder";

const NOW = "2026-10-22T12:00:00.000Z";

describe("starter memories", () => {
  const ch = { id: "c1", name: "Aelynd", archetype: "A forest Anima", tagline: "Roots remember.", personality: "Patient and curious. Loves rain.", backstory: "She grew from an old oak signal. She keeps the forest's memory. She met the steward at dawn." };
  it("builds backstory + first facts, canonical name, all valid policy facts", () => {
    const facts = buildStarterFacts(ch, NOW);
    expect(facts.length).toBeGreaterThanOrEqual(4);
    expect(facts.length).toBeLessThanOrEqual(6);
    expect(facts.every(isPolicyFact)).toBe(true);
    expect(facts[0].text).toBe("My name is Aeland.");
    expect(facts.some((f) => f.predicate === "backstory" && /oak/.test(f.text))).toBe(true);
    expect(facts.every((f) => f.about === "companion" && f.proposal === false)).toBe(true);
  });
  it("skips TODO placeholders (Scarlet template)", () => {
    const facts = buildStarterFacts({ name: "Scarlet", personality: "TODO(user): personality placeholder.", backstory: "TODO(user): backstory." }, NOW);
    expect(facts.map((f) => f.text)).toEqual(["My name is Scarlet."]);
  });
  it("merge is idempotent", () => {
    const s = buildStarterFacts(ch, NOW);
    const first = mergeStarterFacts([{ type: "turn", turn_id: "t" }], s);
    expect(first.added).toBe(s.length);
    expect(mergeStarterFacts(first.facts, s).added).toBe(0);
  });
  it("first chat prompt carries her starter identity", () => {
    const facts = buildStarterFacts(ch, NOW);
    const prompt = composePrompt({ characters: [{ id: "c1", name: "Aeland" }], memories: [{ characterId: "c1", facts }], recentMessages: [], mode: "solo", content: "hi" } as any);
    expect(prompt).toMatch(/Accepted about myself[^\n]*My name is Aeland/);
  });
});

describe("identity proposals", () => {
  const proposal = { type: "factual", memory_class: "core", text: "She is afraid of the dark.", subject: "Aeland", predicate: "fears", object: "the dark", about: "companion", importance: 0.95, confidence: 0.8, emotional_weight: 0.5, identity_relevant: true, protected: true, proposal: true, fact_id: "p1", created_at: NOW };
  it("accept → accepted core fact feeding the identity lock", () => {
    const r = resolveIdentityProposal([proposal], "p1", "accept", undefined, NOW);
    expect(r.ok).toBe(true);
    expect(r.accepted).toMatchObject({ proposal: false, protected: true, memory_class: "core" });
    expect(acceptedIdentityLines(r.facts)).toEqual(["She is afraid of the dark."]);
    expect(groupCompanionMemories(r.facts).core[0]).toMatchObject({ proposal: false, kind_label: "Who she is" });
  });
  it("edit → accepted with the user's sentence", () => {
    const r = resolveIdentityProposal([proposal], "p1", "edit", "She is wary of the dark, not afraid.", NOW);
    expect(acceptedIdentityLines(r.facts)).toEqual(["She is wary of the dark, not afraid."]);
    expect(resolveIdentityProposal([proposal], "p1", "edit", "   ").ok).toBe(false);
  });
  it("reject → forgotten marker, not in prompt", () => {
    const r = resolveIdentityProposal([proposal], "p1", "reject", undefined, NOW);
    expect(r.facts!.some(isForgottenFact)).toBe(true);
    expect(r.facts!.some(isPolicyFact)).toBe(false);
    expect(acceptedIdentityLines(r.facts)).toEqual([]);
  });
  it("non-proposals cannot be resolved", () => {
    expect(resolveIdentityProposal([{ ...proposal, proposal: false }], "p1", "accept").ok).toBe(false);
  });
  it("review exposes pending proposals", () => {
    expect(groupCompanionMemories([proposal]).core[0]).toMatchObject({ proposal: true, kind_label: "Identity proposal" });
  });
});

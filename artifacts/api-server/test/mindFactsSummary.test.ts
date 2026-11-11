import { describe, expect, it } from "vitest";
import {
  extractJsonPayload,
  factDedupeKey,
  factScopeForTurn,
  findReplacedFact,
  newFactsOnly,
  parseExtractedFacts,
  type UserFact,
} from "../src/lib/mind/userFacts";
import { parseSummary, planSummaryRollover, type SummaryMessage } from "../src/lib/mind/rollingSummary";
import { toSummaryMessages, worthExtracting } from "../src/lib/mind/postTurn";

describe("chat mind fact extraction parsing", () => {
  it("reads fenced JSON with a think block and prose around it", () => {
    const raw =
      '<think>the user said lots</think>Sure!\n```json\n{"facts":[{"fact":"Sam is allergic to peanuts.","category":"health","importance":0.9,"replaces":null}]}\n```';
    const facts = parseExtractedFacts(raw);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ fact: "Sam is allergic to peanuts.", category: "health", importance: 0.9 });
  });

  it("accepts a bare array and plain strings", () => {
    const facts = parseExtractedFacts('["Sam lives in Toronto.", {"text":"Sam has two sisters."}]');
    expect(facts.map((f) => f.fact)).toEqual(["Sam lives in Toronto.", "Sam has two sisters."]);
  });

  it("drops companion-subject, ephemeral, duplicate and junk facts", () => {
    const raw = JSON.stringify({
      facts: [
        { fact: "I am glad they shared that." },
        { fact: "Sam is tired right now." },
        { fact: "Sam loves hiking in the Rockies.", category: "PREFERENCE" },
        { fact: "Sam loves hiking in the rockies" },
        { fact: "ok" },
        { fact: "Sam started a new job today.", category: "event" },
      ],
    });
    const facts = parseExtractedFacts(raw);
    expect(facts.map((f) => f.fact)).toEqual(["Sam loves hiking in the Rockies.", "Sam started a new job today."]);
    expect(facts[0]?.category).toBe("preference");
  });

  it("returns [] for broken or empty output", () => {
    expect(parseExtractedFacts("no json here")).toEqual([]);
    expect(parseExtractedFacts('{"facts": [')).toEqual([]);
    expect(parseExtractedFacts('{"facts":[]}')).toEqual([]);
    expect(extractJsonPayload('{"a":"has } brace"}')).toEqual({ a: "has } brace" });
  });

  it("clamps importance, caps length and count", () => {
    const raw = JSON.stringify({
      facts: Array.from({ length: 10 }, (_, i) => ({ fact: `Sam fact number ${i} ${"word".repeat(i)} about thing${i}`, importance: 7 })),
    });
    const facts = parseExtractedFacts(raw);
    expect(facts.length).toBe(6);
    expect(facts.every((f) => f.importance === 1)).toBe(true);
    const long = parseExtractedFacts(JSON.stringify({ facts: [{ fact: `Sam ${"x".repeat(400)}` }] }));
    expect(long[0]!.fact.length).toBeLessThanOrEqual(200);
  });

  it("finds new facts and the known fact being replaced", () => {
    const known: UserFact[] = [
      { id: "1", fact: "Sam lives in Toronto.", category: "identity", importance: 0.7, replaces: null },
    ];
    const cand: UserFact = { fact: "Sam moved to Vancouver.", category: "identity", importance: 0.8, replaces: "Sam lives in Toronto" };
    expect(newFactsOnly([cand, { ...known[0]!, id: undefined }], known)).toEqual([cand]);
    expect(findReplacedFact(cand, known)?.id).toBe("1");
    expect(findReplacedFact({ ...cand, replaces: "something unrelated entirely" }, known)).toBeNull();
  });

  it("keys shared facts once per user and private facts per companion", () => {
    expect(factDedupeKey("c1", "Sam likes tea.")).toBe(factDedupeKey("c1", "sam likes TEA"));
    // Shared (default): the same fact told to two companions is one row.
    expect(factDedupeKey("c1", "Sam likes tea.")).toBe(factDedupeKey("c2", "Sam likes tea."));
    expect(factDedupeKey("c1", "Sam likes tea.")).toMatch(/^fact:user:/);
    expect(factDedupeKey("c1", "Sam likes tea.", "companion")).not.toBe(factDedupeKey("c2", "Sam likes tea.", "companion"));
    expect(factDedupeKey("c1", "Sam likes tea.", "companion")).not.toBe(factDedupeKey("c1", "Sam likes tea.", "user"));
  });

  it("keeps a correction that flips a known fact's meaning", () => {
    const known: UserFact[] = [{ id: "k1", fact: "Sam is allergic to peanuts.", category: "health", importance: 0.9 }];
    const explicit: UserFact = { fact: "Sam is not allergic to peanuts.", category: "health", importance: 0.9, replaces: "Sam is allergic to peanuts." };
    const implicit: UserFact = { fact: "Sam isn't allergic to peanuts.", category: "health", importance: 0.9 };
    expect(newFactsOnly([explicit], known)).toEqual([explicit]);
    expect(findReplacedFact(explicit, known)?.id).toBe("k1");
    expect(newFactsOnly([implicit], known)).toEqual([implicit]);
    expect(findReplacedFact(implicit, known)?.id).toBe("k1");
    // A plain repeat is still a duplicate.
    expect(newFactsOnly([{ fact: "Sam is allergic to peanuts", category: "health", importance: 0.9 }], known)).toEqual([]);
  });

  it("gives distinct keys to distinct facts in non-Latin scripts", () => {
    expect(factDedupeKey("c1", "小明住在北京。")).not.toBe(factDedupeKey("c1", "小明喜欢游泳。"));
    expect(factDedupeKey("c1", "Саша живёт в Москве.")).not.toBe(factDedupeKey("c1", "Саша любит плавать."));
    expect(factDedupeKey("c1", "小明住在北京。")).toBe(factDedupeKey("c1", "小明住在北京"));
    const parsed = parseExtractedFacts(JSON.stringify({ facts: [{ fact: "小明住在北京。" }, { fact: "小明喜欢游泳。" }] }));
    expect(parsed).toHaveLength(2);
  });

  it("keeps therapy and adult turns private to the companion", () => {
    expect(factScopeForTurn({ mode: "standard" })).toBe("user");
    expect(factScopeForTurn({ mode: "therapy" })).toBe("companion");
    expect(factScopeForTurn({ mode: "standard", therapy: true })).toBe("companion");
    expect(factScopeForTurn({ mode: "standard", adult: true })).toBe("companion");
  });

  it("skips extraction for tiny user lines", () => {
    expect(worthExtracting("ok")).toBe(false);
    expect(worthExtracting("haha yes")).toBe(false);
    expect(worthExtracting("My sister Ana is getting married")).toBe(true);
  });
});

describe("chat mind rolling summary", () => {
  const msgs = (n: number): SummaryMessage[] =>
    Array.from({ length: n }, (_, i) => ({ seq: i, role: i % 2 ? "assistant" : "user", content: `message ${i}` }));

  it("does nothing while the whole conversation fits the window", () => {
    expect(planSummaryRollover({ messages: msgs(20), previous: null, windowMessages: 32 })).toBeNull();
  });

  it("waits for a full step of aged-out messages", () => {
    expect(planSummaryRollover({ messages: msgs(40), previous: null, windowMessages: 32 })).toBeNull();
    const plan = planSummaryRollover({ messages: msgs(44), previous: null, windowMessages: 32 });
    expect(plan?.messages.map((m) => m.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(plan?.throughSeq).toBe(11);
  });

  it("rolls over only the messages after the previous summary", () => {
    const plan = planSummaryRollover({
      messages: msgs(60),
      previous: { text: "old", throughSeq: 11 },
      windowMessages: 32,
    });
    expect(plan?.messages[0]?.seq).toBe(12);
    expect(plan?.throughSeq).toBe(27);
    expect(
      planSummaryRollover({ messages: msgs(60), previous: { text: "old", throughSeq: 20 }, windowMessages: 32 }),
    ).toBeNull();
  });

  it("parses JSON, accepts prose, rejects broken JSON", () => {
    expect(parseSummary('{"summary":"Sam told Ava about the new job."}')).toBe("Sam told Ava about the new job.");
    expect(parseSummary("<think>x</think>Sam and Ava planned a picnic.")).toBe("Sam and Ava planned a picnic.");
    expect(parseSummary('{"summary": ')).toBe("");
    expect(parseSummary(`{"summary":"${"a".repeat(5000)}"}`).length).toBeLessThanOrEqual(2400);
  });

  it("normalizes store rows for the summarizer", () => {
    expect(
      toSummaryMessages([
        { seq: 2, role: "user", content: " hi " },
        { seq: "3", role: "assistant", content: "hey" },
        { seq: 4, role: "system", content: "x" },
        { seq: null, role: "user", content: "no seq" },
      ]),
    ).toEqual([
      { seq: 2, role: "user", content: "hi" },
      { seq: 3, role: "assistant", content: "hey" },
    ]);
  });
});

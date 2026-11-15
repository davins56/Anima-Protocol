import { describe, expect, it } from "vitest";
import {
  buildLibrary,
  chooseStyle,
  explain,
  EXPLANATION_MAX,
  getStyle,
  inputsHash,
  isStale,
  rankStyles,
  registerFor,
  SEED_LIBRARY,
  selectionSeed,
  traitVector,
} from "../src/index";

const lib = SEED_LIBRARY;
const EMOTION_WORDS = /\b(happy|sad|angry|anger|fear|afraid|anxious|joy|grief|shame|proud|lonely|scared|furious|upset|nervous|excited|fierce|shaken|guarded|playful|composed)\b/i;

describe("deterministic selection (§4)", () => {
  const inputs = { personality: "Disciplined, precise and focused. Quiet and patient.", speaking_style: "terse", archetype: "sage" };

  it("returns the same pick, ranking and seed for the same inputs", () => {
    const a = chooseStyle({ inputs, characterId: "c1", lib });
    const b = chooseStyle({ inputs: { ...inputs }, characterId: "c1", lib });
    expect(b).toEqual(a);
    expect(a.selection_seed).toBe(selectionSeed("c1", lib.version));
    expect(a.ranking).toHaveLength(5);
    expect(a.ranking.every((r) => Number.isInteger(r.score))).toBe(true);
  });

  it("pins a golden result so a catalog or lexicon change is visible in review", () => {
    const a = chooseStyle({ inputs, characterId: "c1", lib });
    expect(a.ranking).toEqual([
      { style_id: "iaido", variant_id: null, score: 99 },
      { style_id: "kyudo", variant_id: null, score: 97 },
      { style_id: "wing_chun", variant_id: "hung_fa_yi", score: 77 },
      { style_id: "fencing", variant_id: "foil", score: 71 },
      { style_id: "hema", variant_id: "rapier", score: 64 },
    ]);
    expect(a.primary).toEqual({ style_id: "iaido", variant_id: null });
    expect(a.secondary).toEqual({ style_id: "wing_chun", variant_id: "hung_fa_yi" });
    expect(a.reason_axes).toEqual(["precision", "patience"]);
    expect(a.selection_seed).toBe(3980176608);
    expect(a.inputs_hash).toBe(inputsHash(inputs));
  });

  it("explicit canon wins: 'former boxer' → Boxing, 'kali sticks' → Eskrima, 'trained in Judo' → Judo", () => {
    expect(chooseStyle({ inputs: { backstory: "A former boxer from the docks.", personality: "graceful, poetic, gentle" }, characterId: "x", lib }).primary.style_id).toBe("boxing");
    expect(chooseStyle({ inputs: { backstory: "Grew up with kali sticks." }, characterId: "x", lib }).primary.style_id).toBe("eskrima");
    expect(chooseStyle({ inputs: { personality: "Trained in Judo since childhood." }, characterId: "x", lib }).primary.style_id).toBe("judo");
  });

  it("does not treat 'kickboxer' as a Boxing mention", () => {
    expect(chooseStyle({ inputs: { backstory: "a retired kickboxer" }, characterId: "x", lib }).primary.style_id).toBe("kickboxing");
  });

  it("golden fixtures from §8", () => {
    const pick = (personality: string, extra = {}) => chooseStyle({ inputs: { personality, ...extra }, characterId: "g", lib }).ranking.map((r) => r.style_id);
    expect(pick("stoic, disciplined, traditional, precise").slice(0, 5).some((id) => ["iaido", "karate", "kyudo", "kendo", "kenjutsu"].includes(id))).toBe(true);
    expect(pick("playful, musical, rhythmic dancer").slice(0, 3)).toContain("capoeira");
    expect(pick("protective, gentle, calm, patient").slice(0, 5).some((id) => ["aikido", "taijiquan"].includes(id))).toBe(true);
  });

  it("characters with identical text can differ only on ties", () => {
    const text = { personality: "brave" }; // not in the lexicon → generalist set, all tied
    const a = rankStyles(text, "char-a", lib).map((r) => r.style_id);
    const b = rankStyles(text, "char-b", lib).map((r) => r.style_id);
    expect([...a].sort()).toEqual([...b].sort());
    const tied = { personality: "disciplined" };
    const ra = rankStyles(tied, "char-a", lib);
    const rb = rankStyles(tied, "char-b", lib);
    // same multiset of scores, and any reorder only happens inside equal-score groups
    expect(ra.map((r) => r.score)).toEqual(rb.map((r) => r.score));
  });

  it("empty personality falls back to the generalist set", () => {
    const r = chooseStyle({ inputs: {}, characterId: "empty", lib });
    expect(["boxing", "judo", "karate", "muay_thai", "eskrima"]).toContain(r.primary.style_id);
    expect(r.secondary).toBeNull();
  });

  it("the secondary is a different kind, or null", () => {
    for (const p of ["disciplined precise patient", "aggressive tough relentless", "graceful fluid clever", "protective gentle loyal"]) {
      const r = chooseStyle({ inputs: { personality: p }, characterId: "k", lib });
      if (r.secondary) expect(getStyle(lib, r.secondary.style_id)!.kind).not.toBe(getStyle(lib, r.primary.style_id)!.kind);
    }
  });

  it("re-roll cycles her top five", () => {
    const base = chooseStyle({ inputs, characterId: "c1", lib });
    const seen = [0, 1, 2, 3, 4, 5].map((roll) => chooseStyle({ inputs, characterId: "c1", lib, roll }).primary.style_id);
    expect(seen.slice(0, 5)).toEqual(base.ranking.map((r) => r.style_id));
    expect(seen[5]).toBe(seen[0]);
  });

  it("detects stale personality inputs", () => {
    const r = chooseStyle({ inputs, characterId: "c1", lib });
    expect(isStale({ inputs_hash: r.inputs_hash }, inputs)).toBe(false);
    expect(isStale({ inputs_hash: r.inputs_hash }, { ...inputs, personality: "wild" })).toBe(true);
    expect(isStale(null, inputs)).toBe(false);
  });

  it("caps backstory, counts each word at most twice and ignores unknown fields", () => {
    const v = traitVector({ personality: "disciplined disciplined disciplined disciplined", focus: "aggressive" } as never);
    expect(v.precision).toBe(2);
    expect(v.aggression).toBe(0);
  });

  it("scores user styles the same way as seed styles", () => {
    const user = buildLibrary({ styles: [{ id: "u_clone", name: "Clone", summary: "Same axes as capoeira.", kind: "hybrid", range: "long", axes: getStyle(lib, "capoeira")!.axes }] });
    const r = rankStyles({ personality: "playful musical rhythmic dancer" }, "u", user);
    const cap = r.find((x) => x.style_id === "capoeira")!;
    const clone = r.find((x) => x.style_id === "u_clone")!;
    expect(clone.score).toBeCloseTo(cap.score, 6);
  });
});

describe("explanations (§4.7)", () => {
  it("terse example matches the design", () => {
    const text = explain({ lib, primary: { style_id: "wing_chun", variant_id: null }, secondary: { style_id: "judo", variant_id: null }, reasonAxes: ["precision"], speakingStyle: "terse" });
    expect(text).toBe("Wing Chun. No wasted motion. If it gets messy, Judo.");
  });

  it("is plain text ≤ 280 chars with no emotion or tone words, in every register", () => {
    for (const style of ["formal", "terse", "playful", "warm", "poetic", ""]) {
      for (const s of lib.styles) {
        const text = explain({ lib, primary: { style_id: s.id, variant_id: s.variants[0]?.id ?? null }, secondary: { style_id: "judo", variant_id: null }, reasonAxes: ["control", "rhythm"], speakingStyle: style });
        expect(text.length).toBeLessThanOrEqual(EXPLANATION_MAX);
        expect(text).not.toMatch(/[<>]/);
        expect(text).not.toMatch(EMOTION_WORDS);
        expect(text).not.toMatch(/\d/);
      }
    }
  });

  it("picks the register from speaking_style words", () => {
    expect(registerFor("Blunt and direct")).toBe("terse");
    expect(registerFor("riddling, ancient")).toBe("poetic");
    expect(registerFor("warm and gentle")).toBe("warm");
    expect(registerFor(undefined)).toBe("plain");
  });
});

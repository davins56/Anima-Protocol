import { describe, expect, it } from "vitest";
import {
  EMPTY_CUE_STATE,
  REUNION_ANNOUNCEMENT,
  SINCE_LAST_BUCKETS,
  UNDERTONE_KINDS,
  canonicalAffectId,
  cueExplanation,
  cuePhrase,
  cueReducer,
  cueVisual,
  emotionsEnabledFromContext,
  isReunionCue,
  listenerCuesForCast,
  provisionalCueFromFrame,
  sanitizeAffectCue,
  shownCue,
} from "./emotionCues";
import { COMPANION_PRIMARY_EMOTIONS_FOR_TEST, FLAG_ON_DIMS, FLAG_ON_SNAPSHOT } from "./emotionCues.fixtures";

const dims = FLAG_ON_DIMS;

describe("emotionsEnabledFromContext", () => {
  it("is true only for an explicit true", () => {
    expect(emotionsEnabledFromContext({ emotions_enabled: true })).toBe(true);
    expect(emotionsEnabledFromContext({ emotions_enabled: "true" })).toBe(false);
    expect(emotionsEnabledFromContext({})).toBe(false);
    expect(emotionsEnabledFromContext(null)).toBe(false);
  });
});

describe("sanitizeAffectCue (allowlist)", () => {
  it("keeps only dims, undertone kind/intensity, expressed and since_last", () => {
    const cue = sanitizeAffectCue({
      ...FLAG_ON_SNAPSHOT,
      focus: "the archive",
      intent: "withdraw",
      openLoops: ["her brother"],
      undertone: { kind: "longing", intensity: 34, cause: "absence", note: "secret" },
      since_last: { bucket: "overnight", first_turn: true, at: "2026-11-14T22:00:00Z" },
    });
    expect(cue).toEqual({
      dims,
      undertone: { kind: "longing", intensity: 34 },
      expressed: true,
      since_last: { bucket: "overnight", first_turn: true },
    });
    expect(JSON.stringify(cue)).not.toMatch(/archive|withdraw|brother|secret|absence|2026/);
  });

  it("drops unknown enums, bad numbers and malformed dims", () => {
    const cue = sanitizeAffectCue({
      dims: { ...dims, arousal: Number.NaN },
      undertone: { kind: "rage", intensity: 50 },
      since_last: { bucket: "fortnight" },
      expressed: "yes",
    });
    expect(cue).toBeNull();
    expect(sanitizeAffectCue({ dims: { ...dims, valence: 9 } }).dims.valence).toBe(1);
    expect(sanitizeAffectCue({ undertone: { kind: "hurt", intensity: Infinity } })).toBeNull();
  });

  it("returns null for a flag-off snapshot (no cue fields)", () => {
    expect(sanitizeAffectCue({ primary: "happy", intensity: 40, focus: "steward", intent: "play" })).toBeNull();
  });
});

describe("phrase table", () => {
  const banned = [...COMPANION_PRIMARY_EMOTIONS_FOR_TEST, "intensity", "energy"];
  it("never contains labels, numbers or times", () => {
    const lines = [];
    for (const kind of [null, ...UNDERTONE_KINDS]) {
      for (const bucket of [null, ...SINCE_LAST_BUCKETS]) {
        for (const expressed of [true, false]) {
          for (const first of [true, false]) {
            const cue = {
              dims,
              expressed,
              undertone: kind ? { kind, intensity: 40 } : null,
              since_last: bucket ? { bucket, first_turn: first } : null,
            };
            lines.push(cuePhrase(cue, "Scarlet"), ...cueExplanation(cue, "Scarlet"));
          }
        }
      }
    }
    lines.push(REUNION_ANNOUNCEMENT);
    for (const line of lines) {
      expect(line).not.toMatch(/\d/);
      for (const word of banned) expect(line.toLowerCase()).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it("reads naturally", () => {
    expect(cuePhrase({ dims, expressed: false, undertone: null, since_last: null }, "Scarlet")).toBe(
      "Scarlet seems settled",
    );
    expect(cuePhrase({ dims, expressed: false, undertone: { kind: "hurt", intensity: 30 }, since_last: null }, "Aeland")).toBe(
      "Aeland seems a little guarded",
    );
    expect(cuePhrase(sanitizeAffectCue(FLAG_ON_SNAPSHOT), "Serenity")).toBe("Serenity seems to have missed you");
  });
});

describe("reunion", () => {
  it("only for a first turn after an overnight-or-longer gap", () => {
    expect(isReunionCue({ since_last: { bucket: "days", first_turn: true } })).toBe(true);
    expect(isReunionCue({ since_last: { bucket: "days", first_turn: false } })).toBe(false);
    expect(isReunionCue({ since_last: { bucket: "hours", first_turn: true } })).toBe(false);
    expect(isReunionCue({ since_last: null })).toBe(false);
  });
});

describe("cueVisual", () => {
  it("is finite with and without dims", () => {
    for (const v of [cueVisual(null), cueVisual(sanitizeAffectCue(FLAG_ON_SNAPSHOT))]) {
      expect(v.color).toMatch(/^hsl\(/);
      for (const n of [v.glowPx, v.opacity, v.breathSeconds, v.undertoneOpacity]) expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe("cast, speaker and aspects", () => {
  it("listener_affect only for cast members, never the speaker", () => {
    const cues = listenerCuesForCast(
      { natasha: FLAG_ON_SNAPSHOT, scarlet: FLAG_ON_SNAPSHOT, stranger: FLAG_ON_SNAPSHOT, "aspect:shadow": FLAG_ON_SNAPSHOT },
      { castIds: ["natasha", "scarlet"], speakerId: "scarlet" },
    );
    expect(Object.keys(cues)).toEqual(["natasha"]);
    expect(listenerCuesForCast(null, { castIds: ["a"] })).toEqual({});
  });

  it("aspects share the Anima's canonical id", () => {
    expect(canonicalAffectId("aspect:shadow", { soloCharacterId: "anima-1" })).toBe("anima-1");
    expect(canonicalAffectId("aspect:angel", { soloCharacterId: "anima-1" })).toBe("anima-1");
    expect(canonicalAffectId("aspect:shadow")).toBeNull();
    expect(canonicalAffectId("scarlet")).toBe("scarlet");
  });

  it("provisional frames resolve aspects to the canonical id and ignore non-cast", () => {
    const frame = { character_id: "aspect:shadow", snapshot: FLAG_ON_SNAPSHOT, provisional: true };
    expect(provisionalCueFromFrame(frame, { castIds: ["anima-1"], soloCharacterId: "anima-1" }).id).toBe("anima-1");
    expect(provisionalCueFromFrame({ ...frame, provisional: false }, { castIds: ["anima-1"], soloCharacterId: "anima-1" })).toBeNull();
    expect(provisionalCueFromFrame({ ...frame, character_id: "other" }, { castIds: ["anima-1"] })).toBeNull();
  });
});

describe("cueReducer: provisional tint vs committed", () => {
  const committed = sanitizeAffectCue({ ...FLAG_ON_SNAPSHOT, expressed: false, undertone: null });
  const tint = sanitizeAffectCue(FLAG_ON_SNAPSHOT);
  const done = sanitizeAffectCue({ ...FLAG_ON_SNAPSHOT, undertone: { kind: "glow", intensity: 20 } });

  it("tints, then done replaces the tint", () => {
    let s = cueReducer(EMPTY_CUE_STATE, { type: "commit", cues: { a: committed } });
    s = cueReducer(s, { type: "provisional", id: "a", cue: tint });
    expect(shownCue(s, "a")).toBe(tint);
    expect(s.committed.a).toBe(committed);
    s = cueReducer(s, { type: "commit", cues: { a: done } });
    expect(shownCue(s, "a")).toBe(done);
    expect(s.provisional).toEqual({});
  });

  it("revert on error/abort/retry restores the last committed cue", () => {
    let s = cueReducer(EMPTY_CUE_STATE, { type: "commit", cues: { a: committed } });
    s = cueReducer(s, { type: "provisional", id: "a", cue: tint });
    s = cueReducer(s, { type: "revert" });
    expect(shownCue(s, "a")).toBe(committed);
    expect(cueReducer(s, { type: "revert" })).toBe(s);
    expect(cueReducer(s, { type: "reset" })).toEqual(EMPTY_CUE_STATE);
  });

  it("a provisional cue is never in the committed map", () => {
    const s = cueReducer(EMPTY_CUE_STATE, { type: "provisional", id: "b", cue: tint });
    expect(s.committed).toEqual({});
    expect(shownCue(cueReducer(s, { type: "revert" }), "b")).toBeNull();
  });
});

describe("cueExplanation without a snapshot", () => {
  it("falls back to the settled sentence instead of nothing", () => {
    expect(cueExplanation(null, "Scarlet")).toEqual(["Scarlet seems settled."]);
  });
});

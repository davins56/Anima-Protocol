import { describe, expect, it } from "vitest";
import { explainCompanionAffect, parseCompanionAffectSnapshot } from "./companionAffect";
import { FLAG_ON_SNAPSHOT } from "./emotionCues.fixtures";

describe("companionAffect with ANIMA_EMOTIONS (#765)", () => {
  it("flag on: focus/intent stay absent (no defaults) and the cue is attached", () => {
    const snap = parseCompanionAffectSnapshot(FLAG_ON_SNAPSHOT, { emotionsEnabled: true });
    expect(snap).not.toHaveProperty("focus");
    expect(snap).not.toHaveProperty("intent");
    expect(snap.cue).toEqual({
      dims: FLAG_ON_SNAPSHOT.dims,
      undertone: { kind: "longing", intensity: 34 },
      expressed: true,
      since_last: { bucket: "overnight", first_turn: true },
    });
  });

  it("flag on: the why lines skip focus and intent", () => {
    const snap = parseCompanionAffectSnapshot(
      { ...FLAG_ON_SNAPSHOT, focus: "the archive", intent: "withdraw" },
      { emotionsEnabled: true },
    );
    const lines = explainCompanionAffect(snap, "Aeland", Date.now(), { emotionsEnabled: true }).join(" ");
    expect(lines).not.toMatch(/attention is on|wants to|archive|distance/);
  });

  it("flag off: parse and explain are unchanged", () => {
    const raw = { primary: "tender", intensity: 58, energy: 44, mood: "tender-aching", updated_at: "" };
    const snap = parseCompanionAffectSnapshot(raw);
    expect(snap).toEqual({
      version: 1,
      primary: "tender",
      intensity: 58,
      mood: "tender-aching",
      energy: 44,
      focus: "steward",
      intent: "attend",
      updated_at: "",
      synchro_strength: null,
      baseline_primary: "neutral",
      baseline_energy: 48,
    });
    expect(snap).not.toHaveProperty("cue");
    const lines = explainCompanionAffect(snap, "Aeland");
    expect(lines).toContain("Right now she wants to pay close attention to you.");
    expect(lines).toContain("Her attention is on you and what you just said.");
  });

  it("an older client receiving a sanitized snapshot falls back to its defaults without crashing", () => {
    // Older clients call parse with no options, exactly as main does today.
    const snap = parseCompanionAffectSnapshot(FLAG_ON_SNAPSHOT);
    expect(snap.focus).toBe("steward");
    expect(snap.intent).toBe("attend");
    expect(snap).not.toHaveProperty("cue");
    expect(snap).not.toHaveProperty("dims");
    const lines = explainCompanionAffect(snap, "Scarlet");
    expect(lines[0]).toMatch(/^Scarlet feels/);
    expect(lines.join(" ")).toContain("Her attention is on you");
  });
});

import { describe, expect, it } from "vitest";
import { buildSessionRecapExport, normalizeSessionRecap } from "@/lib/sessionRecap";

const NOW = new Date("2026-11-14T05:13:00Z");

const SERVER_RESULT = {
  data: {
    generated: true,
    title: "Rooftop Confessions",
    summary: "Natasha and the user talked through the mission fallout on the roof.",
    key_moments: ["She admits it went wrong", "They agree to train together"],
    characters_involved: ["Natasha Romanoff"],
    emotional_arc: "Guarded, then candid, ending warm.",
    journal_entry: "The walls came down a little.",
    reflections: ["Ask about Budapest"],
    message_count: 101,
  },
};

describe("normalizeSessionRecap", () => {
  it("reads the server's { data: {...} } shape", () => {
    const recap = normalizeSessionRecap(SERVER_RESULT, { title: "Chat" }, NOW);
    expect(recap.generated).toBe(true);
    expect(recap.summary).toBe(SERVER_RESULT.data.summary);
    expect(recap.emotionalArc).toBe("Guarded, then candid, ending warm.");
    expect(recap.keyMoments).toHaveLength(2);
    expect(recap.messageCount).toBe(101);
    expect(recap.title).toBe("Rooftop Confessions");
  });

  it("never shows the old placeholder text", () => {
    for (const result of [null, "a bare string", { data: { generated: false, error: "Model down." } }]) {
      const recap = normalizeSessionRecap(result, { title: "Chat", messages: [1, 2, 3] }, NOW);
      expect(recap.generated).toBe(false);
      expect(recap.summary).toBe("");
      expect(recap.emotionalArc).toBe("");
      expect(JSON.stringify(recap)).not.toMatch(/narrative journey unfolds|Undefined/);
      expect(recap.error).toBeTruthy();
      expect(recap.messageCount).toBe(3);
    }
  });
});

describe("buildSessionRecapExport", () => {
  it("carries exactly the recap the modal shows", () => {
    const recap = normalizeSessionRecap(SERVER_RESULT, null, NOW);
    const text = buildSessionRecapExport(recap);
    expect(text).toContain(recap.summary);
    expect(text).toContain("EMOTIONAL ARC\n───────────────────────────────────────────────────────────────\nGuarded, then candid, ending warm.");
    expect(text).toContain("1. She admits it went wrong");
    expect(text).toContain("The walls came down a little.");
    expect(text).toContain("- Ask about Budapest");
    expect(text).toContain("Messages: 101");
    expect(text).not.toMatch(/Undefined|narrative journey unfolds|\[object Object\]/);
  });

  it("exports the failure honestly", () => {
    const recap = normalizeSessionRecap({ data: { generated: false, error: "Model down." } }, null, NOW);
    const text = buildSessionRecapExport(recap);
    expect(text).toContain("RECAP UNAVAILABLE");
    expect(text).toContain("Model down.");
    expect(text).not.toContain("SUMMARY");
  });
});

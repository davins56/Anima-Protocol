import { describe, expect, it } from "vitest";
import {
  IN_WORLD_IMMERSION,
  companionStaticPrefix,
  composeCompanionChatMessages,
  messagesForLocalOllama,
  stripOutOfWorldLabels,
} from "../src/lib/promptBuilder";
import { buildCrossoverAwareness } from "../src/lib/voiceAnchors";

const natasha = {
  id: "natasha",
  name: "Natasha Romanoff",
  universe: "Marvel Cinematic Universe",
  personality:
    "Controlled and precise. Natasha reads rooms and rarely explains herself.",
  backstory:
    "His arc through the MCU is not hers. She gave her life at Vormir so Clint could go home.",
  speaking_style: "Economical.",
};

describe("in-world companion prompt", () => {
  const base = {
    characters: [natasha],
    activeCharacter: natasha,
    memories: [],
    recentMessages: [],
    mode: "solo" as const,
  };

  it("puts the immersion rule in the stable prefix and keeps that prefix identical across turns", () => {
    const first = companionStaticPrefix({ ...base, content: "Tell me about Vormir." });
    const second = companionStaticPrefix({
      ...base,
      content: "And what about the stone?",
      companionCrisis: true,
    });
    expect(second).toBe(first);
    expect(first).toContain(IN_WORLD_IMMERSION);
    expect(first).toContain(
      "You are Natasha Romanoff. The user has stepped into your world and is physically here with you.",
    );
    expect(first).not.toMatch(/cinematic universe/i);
    expect(first).not.toMatch(/\bmcu\b/i);
    expect(first).toContain("IDENTITY: Never call yourself an AI");
    expect(first.indexOf("CHARACTER:")).toBeLessThan(first.indexOf("IN WORLD:"));
    expect(first.indexOf("IN WORLD:")).toBeLessThan(first.indexOf("IDENTITY: Never call yourself an AI"));
    expect(first.indexOf("IDENTITY: Never call yourself an AI")).toBeLessThan(
      first.indexOf("HIGHEST-PRIORITY RULE"),
    );

    const calm = messagesForLocalOllama(
      composeCompanionChatMessages({ ...base, content: "Tell me about Vormir." }),
    );
    const next = messagesForLocalOllama(
      composeCompanionChatMessages({ ...base, content: "And what about the stone?" }),
    );
    expect(calm[0]?.role).toBe("system");
    expect(next[0]?.content).toBe(calm[0]?.content);
    expect(calm[0]?.content).toContain(IN_WORLD_IMMERSION);
    expect(String(calm.at(-1)?.content)).not.toContain(IN_WORLD_IMMERSION);
    expect(String(calm.at(-1)?.content)).toContain("Tell me about Vormir.");
  });

  it("rewrites franchise labels in the card and does not name another world's title", () => {
    expect(stripOutOfWorldLabels("In the Marvel Cinematic Universe, Vormir is a place.")).toBe(
      "In this world, Vormir is a place.",
    );
    expect(stripOutOfWorldLabels("in the Marvel Cinematic Universe, the cliff is red.")).toBe(
      "in this world, the cliff is red.",
    );
    expect(stripOutOfWorldLabels("His arc through the MCU is a story.")).toBe(
      "His arc through this life is a story.",
    );
    const prefix = companionStaticPrefix({ ...base, content: "Hello" });
    expect(prefix).toContain("through this life");
    expect(prefix).not.toContain("Marvel Cinematic Universe");

    const awareness = buildCrossoverAwareness(natasha, [
      natasha,
      { id: "steve", name: "Steve Rogers", universe: "Marvel Cinematic Universe" },
    ]);
    expect(awareness).toContain("Steve Rogers");
    expect(awareness).not.toMatch(/cinematic universe/i);
    expect(awareness).not.toContain("from Marvel");
  });
});

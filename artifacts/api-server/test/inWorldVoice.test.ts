import { describe, expect, it } from "vitest";
import { initCompanionAffect } from "../src/lib/companionAffect";
import {
  CONTINUE_USER_TURN,
  FIRSTHAND_NOTE_LABEL,
  IN_WORLD_PRESENCE,
  IN_WORLD_VOICE,
  companionStaticPrefix,
  composeCompanionChatMessages,
  messagesForLocalOllama,
  neutraliseFranchiseWords,
  stripOutOfWorldLabels,
} from "../src/lib/promptBuilder";
import { COMPANION_CRISIS_TURN_LINE } from "../src/lib/therapySafety";
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

const WIKI_LORE = `WORLD STATE & LORE (remember these facts — they are established story canon):
- [place] Vormir: In the MCU, Vormir is a Marvel film location from the Marvel Cinematic Universe franchise, shown in the movies and the comics.`;

const FRANCHISE_WORD =
  /\b(?:marvel cinematic universe|mcu|marvel|films|movies|comics|film|movie|comic|franchise)\b/i;

describe("in-world companion prompt", () => {
  const base = {
    characters: [natasha],
    activeCharacter: natasha,
    memories: [],
    recentMessages: [],
    mode: "solo" as const,
  };

  it("puts the immersion lines in the stable prefix and keeps that prefix identical across turns", () => {
    const first = companionStaticPrefix({ ...base, content: "Tell me about Vormir." });
    const second = companionStaticPrefix({
      ...base,
      content: "And what about the stone?",
      companionCrisis: true,
    });
    expect(second).toBe(first);
    expect(first.startsWith(IN_WORLD_PRESENCE)).toBe(true);
    expect(first).toContain(IN_WORLD_VOICE);
    expect(first).toContain("You are Natasha Romanoff.");
    expect(first).not.toContain("You are Natasha Romanoff from");
    expect(first).not.toContain("The user has stepped into your world");
    expect(first).not.toMatch(/cinematic universe/i);
    expect(first).not.toMatch(/\bmcu\b/i);
    expect(first).toContain("IDENTITY: Never call yourself an AI");
    expect(first.indexOf("You are Natasha Romanoff.")).toBeLessThan(
      first.indexOf("IDENTITY: Never call yourself an AI"),
    );
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
    expect(calm[0]?.content).toContain(IN_WORLD_PRESENCE);
    expect(calm[0]?.content).toContain(IN_WORLD_VOICE);
    expect(String(calm.at(-1)?.content)).toContain("Tell me about Vormir.");
  });

  it("asks an empty continue turn to speak in first person without touching the prefix", () => {
    const spoken = companionStaticPrefix({ ...base, content: "Tell me about Vormir." });
    const empty = companionStaticPrefix({ ...base, content: "" });
    expect(empty).toBe(spoken);
    expect(empty).not.toContain(CONTINUE_USER_TURN);
    const spokenFold = messagesForLocalOllama(
      composeCompanionChatMessages({ ...base, content: "Tell me about Vormir." }),
    );
    const folded = messagesForLocalOllama(
      composeCompanionChatMessages({ ...base, content: "" }),
    );
    expect(String(folded[0]?.content)).toBe(String(spokenFold[0]?.content));
    expect(String(folded[0]?.content)).not.toContain(CONTINUE_USER_TURN);
    const user = String(folded.at(-1)?.content || "");
    expect(user).toContain(CONTINUE_USER_TURN);
    expect(CONTINUE_USER_TURN).toBe("I'm here with you. Go on in your own first person.");
    expect(user).not.toMatch(/continue the scene/i);
    expect(user).not.toMatch(/Continue as /);
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

  it("labels wiki lore as firsthand knowledge and strips franchise words", () => {
    expect(
      neutraliseFranchiseWords(
        "In the MCU, Vormir is a Marvel film location from the Marvel Cinematic Universe franchise, shown in the movies and the comics.",
      ),
    ).not.toMatch(FRANCHISE_WORD);

    const messages = composeCompanionChatMessages({
      ...base,
      content: "Tell me about Vormir",
      clientContext: WIKI_LORE,
      pdfContext:
        "From guide.pdf (lore, p.1):\nIn the films, the MCU calls the cliff a Marvel franchise comic.",
    });
    const folded = messagesForLocalOllama(messages)
      .map((message) => message.content)
      .join("\n");
    const withoutVoiceRule = folded.replace(IN_WORLD_VOICE, "");
    expect(folded).toContain(`[${FIRSTHAND_NOTE_LABEL}:`);
    expect(folded).toContain("Vormir");
    expect(withoutVoiceRule).not.toMatch(FRANCHISE_WORD);
    expect(folded).not.toContain("WORLD STATE & LORE");
    expect(folded).not.toContain("established story canon");
  });

  it("keeps the crisis care line first and mood last when lore is attached", () => {
    const folded = messagesForLocalOllama(
      composeCompanionChatMessages({
        ...base,
        content: "I want to kill myself",
        companionCrisis: true,
        clientContext: WIKI_LORE,
        companionAffect: initCompanionAffect({
          selfState: {
            primary: "tender",
            intensity: 58,
            energy: 44,
            mood: "tender-aching",
            intent: "comfort",
            focus: "steward",
          },
        }),
      }),
    );
    const user = String(folded.at(-1)?.content || "");
    const careAt = user.indexOf(`[${COMPANION_CRISIS_TURN_LINE}]`);
    const loreAt = user.indexOf(`[${FIRSTHAND_NOTE_LABEL}:`);
    const moodAt = user.indexOf("You feel tender-aching");
    const wordsAt = user.lastIndexOf("I want to kill myself");
    expect(careAt).toBe(0);
    expect(loreAt).toBeGreaterThan(careAt);
    expect(moodAt).toBeGreaterThan(loreAt);
    expect(wordsAt).toBeGreaterThan(moodAt);
    expect(user.slice(moodAt, wordsAt)).not.toContain(`[${FIRSTHAND_NOTE_LABEL}:`);
    expect(String(folded[0]?.content)).not.toContain(COMPANION_CRISIS_TURN_LINE);
  });
});

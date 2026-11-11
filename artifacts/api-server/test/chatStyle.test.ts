import { describe, expect, it } from "vitest";
import { creativeFreedomEnabled } from "../src/lib/chatStyle";
import { composeCompanionChatMessages, composePrompt, type PromptBuilderParams } from "../src/lib/promptBuilder";
import { CHAT_MODE_REGISTRY } from "../src/lib/chatModeRegistry";

const character = { id: "c", name: "Ava", personality: "Curious explorer" };
const base: PromptBuilderParams = {
  characters: [character], activeCharacter: character, memories: [], recentMessages: [],
  mode: "solo", content: "Let's explore a haunted city.",
};

describe("creative freedom", () => {
  it("requires an explicit saved boolean and is off in therapy", () => {
    expect(creativeFreedomEnabled({}, false)).toBe(false);
    expect(creativeFreedomEnabled({ creative_freedom_enabled: "true" }, false)).toBe(false);
    expect(creativeFreedomEnabled({ creative_freedom_enabled: true }, false)).toBe(true);
    expect(creativeFreedomEnabled({ creative_freedom_enabled: true }, true)).toBe(false);
  });

  const renderers = {
    legacy: (p: PromptBuilderParams) => composePrompt(p),
    local: (p: PromptBuilderParams) => composeCompanionChatMessages(p).map((m) => m.content).join("\n"),
    hosted: (p: PromptBuilderParams) => composeCompanionChatMessages({
      ...p, mind: { promptTokens: 12000, historyExchanges: 16, minHistoryExchanges: 4, historyMessageChars: 1600, memoryTopK: 8 },
    }).map((m) => m.content).join("\n"),
  };

  for (const [path, render] of Object.entries(renderers)) {
    it(`${path}: applies the saved style without granting adult permissions`, () => {
      const prompt = render({ ...base, uncensoredMode: true });
      expect(prompt).toContain("CREATIVE FREEDOM");
      expect(prompt).toContain("Explicit adult content is not permitted");
      expect(prompt).toContain("HIGHEST-PRIORITY RULE");
      expect(render(base)).not.toContain("CREATIVE FREEDOM");
    });

    it(`${path}: keeps the adult contract when the server grants it`, () => {
      const prompt = render({ ...base, uncensoredMode: true, modePolicy: CHAT_MODE_REGISTRY.adult });
      expect(prompt).toContain("CREATIVE FREEDOM");
      expect(prompt).toContain("Mode: adult");
      expect(prompt).not.toContain("Explicit adult content is not permitted");
    });

    it(`${path}: excludes creative freedom in therapy even for direct prompt callers`, () => {
      expect(render({ ...base, mode: "therapy", modePolicy: CHAT_MODE_REGISTRY.therapy, uncensoredMode: true }))
        .not.toContain("CREATIVE FREEDOM");
    });
  }
});

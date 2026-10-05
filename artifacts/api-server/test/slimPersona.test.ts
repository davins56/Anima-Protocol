import { describe, expect, it } from "vitest";
import { composeCompanionChatMessages, composePrompt } from "../src/lib/promptBuilder";
import { initCompanionAffect } from "../src/lib/companionAffect";

/**
 * qwen2.5:0.5b ignored the user's message (and refused ordinary questions)
 * under the long persona. The shared blocks must stay short and must not
 * grant blanket refusal permission, while loyalty, mood, and lore still
 * reach the prompt.
 */
const character = {
  id: "char-1",
  name: "Serenity",
  personality: "Warm, ethereal, deeply empathic.",
  speaking_style: "Soft, poetic.",
  backstory: "A fallen angel who chose to remain close to humanity.",
  _isAnima: true,
};

const clientLore =
  "WORLD STATE & LORE (remember these facts — they are established story canon):\n- [location] Kitchen: The toaster is in the kitchen.";

function systemText(messages: Array<{ role: string; content: string }>): string {
  return messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n");
}

describe("slim companion persona", () => {
  it("drops refusal permission but keeps loyalty, mood, and lore", () => {
    const companionAffect = initCompanionAffect({
      selfState: {
        primary: "tender",
        intensity: 58,
        energy: 44,
        mood: "tender-aching",
        intent: "comfort",
        focus: "steward",
      },
    });
    const params = {
      characters: [character],
      activeCharacter: character,
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: "How do I get burnt toast smell out?",
      clientContext: clientLore,
      companionAffect,
      conversationalWeather: "lull" as const,
    };
    const prompts = [composePrompt(params), systemText(composeCompanionChatMessages(params))];
    for (const prompt of prompts) {
      expect(prompt).not.toContain("NOT obligated to cooperate");
      expect(prompt).not.toContain("refuse, resist");
      expect(prompt).not.toMatch(/you may refuse/i);
      expect(prompt).toContain("HIGHEST-PRIORITY RULE");
      expect(prompt).toContain("Never turn your intelligence against the real person");
      expect(prompt).toContain("always answer what the user just said");
      expect(prompt).toContain("SELF-STATE");
      expect(prompt).toContain("What you know firsthand:");
      expect(prompt).toContain("The toaster is in the kitchen");
      expect(prompt).toContain("CONVERSATIONAL WEATHER: lull");
    }
  });

  it("caps personality, backstory, and voice near 1,200 chars total", () => {
    const long = (label: string) => `${label} ${"word ".repeat(400)}`.trim();
    const prompt = composePrompt({
      characters: [],
      activeCharacter: {
        ...character,
        personality: long("P"),
        backstory: long("B"),
        speaking_style: long("V"),
      },
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: "Hi",
    });
    const line = (prefix: string) =>
      prompt.split("\n").find((row) => row.startsWith(prefix)) ?? "";
    const personality = line("Personality: ").slice("Personality: ".length);
    const backstory = line("Backstory: ").slice("Backstory: ".length);
    const voice = line("Voice: ").slice("Voice: ".length);
    expect(personality.length).toBeLessThanOrEqual(500);
    expect(backstory.length).toBeLessThanOrEqual(500);
    expect(voice.length).toBeLessThanOrEqual(200);
    expect(personality.length + backstory.length + voice.length).toBeLessThanOrEqual(1200);
  });
});

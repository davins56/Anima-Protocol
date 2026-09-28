import { afterEach, describe, expect, it } from "vitest";
import { composeCompanionChatMessages } from "../src/lib/promptBuilder";
import { isLocalOnlyProviderChain } from "../src/lib/llmFailover";

/**
 * detectLoreKeywords and scanAndLinkLoreKeywords only highlight transcript
 * words. Companion lore is the WorldState block Chat.jsx puts in client
 * context via buildLoreContext. Local-only mode must keep that line.
 */
const ENV_KEYS = [
  "ANIMA_LOCAL_LLM_BASE_URL",
  "ANIMA_LOCAL_LLM_FALLBACK",
  "OPENROUTER_API_KEY",
  "ANIMA_OPENROUTER_API_KEY",
  "OPEN_ROUTER_API_KEY",
  "ANIMA_RUNTIME",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const loreLine =
  "- [location] Budapest safehouse: The Budapest safehouse key is under the third stair.";

const clientLore = `WORLD STATE & LORE (remember these facts — they are established story canon):\n${loreLine}`;

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = savedEnv[key];
    if (previous == null) delete process.env[key];
    else process.env[key] = previous;
  }
});

describe("local-only companion lore", () => {
  it("keeps a mentioned lore line in the composed system prompt", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://127.0.0.1:11434/v1";
    delete process.env.ANIMA_LOCAL_LLM_FALLBACK;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_API_KEY;
    delete process.env.OPEN_ROUTER_API_KEY;
    delete process.env.ANIMA_RUNTIME;

    expect(isLocalOnlyProviderChain()).toBe(true);

    const natasha = {
      id: "natasha",
      name: "Natasha Romanoff",
      personality: "Controlled, observant, and fiercely pragmatic.",
      backstory: "Former Black Widow. She does not announce her own history.",
      speaking_style: "Economical and precise.",
    };
    const messages = composeCompanionChatMessages({
      characters: [natasha],
      activeCharacter: natasha,
      memories: [],
      recentMessages: [],
      mode: "solo",
      content: "Do you still have the Budapest safehouse key?",
      clientContext: clientLore,
    });
    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");

    expect(system).toContain("Budapest safehouse key is under the third stair");
    expect(system).toContain("WORLD STATE & LORE");
    expect(messages.at(-1)?.content).toContain("Budapest safehouse key");
  });
});

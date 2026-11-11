import { describe, expect, it } from "vitest";
import {
  composeCompanionChatMessages,
  mindHistoryTail,
  trimOldestExchange,
  type LlmChatMessage,
  type MindPromptOptions,
} from "../src/lib/promptBuilder";
import { workersAiSamplingOptions } from "../src/lib/workersAi";
import { openRouterSamplingFields } from "../src/lib/llmFailover";

const ava = {
  id: "ava",
  name: "Ava",
  personality: `Warm, curious, teasing. ${"She notices small things and remembers them. ".repeat(30)}PERSONA_TAIL_MARK`,
  backstory: "Grew up by the sea. Paints at night.",
  speaking_style: "Short, playful sentences.",
};

const mind: MindPromptOptions = {
  promptTokens: 12000,
  historyExchanges: 16,
  minHistoryExchanges: 4,
  historyMessageChars: 1600,
  memoryTopK: 8,
};

const history = (exchanges: number, chars = 120) =>
  Array.from({ length: exchanges * 2 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    seq: i,
    content: `${i % 2 === 0 ? "U" : "A"}${Math.floor(i / 2)} ${"talking about the garden and the sea ".repeat(Math.ceil(chars / 36))}`.slice(0, chars),
    character_name: i % 2 === 0 ? undefined : "Ava",
  }));

const base = {
  characters: [ava],
  activeCharacter: ava,
  memories: [],
  mode: "solo",
};

const text = (m: LlmChatMessage[]) => m.map((x) => x.content).join("\n");

describe("chat mind prompt budget", () => {
  it("replays 16 exchanges verbatim and keeps long messages whole", () => {
    const longReply = `LONG_START ${"word ".repeat(250)}LONG_END`;
    const recent = [...history(20), { role: "assistant", seq: 40, content: longReply, character_name: "Ava" }];
    const legacy = composeCompanionChatMessages({ ...base, recentMessages: recent, content: "hi" } as never);
    const minded = composeCompanionChatMessages({ ...base, recentMessages: recent, content: "hi", mind } as never);
    const users = (m: LlmChatMessage[]) => m.filter((x) => x.role === "user").length;
    expect(users(minded)).toBeGreaterThan(users(legacy));
    expect(users(minded) - 1).toBe(16); // 16 replayed + the current turn
    expect(text(minded)).toContain("LONG_END");
    expect(text(legacy)).not.toContain("LONG_END");
  });

  it("keeps the full persona on hosted models", () => {
    const legacy = composeCompanionChatMessages({ ...base, recentMessages: [], content: "hi" } as never);
    const minded = composeCompanionChatMessages({ ...base, recentMessages: [], content: "hi", mind } as never);
    expect(text(legacy)).not.toContain("PERSONA_TAIL_MARK");
    expect(text(minded)).toContain("PERSONA_TAIL_MARK");
  });

  it("trims the oldest exchanges first, keeps memory, and never drops below the floor", () => {
    const small: MindPromptOptions = { ...mind, promptTokens: 3400 };
    const messages = composeCompanionChatMessages({
      ...base,
      recentMessages: history(16, 900),
      memoryCoreContext: "MEMORY — use naturally\nWhat you know about them:\n- MIND_FACT_MARK Sam has a dog named Biscuit.",
      content: "how are you?",
      mind: small,
    } as never);
    const users = messages.filter((m) => m.role === "user").length - 1;
    expect(users).toBeGreaterThanOrEqual(4);
    expect(users).toBeLessThan(16);
    expect(text(messages)).toContain("MIND_FACT_MARK");
    // The newest exchange always survives.
    expect(text(messages)).toContain("U15 ");
  });

  it("adds the anti-repetition note to the closing instruction only with the mind", () => {
    const note = 'Keep it fresh: do not reuse your recent openings ("Oh, Sam…").';
    const minded = composeCompanionChatMessages({ ...base, recentMessages: [], content: "hi", mind, mindTurnNote: note } as never);
    const legacy = composeCompanionChatMessages({ ...base, recentMessages: [], content: "hi", mindTurnNote: note } as never);
    expect(minded.at(-2)?.role).toBe("system");
    expect(minded.at(-2)?.content).toContain(note);
    expect(text(legacy)).not.toContain(note);
  });

  it("history helpers slide and trim by whole exchanges", () => {
    const h: LlmChatMessage[] = [
      { role: "assistant", content: "greeting" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ];
    expect(mindHistoryTail(h, 2).map((m) => m.content)).toEqual(["u2", "a2", "u3", "a3"]);
    expect(trimOldestExchange(h, 1).map((m) => m.content)).toEqual(["u2", "a2", "u3", "a3"]);
    expect(trimOldestExchange(h, 3)).toBe(h);
  });
});

describe("chat mind sampling passthrough", () => {
  it("passes only in-range sampling knobs to Workers AI", () => {
    expect(
      workersAiSamplingOptions({ top_p: 0.9, top_k: 40.4, repetition_penalty: 1.05, frequency_penalty: 9, presence_penalty: Number.NaN }),
    ).toEqual({ top_p: 0.9, top_k: 40, repetition_penalty: 1.05 });
    expect(workersAiSamplingOptions(null)).toEqual({});
  });

  it("leaves legacy OpenRouter requests untouched and adds temperature with the mind", () => {
    expect(openRouterSamplingFields({ temperature: 0.65 })).toEqual({});
    expect(openRouterSamplingFields({ temperature: 0.8, sampling: { top_p: 0.9 } })).toEqual({ temperature: 0.8, top_p: 0.9 });
  });
});

import { describe, expect, it } from "vitest";
import {
  LLM_CHAT_HISTORY_MAX_CHARS,
  LLM_CHAT_HISTORY_MAX_MESSAGES,
  LOCAL_HISTORY_MAX_EXCHANGES,
  LOCAL_PROMPT_MAX_TOKENS,
  OLLAMA_N_CTX,
  llmChatHistoryMaxChars,
  llmChatHistoryMaxMessages,
  localPromptContextWindow,
  localPromptHardMaxTokens,
  localPromptTokenBudget,
  localPromptWorkingMaxTokens,
  localHistoryMaxExchanges,
  stableHistoryExchangeCount,
} from "../src/lib/promptBuilder";

describe("prompt budget env overrides", () => {
  it("keeps today's defaults when nothing is set", () => {
    const env = {};
    expect(localPromptContextWindow(env)).toBe(OLLAMA_N_CTX);
    expect(localPromptWorkingMaxTokens(env)).toBe(LOCAL_PROMPT_MAX_TOKENS);
    expect(llmChatHistoryMaxMessages(env)).toBe(LLM_CHAT_HISTORY_MAX_MESSAGES);
    expect(llmChatHistoryMaxChars(env)).toBe(LLM_CHAT_HISTORY_MAX_CHARS);
  });

  it("budgets against the same num_ctx Ollama is given", () => {
    const small = localPromptHardMaxTokens(512, {});
    const big = localPromptHardMaxTokens(512, { ANIMA_OLLAMA_NUM_CTX: "16384" });
    expect(big - small).toBe(16384 - OLLAMA_N_CTX);
  });

  it("raises the working budget only when asked, and never past the window", () => {
    expect(localPromptTokenBudget(512, { ANIMA_LOCAL_PROMPT_MAX_TOKENS: "4000" })).toBe(4000);
    expect(
      localPromptTokenBudget(512, {
        ANIMA_LOCAL_PROMPT_MAX_TOKENS: "50000",
        ANIMA_OLLAMA_NUM_CTX: "8192",
      }),
    ).toBe(localPromptHardMaxTokens(512, { ANIMA_OLLAMA_NUM_CTX: "8192" }));
  });

  it("ignores junk and too-small values", () => {
    expect(localPromptContextWindow({ ANIMA_OLLAMA_NUM_CTX: "abc" })).toBe(OLLAMA_N_CTX);
    expect(localPromptContextWindow({ ANIMA_OLLAMA_NUM_CTX: "100" })).toBe(OLLAMA_N_CTX);
    expect(llmChatHistoryMaxChars({ ANIMA_CHAT_HISTORY_MAX_CHARS: "10" })).toBe(
      LLM_CHAT_HISTORY_MAX_CHARS,
    );
    expect(localHistoryMaxExchanges({ ANIMA_CHAT_HISTORY_MAX_EXCHANGES: "1" })).toBe(
      LOCAL_HISTORY_MAX_EXCHANGES,
    );
  });

  it("ANIMA_CHAT_HISTORY_MAX_EXCHANGES widens the companion window and the plain cap", () => {
    const env = { ANIMA_CHAT_HISTORY_MAX_EXCHANGES: "10" };
    expect(localHistoryMaxExchanges({})).toBe(LOCAL_HISTORY_MAX_EXCHANGES);
    expect(stableHistoryExchangeCount(9, {})).toBeLessThan(9);
    expect(stableHistoryExchangeCount(9, env)).toBe(9);
    expect(stableHistoryExchangeCount(10, env)).toBe(10);
    // Past the ceiling it still cuts back in a block, not a slide.
    expect(stableHistoryExchangeCount(11, env)).toBe(2);
    expect(llmChatHistoryMaxMessages(env)).toBe(20);
  });
});

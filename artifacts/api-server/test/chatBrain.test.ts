import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAiBindingForTests, setAiBinding } from "../src/lib/aiBinding";
import {
  chatBrainMode,
  hasLocalLlm,
  isCloudflareChatBrain,
  localLlmBaseUrl,
  summarizeLocalLlmBaseUrl,
} from "../src/lib/openaiClient";
import {
  cloudflareBrainBackgroundEnabled,
  createChatCompletionWithFailover,
  getLlmRoutingStatus,
  getProviderChain,
  localOnlyProviderChain,
} from "../src/lib/llmFailover";
import {
  WORKERS_AI_BACKGROUND_MODEL,
  WORKERS_AI_CHAT_MODEL,
  completeWorkersAi,
  workersAiBackgroundModel,
  workersAiChatModel,
  workersAiLora,
} from "../src/lib/workersAi";

const KEYS = [
  "ANIMA_CHAT_BRAIN",
  "ANIMA_LOCAL_LLM_BASE_URL",
  "ANIMA_LOCAL_LLM_API_KEY",
  "ANIMA_WORKERS_AI_MODEL",
  "ANIMA_WORKERS_AI_LORA",
  "ANIMA_WORKERS_AI_BACKGROUND",
  "ANIMA_WORKERS_AI_BACKGROUND_MODEL",
  "ANIMA_OPENROUTER_FALLBACK",
  "OPENROUTER_API_KEY",
  "ANIMA_RUNTIME",
] as const;
const saved: Record<string, string | undefined> = {};

type RunCall = { model: string; options: Record<string, unknown> };
let calls: RunCall[] = [];

function bindAi(reply = "hello from the edge") {
  setAiBinding({
    run: async (model, options) => {
      calls.push({ model, options });
      return { response: reply };
    },
  });
}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.ANIMA_RUNTIME = "worker";
  calls = [];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetAiBindingForTests();
});

describe("ANIMA_CHAT_BRAIN", () => {
  it("defaults to self-hosted and accepts cloudflare aliases", () => {
    expect(chatBrainMode({})).toBe("self-hosted");
    for (const v of ["cloudflare", "Cloudflare", "workers-ai", "workersai", "managed"]) {
      expect(chatBrainMode({ ANIMA_CHAT_BRAIN: v })).toBe("cloudflare");
    }
    expect(chatBrainMode({ ANIMA_CHAT_BRAIN: "self-hosted" })).toBe("self-hosted");
  });

  it("ignores a bound Fly / droplet / tunnel URL on the Cloudflare brain", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-chat-llm.fly.dev/v1";
    process.env.ANIMA_LOCAL_LLM_API_KEY = "secret";
    expect(hasLocalLlm()).toBe(true);
    process.env.ANIMA_CHAT_BRAIN = "cloudflare";
    expect(isCloudflareChatBrain()).toBe(true);
    expect(localLlmBaseUrl()).toBeNull();
    expect(hasLocalLlm()).toBe(false);
    expect(summarizeLocalLlmBaseUrl().configured).toBe(false);
    expect(summarizeLocalLlmBaseUrl().host).toBeNull();
  });

  it("routes chat and background jobs to Workers AI with no model host", () => {
    process.env.ANIMA_CHAT_BRAIN = "cloudflare";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    bindAi();
    expect(getProviderChain()).toEqual(["workersai"]);
    expect(localOnlyProviderChain()).toEqual(["workersai"]);
    const status = getLlmRoutingStatus();
    expect(status.brain).toBe("cloudflare");
    expect(status.chain).toEqual(["workersai"]);
    expect(status.backgroundChain).toEqual(["workersai"]);
    expect(status.localEndpoint.configured).toBe(false);
  });

  it("keeps background jobs local-only (empty) on the self-hosted brain", () => {
    bindAi();
    expect(localOnlyProviderChain()).toEqual([]);
    expect(cloudflareBrainBackgroundEnabled()).toBe(false);
  });

  it("can switch background jobs off to save neurons", () => {
    process.env.ANIMA_CHAT_BRAIN = "cloudflare";
    process.env.ANIMA_WORKERS_AI_BACKGROUND = "false";
    bindAi();
    expect(localOnlyProviderChain()).toEqual([]);
    expect(getProviderChain()).toEqual(["workersai"]);
  });

  it("still hops to OpenRouter after Workers AI only when the flag + key are set", () => {
    process.env.ANIMA_CHAT_BRAIN = "cloudflare";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    bindAi();
    expect(getProviderChain()).toEqual(["workersai", "openrouter"]);
    // Background never leaves Cloudflare.
    expect(localOnlyProviderChain()).toEqual(["workersai"]);
  });

  it("runs a background completion on the small background model", async () => {
    process.env.ANIMA_CHAT_BRAIN = "cloudflare";
    process.env.ANIMA_WORKERS_AI_LORA = "anima-chat-lora";
    bindAi("Serenity");
    const result = await createChatCompletionWithFailover({
      tier: "light",
      model: "anima-chat",
      maxTokens: 32,
      messages: [{ role: "user", content: "who speaks next" }],
      localOnly: true,
    });
    expect(result.provider).toBe("workersai");
    expect(result.content).toBe("Serenity");
    expect(result.model).toBe(WORKERS_AI_BACKGROUND_MODEL);
    expect(calls[0]?.model).toBe(WORKERS_AI_BACKGROUND_MODEL);
    // LoRA belongs to the chat model only.
    expect(calls[0]?.options).not.toHaveProperty("lora");
  });
});

describe("Workers AI model config", () => {
  it("uses ANIMA_WORKERS_AI_MODEL when it is a Workers AI id", () => {
    expect(workersAiChatModel({})).toBe(WORKERS_AI_CHAT_MODEL);
    expect(
      workersAiChatModel({ ANIMA_WORKERS_AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }),
    ).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(workersAiChatModel({ ANIMA_WORKERS_AI_MODEL: "gpt-4o" })).toBe(WORKERS_AI_CHAT_MODEL);
    expect(workersAiBackgroundModel({})).toBe(WORKERS_AI_BACKGROUND_MODEL);
    expect(workersAiBackgroundModel({ ANIMA_WORKERS_AI_BACKGROUND_MODEL: "@hf/x/y" })).toBe("@hf/x/y");
  });

  it("passes the LoRA to the chat model run", async () => {
    process.env.ANIMA_WORKERS_AI_MODEL = "@cf/mistral/mistral-7b-instruct-v0.2-lora";
    process.env.ANIMA_WORKERS_AI_LORA = "anima-chat-lora";
    expect(workersAiLora()).toBe("anima-chat-lora");
    bindAi("hi");
    await expect(
      completeWorkersAi({ messages: [{ role: "user", content: "hi" }], maxTokens: 16 }),
    ).resolves.toBe("hi");
    expect(calls[0]?.model).toBe("@cf/mistral/mistral-7b-instruct-v0.2-lora");
    expect(calls[0]?.options.lora).toBe("anima-chat-lora");
  });
});

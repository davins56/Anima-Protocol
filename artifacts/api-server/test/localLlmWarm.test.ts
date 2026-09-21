import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OLLAMA_KEEP_ALIVE,
  hintLocalLlmWarm,
  localChatKeepAliveFields,
  ollamaKeepAliveDuration,
  ollamaNativeOrigin,
  resetLocalLlmWarmForTests,
} from "../src/lib/localLlmWarm";

describe("localLlmWarm", () => {
  const SAVED = { ...process.env };

  afterEach(() => {
    process.env = { ...SAVED };
    resetLocalLlmWarmForTests();
  });

  it("defaults keep_alive to 30m for Ollama", () => {
    delete process.env.ANIMA_LOCAL_LLM_BACKEND;
    delete process.env.ANIMA_OLLAMA_KEEP_ALIVE;
    expect(ollamaKeepAliveDuration()).toBe(DEFAULT_OLLAMA_KEEP_ALIVE);
    expect(DEFAULT_OLLAMA_KEEP_ALIVE).toBe("30m");
    expect(localChatKeepAliveFields()).toEqual({ keep_alive: "30m" });
  });

  it("skips keep_alive for vLLM and when explicitly disabled", () => {
    process.env.ANIMA_LOCAL_LLM_BACKEND = "vllm";
    expect(localChatKeepAliveFields()).toEqual({});
    delete process.env.ANIMA_LOCAL_LLM_BACKEND;
    process.env.ANIMA_OLLAMA_KEEP_ALIVE = "off";
    expect(localChatKeepAliveFields()).toEqual({});
  });

  it("strips /v1 from the OpenAI-compatible base for the native generate URL", () => {
    expect(ollamaNativeOrigin("https://llm.anima-protocol.com/v1")).toBe(
      "https://llm.anima-protocol.com",
    );
    expect(ollamaNativeOrigin("http://localhost:11434/v1/")).toBe(
      "http://localhost:11434",
    );
  });

  it("fires a non-blocking native generate warm with keep_alive", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    process.env.ANIMA_LOCAL_LLM_API_KEY = "proxy-token";
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    hintLocalLlmWarm(process.env, fetchImpl as unknown as typeof fetch);
    hintLocalLlmWarm(process.env, fetchImpl as unknown as typeof fetch);
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.anima-protocol.com/api/generate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "anima-chat",
      keep_alive: "30m",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer proxy-token",
    );
  });

  it("does not fire a warm fetch on Cloudflare Workers (same-invocation subrequest budget)", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-chat-llm.fly.dev/v1";
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const workerGlobal = {
      navigator: { userAgent: "Cloudflare-Workers" },
    } as unknown as typeof globalThis;

    hintLocalLlmWarm(process.env, fetchImpl as unknown as typeof fetch, workerGlobal);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows warm-up failures so they cannot fail a chat turn", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    const fetchImpl = vi.fn(async () => {
      throw new Error("tunnel down");
    });
    hintLocalLlmWarm(process.env, fetchImpl as unknown as typeof fetch);
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
});

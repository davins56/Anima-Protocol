import { afterEach, describe, expect, it, vi } from "vitest";
import { resetLocalLlmSlotForTests } from "../src/lib/localLlmSlot";
import {
  APP_OPEN_LLM_WARM_COOLDOWN_MS,
  APP_OPEN_LLM_WARM_FAILURE_BACKOFF_MS,
  APP_OPEN_LLM_WARM_TIMEOUT_MS,
  DEFAULT_OLLAMA_KEEP_ALIVE,
  hintLocalLlmWarm,
  localChatKeepAliveFields,
  ollamaKeepAliveDuration,
  ollamaNativeOrigin,
  resetLocalLlmWarmForTests,
  warmLocalLlmForAppOpen,
} from "../src/lib/localLlmWarm";

describe("localLlmWarm", () => {
  const SAVED = { ...process.env };

  afterEach(() => {
    process.env = { ...SAVED };
    resetLocalLlmWarmForTests();
    resetLocalLlmSlotForTests();
  });

  it("omits keep_alive unless ANIMA_OLLAMA_KEEP_ALIVE is set", () => {
    delete process.env.ANIMA_LOCAL_LLM_BACKEND;
    delete process.env.ANIMA_OLLAMA_KEEP_ALIVE;
    expect(ollamaKeepAliveDuration()).toBeNull();
    expect(localChatKeepAliveFields()).toEqual({});
    expect(DEFAULT_OLLAMA_KEEP_ALIVE).toBe("30m");
    process.env.ANIMA_OLLAMA_KEEP_ALIVE = DEFAULT_OLLAMA_KEEP_ALIVE;
    expect(ollamaKeepAliveDuration()).toBe("30m");
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

  it("fires a non-blocking native generate warm without keep_alive", async () => {
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
      prompt: "",
      stream: false,
      options: { num_ctx: 8192, num_predict: 1 },
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

  const workerGlobal = {
    navigator: { userAgent: "Cloudflare-Workers" },
  } as unknown as typeof globalThis;

  it("preloads from a Worker app-open call without leaving the local host", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_LOCAL_LLM_API_KEY = "proxy-token";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.OPENAI_API_KEY = "sk-openai-test";
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const timeout = vi.spyOn(AbortSignal, "timeout");

    const result = await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );

    expect(result).toEqual({ ok: true, warmed: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.anima-protocol.com/api/generate");
    expect(url).not.toMatch(/openrouter|api\.openai\.com/i);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      model: "anima-chat",
      prompt: "",
      stream: false,
      options: { num_ctx: 8192, num_predict: 1 },
    });
    expect(body.keep_alive).toBeUndefined();
    expect(body.messages).toBeUndefined();
    expect(timeout).toHaveBeenCalledWith(APP_OPEN_LLM_WARM_TIMEOUT_MS);
    expect(APP_OPEN_LLM_WARM_TIMEOUT_MS).toBeGreaterThanOrEqual(15_000);
    expect(APP_OPEN_LLM_WARM_TIMEOUT_MS).toBeLessThan(45_000);
    expect(JSON.stringify(result)).not.toContain("llm.anima-protocol.com");
    expect(JSON.stringify(result)).not.toContain("proxy-token");
    timeout.mockRestore();
  });

  it("skips another app-open preload after a recent success", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    const start = 1_700_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    const skipped = await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    expect(skipped).toEqual({ ok: true, warmed: false, skipped: "recent" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + APP_OPEN_LLM_WARM_COOLDOWN_MS);
    await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("does not start a second preload while one is in flight", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    let release: (response: Response) => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    const first = warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    const second = await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    expect(second).toEqual({ ok: true, warmed: false, skipped: "in_flight" });
    // Slot acquire yields before the native generate, so the in-flight flag
    // is visible one turn before fetchImpl runs.
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
    release(new Response("{}", { status: 200 }));
    await expect(first).resolves.toEqual({ ok: true, warmed: true });
  });

  it("backs off after a failed preload and hides the host from the result", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_LOCAL_LLM_API_KEY = "proxy-token";
    const start = 1_700_000_000_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const fetchImpl = vi.fn(async () => {
      throw new Error("https://llm.anima-protocol.com refused");
    });

    const failed = await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    expect(failed).toEqual({ ok: false, warmed: false });
    expect(JSON.stringify(failed)).not.toContain("llm.anima-protocol.com");
    expect(JSON.stringify(failed)).not.toContain("proxy-token");

    const skipped = await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    expect(skipped).toEqual({ ok: true, warmed: false, skipped: "recent" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + APP_OPEN_LLM_WARM_FAILURE_BACKOFF_MS);
    await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it("skips the app-open preload when no local host is usable", async () => {
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await warmLocalLlmForAppOpen(
      process.env,
      fetchImpl as unknown as typeof fetch,
      workerGlobal,
    );
    expect(result).toEqual({ ok: true, warmed: false, skipped: "unconfigured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

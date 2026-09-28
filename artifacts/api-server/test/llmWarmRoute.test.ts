import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import llmWarmRouter from "../src/routes/llmWarm";
import { resetLocalLlmWarmForTests } from "../src/lib/localLlmWarm";

const realFetch = globalThis.fetch.bind(globalThis);
let server: Server;
let baseUrl = "";
const ollamaFetch = vi.fn(async () => new Response("{}", { status: 200 }));

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/llm", llmWarmRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  resetLocalLlmWarmForTests();
  ollamaFetch.mockClear();
  vi.unstubAllGlobals();
  delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
  delete process.env.ANIMA_LOCAL_LLM_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANIMA_OPENROUTER_FALLBACK;
});

function installFetchSplit() {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (href.startsWith(baseUrl)) return realFetch(input, init);
    return ollamaFetch(input, init);
  });
}

describe("POST /llm/warm", () => {
  it("rejects signed-out callers before touching the model host", async () => {
    installFetchSplit();
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_LOCAL_LLM_API_KEY = "proxy-token";

    const response = await fetch(`${baseUrl}/llm/warm`, { method: "POST" });
    expect(response.status).toBe(401);
    expect(ollamaFetch).not.toHaveBeenCalled();
    const body = await response.text();
    expect(body).not.toContain("llm.anima-protocol.com");
    expect(body).not.toContain("proxy-token");
  });

  it("warms once for a signed-in caller and does not echo host or key", async () => {
    installFetchSplit();
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://llm.anima-protocol.com/v1";
    process.env.ANIMA_LOCAL_LLM_API_KEY = "proxy-token";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";

    const response = await fetch(`${baseUrl}/llm/warm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user_123",
      },
      body: "{}",
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toEqual({ ok: true, warmed: true });
    expect(JSON.stringify(payload)).not.toContain("llm.anima-protocol.com");
    expect(JSON.stringify(payload)).not.toContain("proxy-token");
    expect(JSON.stringify(payload)).not.toContain("anima-chat");
    expect(response.headers.get("cache-control")).toBe("no-store");

    expect(ollamaFetch).toHaveBeenCalledTimes(1);
    const [url, init] = ollamaFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.anima-protocol.com/api/generate");
    expect(String(url)).not.toMatch(/openrouter|api\.openai\.com/i);
    expect(JSON.parse(String(init.body))).toEqual({
      model: "anima-chat",
      prompt: "",
      stream: false,
      options: { num_ctx: 8192, num_predict: 1 },
    });

    const again = await fetch(`${baseUrl}/llm/warm`, {
      method: "POST",
      headers: { "x-test-user": "user_456" },
    });
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toEqual({
      ok: true,
      warmed: false,
      skipped: "recent",
    });
    expect(ollamaFetch).toHaveBeenCalledTimes(1);
  });
});

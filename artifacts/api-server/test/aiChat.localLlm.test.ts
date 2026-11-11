import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";

import { resetAiBindingForTests } from "../src/lib/aiBinding";
import { AI_CHAT_RATE_LIMIT_MAX } from "../src/lib/aiChatGate";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit";
import { resetLlmClientsForTests } from "../src/lib/openaiClient";
import { resetLocalModelCatalogForTests } from "../src/lib/localModelCatalog";
import {
  beginCompanionLlmTurn,
  resetCompanionLlmTurnForTests,
} from "../src/lib/sidecarLlm";

/**
 * POST /api/ai/chat must work on local Node without a Workers AI binding.
 * That gate used to 503 the probe even when Ollama was up.
 */
describe("POST /api/ai/chat — local Ollama path", () => {
  let stub: Server;
  let stubBase: string;
  let received: Array<{ model: string; messages: unknown[] }> = [];
  let replyText: string | null = "Hello from the local stub.";
  let hangNext = false;
  let releaseHung = () => {};
  let missingContent = false;

  let app: Express;
  let api: Server;
  let apiBase: string;

  const SAVED = { ...process.env };

  beforeAll(async () => {
    stub = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [{ id: "anima-chat", object: "model", owned_by: "library" }],
          }),
        );
        return;
      }
      const isNativeChat = req.method === "POST" && req.url?.startsWith("/api/chat");
      const isOpenAiChat =
        req.method === "POST" && req.url?.startsWith("/v1/chat/completions");
      if (!isNativeChat && !isOpenAiChat) {
        res.writeHead(404).end();
        return;
      }
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        received.push({ model: body.model, messages: body.messages });
        if (hangNext) {
          hangNext = false;
          releaseHung = () => {
            if (res.writableEnded) return;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                model: body.model,
                message: { role: "assistant", content: "late" },
                done: true,
              }),
            );
          };
          return;
        }
        if (isNativeChat) {
          const message = missingContent
            ? { role: "assistant" }
            : { role: "assistant", content: replyText };
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              model: body.model,
              message,
              done: true,
            }),
          );
          return;
        }
        const message = missingContent
          ? { role: "assistant" }
          : { role: "assistant", content: replyText };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-local-stub",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, message, finish_reason: "stop" }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const stubAddr = stub.address();
    if (!stubAddr || typeof stubAddr === "string") {
      throw new Error("failed to bind stub local LLM server");
    }
    stubBase = `http://127.0.0.1:${stubAddr.port}/v1`;

    process.env.CLERK_PUBLISHABLE_KEY = "not-a-valid-clerk-key";
    process.env.CLERK_SECRET_KEY = "not-a-valid-clerk-secret";
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BACKEND = "ollama";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = stubBase;
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_FALLBACK;

    ({ default: app } = await import("../src/app"));
    await new Promise<void>((resolve, reject) => {
      api = app.listen(0, () => {
        const address = api.address();
        if (!address || typeof address === "string") {
          reject(new Error("Test API did not bind to a TCP port."));
          return;
        }
        apiBase = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      api.close((err) => (err ? reject(err) : resolve())),
    );
    await new Promise<void>((resolve, reject) =>
      stub.close((err) => (err ? reject(err) : resolve())),
    );
    process.env = { ...SAVED };
  });

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.CLERK_PUBLISHABLE_KEY = "not-a-valid-clerk-key";
    process.env.CLERK_SECRET_KEY = "not-a-valid-clerk-secret";
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BACKEND = "ollama";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = stubBase;
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.ANIMA_OPENROUTER_FALLBACK;
    received = [];
    replyText = "Hello from the local stub.";
    hangNext = false;
    releaseHung = () => {};
    missingContent = false;
    delete process.env.ANIMA_LLM_OPEN_TIMEOUT_MS;
    resetAiBindingForTests();
    resetLlmClientsForTests();
    resetLocalModelCatalogForTests();
    resetRateLimitStateForTests();
    resetCompanionLlmTurnForTests();
    delete process.env.ANIMA_AI_CHAT_PROBE_KEY;
    delete process.env.ANIMA_AI_CHAT_REQUIRE_AUTH;
  });

  afterEach(() => {
    resetAiBindingForTests();
    resetLlmClientsForTests();
    resetLocalModelCatalogForTests();
    process.env = { ...SAVED };
  });

  it("completes a chat turn from the local endpoint without a Workers AI binding", async () => {
    const response = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Who are you?" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      response: replyText,
      provider: "local",
      model: "anima-chat",
      failed_over: false,
    });
    expect(received).toHaveLength(1);
    expect(received[0]!.messages).toEqual(
      expect.arrayContaining([{ role: "user", content: "Who are you?" }]),
    );
  });

  it("returns a setup hint when no local LLM is reachable on a no-loopback runtime", async () => {
    process.env.ANIMA_RUNTIME = "vercel";
    process.env.ANIMA_AI_CHAT_PROBE_KEY = "probe-test-key";
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    resetLlmClientsForTests();
    resetAiBindingForTests();

    const response = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer probe-test-key",
      },
      body: JSON.stringify({ prompt: "Hello" }),
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("llm_not_configured");
    expect(body.error).toMatch(/ANIMA_LLM_PROVIDER=custom requires a self-hosted Anima LLM/i);
    expect(received).toHaveLength(0);
  });

  it("returns 502 when Ollama answers with empty content", async () => {
    replyText = "";

    const response = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("ai_request_failed");
    expect(body.error).toMatch(/empty reply/i);
    expect(body).not.toHaveProperty("response", "");
  });

  it("returns 502 when the completion has no message content", async () => {
    missingContent = true;

    const response = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("ai_request_failed");
    expect(body.error).toMatch(/empty reply/i);
  });

  it("aborts a hung Ollama host instead of sitting forever", async () => {
    hangNext = true;
    process.env.ANIMA_LLM_OPEN_TIMEOUT_MS = "250";
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.ANIMA_OPENROUTER_FALLBACK = "true";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    resetLlmClientsForTests();

    const response = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe("ai_timeout");
    expect(body.error).toMatch(/took too long to reply/i);
    expect(received).toHaveLength(1);
  });

  it("returns 401 in production without a signed-in user or probe key", async () => {
    process.env.ANIMA_RUNTIME = "worker";
    delete process.env.ANIMA_AI_CHAT_PROBE_KEY;

    const response = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("ai_chat_unauthorized");
    expect(received).toHaveLength(0);
  });

  it("returns 429 when the per-IP limit is exceeded", async () => {
    process.env.ANIMA_AI_CHAT_REQUIRE_AUTH = "1";
    process.env.ANIMA_AI_CHAT_PROBE_KEY = "probe-test-key";
    resetRateLimitStateForTests();

    let status = 0;
    for (let i = 0; i < AI_CHAT_RATE_LIMIT_MAX + 1; i += 1) {
      const response = await fetch(`${apiBase}/api/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer probe-test-key",
        },
        body: JSON.stringify({ prompt: "Hello" }),
      });
      status = response.status;
    }

    expect(status).toBe(429);
    expect(received.length).toBe(AI_CHAT_RATE_LIMIT_MAX);
  });

  it("returns 429 to a second probe while the first still holds the slot", async () => {
    hangNext = true;
    const first = fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hold the slot" }),
    });
    const started = Date.now();
    while (received.length < 1 && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(received.length).toBe(1);
    const second = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "also me" }),
    });
    expect(second.status).toBe(429);
    expect((await second.json()).code).toBe("llm_busy");
    releaseHung();
    expect((await first).status).toBe(200);
  });

  it("returns 429 while a companion turn holds the model slot", async () => {
    const release = beginCompanionLlmTurn("user_probe");
    try {
      const response = await fetch(`${apiBase}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Hello" }),
      });
      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.code).toBe("llm_busy");
      expect(received).toHaveLength(0);
    } finally {
      release();
    }
  });

  it("keeps /api/healthz/llm?probe=1 public", async () => {
    process.env.ANIMA_RUNTIME = "worker";
    const health = await fetch(`${apiBase}/api/healthz/llm?probe=1`);
    expect(health.status).not.toBe(401);
  });
});

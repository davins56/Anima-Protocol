import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Express } from "express";

import { resetAiBindingForTests } from "../src/lib/aiBinding";
import { resetLlmClientsForTests } from "../src/lib/openaiClient";
import { resetLocalModelCatalogForTests } from "../src/lib/localModelCatalog";

/**
 * POST /api/ai/chat must work on local Node without a Workers AI binding.
 * That gate used to 503 the probe even when Ollama was up.
 */
describe("POST /api/ai/chat — local Ollama path", () => {
  let stub: Server;
  let stubBase: string;
  let received: Array<{ model: string; messages: unknown[] }> = [];
  let replyText = "Hello from the local stub.";

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
      if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        received.push({ model: body.model, messages: body.messages });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-local-stub",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: replyText },
                finish_reason: "stop",
              },
            ],
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
    resetAiBindingForTests();
    resetLlmClientsForTests();
    resetLocalModelCatalogForTests();
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
    delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.OLLAMA_BASE_URL;
    resetLlmClientsForTests();
    resetAiBindingForTests();

    const response = await fetch(`${apiBase}/api/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello" }),
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("llm_not_configured");
    expect(body.error).toMatch(/ANIMA_LLM_PROVIDER=custom requires a self-hosted Anima LLM/i);
    expect(received).toHaveLength(0);
  });
});

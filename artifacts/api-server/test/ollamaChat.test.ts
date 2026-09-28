import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";

import { resetLlmClientsForTests } from "../src/lib/openaiClient";
import {
  OLLAMA_CHAT_SAMPLING,
  OLLAMA_MAX_TEMPERATURE,
  OLLAMA_NUM_PREDICT_CAP,
  OLLAMA_UNAVAILABLE_HINT,
  createOllamaChatCompletion,
  createOllamaChatStream,
  isOllamaNativeChatEnabled,
  resolveOllamaChatConfig,
  resolveOllamaModelName,
  toOllamaMessages,
} from "../src/lib/ollamaChat";
import {
  createChatCompletionWithFailover,
  createChatStreamWithFailover,
} from "../src/lib/llmFailover";
import { consumeLlmStream } from "../src/lib/consumeLlmStream";

async function listenStub(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; origin: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind Ollama stub");
  }
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}") as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

describe("ollamaChat adapter", () => {
  const SAVED = { ...process.env };

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmClientsForTests();
  });

  it("reads model name and native /api/chat URL from env (never a VITE_ var)", () => {
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BACKEND = "ollama";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    delete process.env.VERCEL;

    const config = resolveOllamaChatConfig();
    expect(resolveOllamaModelName()).toBe("anima-chat");
    expect(config.origin).toBe("http://localhost:11434");
    expect(config.chatUrl).toBe("http://localhost:11434/api/chat");
    expect(isOllamaNativeChatEnabled()).toBe(true);
  });

  it("accepts a root Ollama URL without /v1 and OLLAMA_MODEL", () => {
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://127.0.0.1:11434";
    process.env.OLLAMA_MODEL = "qwen2.5:3b";
    delete process.env.ANIMA_OLLAMA_MODEL_STANDARD;
    delete process.env.ANIMA_OLLAMA_MODEL;
    const config = resolveOllamaChatConfig();
    expect(config.chatUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(config.model).toBe("qwen2.5:3b");
  });

  it("stays off for vLLM and when ANIMA_OLLAMA_NATIVE_CHAT=0", () => {
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.ANIMA_LOCAL_LLM_BACKEND = "vllm";
    expect(isOllamaNativeChatEnabled()).toBe(false);
    process.env.ANIMA_LOCAL_LLM_BACKEND = "ollama";
    process.env.ANIMA_OLLAMA_NATIVE_CHAT = "0";
    expect(isOllamaNativeChatEnabled()).toBe(false);
  });

  it("preserves character system instructions and conversation history", () => {
    const mapped = toOllamaMessages([
      { role: "system", content: "CHARACTER IDENTITY LOCK: You are Serenity." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "I'm here." },
      { role: "user", content: [{ type: "text", text: "Stay with me." }] as never },
    ]);
    expect(mapped).toEqual([
      { role: "system", content: "CHARACTER IDENTITY LOCK: You are Serenity." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "I'm here." },
      { role: "user", content: "Stay with me." },
    ]);
  });

  it("streams NDJSON /api/chat deltas as OpenAI-shaped chunks", async () => {
    const received: Record<string, unknown>[] = [];
    const { server, origin } = await listenStub((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      void readJson(req).then((body) => {
        received.push(body);
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(
          `${JSON.stringify({ message: { role: "assistant", content: "Stay " }, done: false })}\n`,
        );
        res.write(
          `${JSON.stringify({ message: { role: "assistant", content: "close." }, done: false })}\n`,
        );
        res.end(`${JSON.stringify({ message: { role: "assistant", content: "" }, done: true })}\n`);
      });
    });

    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BACKEND = "ollama";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    delete process.env.ANIMA_OLLAMA_NATIVE_CHAT;
    delete process.env.ANIMA_OLLAMA_KEEP_ALIVE;

    try {
      const stream = await createOllamaChatStream({
        model: "anima-chat",
        maxTokens: 64,
        temperature: 0.4,
        messages: [
          { role: "system", content: "You are Serenity." },
          { role: "user", content: "Hi" },
        ],
      });
      const result = await consumeLlmStream(stream);
      expect(result.content).toBe("Stay close.");
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        model: "anima-chat",
        stream: true,
        options: { temperature: 0.4, num_ctx: 8192, num_predict: 64 },
        messages: [
          { role: "system", content: "You are Serenity." },
          { role: "user", content: "Hi" },
        ],
      });
      expect(received[0]!.keep_alive).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("completes a non-stream /api/chat turn", async () => {
    const { server, origin } = await listenStub((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      void readJson(req).then((body) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: body.model,
            message: { role: "assistant", content: "I hear you." },
            done: true,
          }),
        );
      });
    });

    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";

    try {
      const result = await createOllamaChatCompletion({
        model: "anima-chat",
        messages: [{ role: "user", content: "Hello" }],
      });
      expect(result).toEqual({ content: "I hear you.", model: "anima-chat" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("sends Qwen sampling defaults and caps hot temperatures that garble a 3B model", async () => {
    const received: Array<Record<string, unknown>> = [];
    const { server, origin } = await listenStub((req, res) => {
      void readJson(req).then((body) => {
        received.push(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: body.model,
            message: { role: "assistant", content: "Hi." },
            done: true,
          }),
        );
      });
    });

    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    delete process.env.ANIMA_OLLAMA_MAX_TEMPERATURE;

    try {
      const messages = [{ role: "user" as const, content: "Hello" }];
      await createOllamaChatCompletion({ model: "anima-chat", messages, temperature: 1.15 });
      await createOllamaChatCompletion({ model: "anima-chat", messages });
      process.env.ANIMA_OLLAMA_MAX_TEMPERATURE = "1";
      await createOllamaChatCompletion({ model: "anima-chat", messages, temperature: 0.9 });

      expect(received[0]!.options).toEqual({
        ...OLLAMA_CHAT_SAMPLING,
        num_ctx: 8192,
        num_predict: OLLAMA_NUM_PREDICT_CAP,
        temperature: OLLAMA_MAX_TEMPERATURE,
      });
      expect(received[1]!.options).toEqual({
        ...OLLAMA_CHAT_SAMPLING,
        num_ctx: 8192,
        num_predict: OLLAMA_NUM_PREDICT_CAP,
      });
      expect((received[2]!.options as { temperature: number }).temperature).toBe(0.9);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("returns a useful connection error without leaking the endpoint URL", async () => {
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://127.0.0.1:1/v1";
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";

    await expect(
      createOllamaChatCompletion({
        model: "anima-chat",
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toThrow(OLLAMA_UNAVAILABLE_HINT);

    try {
      await createOllamaChatCompletion({
        model: "anima-chat",
        messages: [{ role: "user", content: "Hello" }],
      });
      throw new Error("expected failure");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(/Ollama model server is not running/i);
      expect(message).not.toMatch(/127\.0\.0\.1:1/);
      expect(message).not.toMatch(/\/api\/chat/);
      expect((err as { name?: string }).name).toBe("APIConnectionError");
    }
  });

  it("marks a missing model as model_not_found so failover can discover a sibling", async () => {
    const { server, origin } = await listenStub((_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "model 'anima-chat' not found" }));
    });
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;

    try {
      await expect(
        createOllamaChatCompletion({
          model: "anima-chat",
          messages: [{ role: "user", content: "Hello" }],
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: "model_not_found",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("does not treat an in-body error on a 200 as a missing model", async () => {
    const { server, origin } = await listenStub((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "llama runner process has terminated: out of memory" }));
    });
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;

    try {
      const err = await createOllamaChatCompletion({
        model: "anima-chat",
        messages: [{ role: "user", content: "Hello" }],
      }).catch((e: unknown) => e as { status?: number; code?: string; message?: string });
      expect(err.status).toBe(500);
      expect(err.code).not.toBe("model_not_found");
      expect(err.message).toContain("out of memory");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("aborts the upstream request when a stalled stream is abandoned", async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => {
      upstreamClosed = resolve;
    });
    const { server, origin } = await listenStub((req, res) => {
      res.on("close", () => upstreamClosed());
      void readJson(req).then(() => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(
          `${JSON.stringify({ message: { role: "assistant", content: "Still " }, done: false })}\n`,
        );
        // Then hang: the host stops sending but keeps the connection open.
      });
    });
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;

    try {
      const stream = await createOllamaChatStream({
        model: "anima-chat",
        messages: [{ role: "user", content: "Hi" }],
      });
      const result = await consumeLlmStream(stream, {
        firstChunkMs: 2_000,
        stallMs: 150,
        totalMs: 5_000,
      });
      expect(result.content).toBe("Still");
      expect(result.timedOut).toBe(true);
      await expect(
        Promise.race([
          closed.then(() => "closed"),
          new Promise((resolve) => setTimeout(() => resolve("still open"), 2_000)),
        ]),
      ).resolves.toBe("closed");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("fails a stream that ends without Ollama's done line", async () => {
    const { server, origin } = await listenStub((req, res) => {
      void readJson(req).then(() => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.end(
          `${JSON.stringify({ message: { role: "assistant", content: "Half a" }, done: false })}\n`,
        );
      });
    });
    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;

    try {
      const stream = await createOllamaChatStream({
        model: "anima-chat",
        messages: [{ role: "user", content: "Hi" }],
      });
      await expect(consumeLlmStream(stream)).rejects.toMatchObject({
        name: "APIConnectionError",
        message: expect.stringContaining("ended before the reply finished"),
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("routes createChatCompletionWithFailover through native /api/chat", async () => {
    const received: Record<string, unknown>[] = [];
    const { server, origin } = await listenStub((req, res) => {
      if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "anima-chat" }] }));
        return;
      }
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      void readJson(req).then((body) => {
        received.push(body);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            model: "anima-chat",
            message: { role: "assistant", content: "Native Ollama reply." },
            done: true,
          }),
        );
      });
    });

    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BACKEND = "ollama";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    delete process.env.ANIMA_OLLAMA_NATIVE_CHAT;
    delete process.env.VERCEL;
    delete process.env.OPENROUTER_API_KEY;
    resetLlmClientsForTests();

    try {
      const result = await createChatCompletionWithFailover({
        tier: "standard",
        maxTokens: 64,
        messages: [
          { role: "system", content: "You are Serenity." },
          { role: "user", content: "Who are you?" },
        ],
      });
      expect(result.content).toBe("Native Ollama reply.");
      expect(result.provider).toBe("local");
      expect(result.model).toBe("anima-chat");
      expect(received[0]?.messages).toEqual([
        { role: "system", content: "You are Serenity." },
        { role: "user", content: "Who are you?" },
      ]);
      expect(received[0]?.stream).toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("routes createChatStreamWithFailover through native /api/chat", async () => {
    const { server, origin } = await listenStub((req, res) => {
      if (req.method !== "POST" || req.url !== "/api/chat") {
        res.writeHead(404).end();
        return;
      }
      void readJson(req).then(() => {
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        res.write(
          `${JSON.stringify({ message: { role: "assistant", content: "Streamed." }, done: false })}\n`,
        );
        res.end(`${JSON.stringify({ done: true })}\n`);
      });
    });

    process.env.ANIMA_RUNTIME = "node";
    process.env.ANIMA_LOCAL_LLM_BACKEND = "ollama";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = `${origin}/v1`;
    process.env.ANIMA_OLLAMA_MODEL_STANDARD = "anima-chat";
    delete process.env.ANIMA_OLLAMA_NATIVE_CHAT;
    resetLlmClientsForTests();

    try {
      const result = await createChatStreamWithFailover({
        tier: "standard",
        model: "anima-chat",
        maxTokens: 64,
        messages: [{ role: "user", content: "Hi" }],
      });
      const consumed = await consumeLlmStream(result.stream);
      expect(consumed.content).toBe("Streamed.");
      expect(result.provider).toBe("local");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});

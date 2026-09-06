import type { Server } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AnimaLLM,
  DEFAULT_ANIMA_SYSTEM_PROMPT,
  generateAnimaResponse,
  streamAnimaResponse,
} from "../src/client";

describe("AnimaLLM Client", () => {
  let server: Server;
  let serverUrl: string;
  let lastRequestBody: any = null;

  beforeAll(async () => {
    server = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          lastRequestBody = JSON.parse(body);
        } catch {
          lastRequestBody = null;
        }

        if (req.url === "/v1/chat/completions" || req.url === "/chat/completions") {
          if (lastRequestBody?.stream) {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            });
            res.write(
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "Hello " } }],
                model: lastRequestBody.model || "anima-chat",
              })}\n\n`,
            );
            res.write(
              `data: ${JSON.stringify({
                choices: [{ delta: { content: "world!" } }],
                model: lastRequestBody.model || "anima-chat",
              })}\n\n`,
            );
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: "I am Anima, your digital companion.",
                    },
                  },
                ],
                model: lastRequestBody?.model || "anima-chat",
                usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
              }),
            );
            return;
          }
        }

        res.writeHead(404);
        res.end();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${addr.port}/v1`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  it("builds messages with default system prompt when missing", () => {
    const client = new AnimaLLM({ baseUrl: serverUrl, apiKey: "test-token" });
    const msgs = client.buildMessages({ prompt: "Hello there" });

    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: DEFAULT_ANIMA_SYSTEM_PROMPT });
    expect(msgs[1]).toEqual({ role: "user", content: "Hello there" });
  });

  it("respects custom system prompt and message array", () => {
    const client = new AnimaLLM({ baseUrl: serverUrl, apiKey: "test-token" });
    const msgs = client.buildMessages({
      messages: [{ role: "user", content: "How are you?" }],
      systemPrompt: "You are a friendly robot.",
    });

    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({ role: "system", content: "You are a friendly robot." });
    expect(msgs[1]).toEqual({ role: "user", content: "How are you?" });
  });

  it("generates a non-streaming response via AnimaLLM.generateResponse", async () => {
    const client = new AnimaLLM({
      baseUrl: serverUrl,
      apiKey: "test-token",
      defaultTier: "standard",
    });
    const res = await client.generateResponse({ prompt: "Who are you?" });

    expect(res.content).toBe("I am Anima, your digital companion.");
    expect(res.tier).toBe("standard");
    expect(res.usage?.totalTokens).toBe(18);
    expect(lastRequestBody.stream).toBe(false);
  });

  it("streams an AI response via AnimaLLM.streamResponse", async () => {
    const client = new AnimaLLM({
      baseUrl: serverUrl,
      apiKey: "test-token",
      defaultTier: "standard",
    });
    const streamResult = await client.streamResponse({ prompt: "Tell me a secret" });

    expect(streamResult.tier).toBe("standard");
    const chunks: string[] = [];
    let finalContent = "";

    for await (const chunk of streamResult.stream) {
      if (chunk.delta) chunks.push(chunk.delta);
      if (chunk.done) finalContent = chunk.content;
    }

    expect(chunks).toEqual(["Hello ", "world!"]);
    expect(finalContent).toBe("Hello world!");
  });

  it("works with generateAnimaResponse convenience wrapper", async () => {
    const res = await generateAnimaResponse(
      { prompt: "Testing convenience helper" },
      { baseUrl: serverUrl, apiKey: "test-token" },
    );

    expect(res.content).toBe("I am Anima, your digital companion.");
  });

  it("works with streamAnimaResponse convenience wrapper", async () => {
    const result = await streamAnimaResponse(
      { prompt: "Testing stream helper" },
      { baseUrl: serverUrl, apiKey: "test-token" },
    );

    let content = "";
    for await (const chunk of result.stream) {
      if (chunk.done) content = chunk.content;
    }

    expect(content).toBe("Hello world!");
  });
});

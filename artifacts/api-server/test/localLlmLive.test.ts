import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetLlmClientsForTests } from "../src/lib/openaiClient";
import {
  createChatCompletionWithFailover,
  getConfiguredProviderMode,
  getLlmRoutingStatus,
  getProviderChain,
  resetLlmFailoverStateForTests,
} from "../src/lib/llmFailover";

/**
 * Real end-to-end proof that "custom" mode talks to a self-hosted,
 * OpenAI-compatible Anima LLM (what Ollama/vLLM present) over a genuine HTTP
 * round trip — not a mock of the SDK client — and never reaches for a cloud
 * flagship provider (Gemini/Groq/Kimi/Grok/OpenAI) while doing it.
 *
 * This process's network policy blocks pulling real Ollama weights (see
 * docs/custom-llm.md), so the stand-in server below plays the same role
 * `ollama serve`'s `/v1/chat/completions` does: a live OpenAI-compatible
 * endpoint. Swapping `ANIMA_LOCAL_LLM_BASE_URL` for a real Ollama/vLLM host
 * changes nothing else about this code path.
 */
describe("custom Anima LLM — live local HTTP round trip", () => {
  let server: Server;
  let baseUrl: string;
  let received: Array<{ model: string; messages: unknown[] }> = [];
  let replyText = "";

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
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
            usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("failed to bind stub local LLM server");
    }
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    // Custom mode, pointed at the live stub — mirrors a real Ollama/vLLM host.
    process.env.ANIMA_LLM_PROVIDER = "custom";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = baseUrl;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.ANIMA_LOCAL_LLM_BACKEND;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    // No cloud key should ever be needed in custom mode; leaving them unset
    // makes any accidental cloud call fail loudly instead of silently
    // "working" via a real provider.
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.AI_GATEWAY_API_KEY;
    delete process.env.VERCEL_OIDC_TOKEN;

    received = [];
    replyText = "Anima LLM ready — served locally, no flagship cloud model involved.";
    resetLlmFailoverStateForTests();
    resetLlmClientsForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmFailoverStateForTests();
    resetLlmClientsForTests();
  });

  it("resolves to the self-hosted Anima LLM as the only provider in the chain", () => {
    expect(getConfiguredProviderMode()).toBe("local");
    expect(getProviderChain()).toEqual(["local"]);
    const status = getLlmRoutingStatus();
    expect(status.brand).toBe("anima");
    expect(status.preferred).toBe("local");
  });

  it("serves a real chat turn end-to-end from the local model — no flagship switch", async () => {
    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 64,
      messages: [{ role: "user", content: "Who are you?" }],
    });

    // The reply came from OUR stub over a real HTTP request/response, proving
    // the OpenAI SDK client is genuinely wired to ANIMA_LOCAL_LLM_BASE_URL.
    expect(result.content).toBe(replyText);
    expect(result.provider).toBe("local");
    expect(result.brand).toBe("anima");
    expect(result.failedOver).toBe(false);

    // Exactly one request reached the local model, and it carried the user's
    // turn — nothing was rewritten to look like a different provider's call.
    expect(received).toHaveLength(1);
    expect(received[0]!.messages).toEqual([{ role: "user", content: "Who are you?" }]);
    // Default bootstrap tag from lib/llm/src/registry.ts (anima-chat / Qwen2.5).
    expect(received[0]!.model).toBe("anima-chat");
  });

  it("fails clearly instead of silently switching to a cloud flagship model when local is unreachable", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://127.0.0.1:1/v1"; // nothing listens here
    resetLlmFailoverStateForTests();
    resetLlmClientsForTests();

    await expect(
      createChatCompletionWithFailover({
        tier: "standard",
        maxTokens: 64,
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toThrow();

    // The failed local attempt must not have fallen through to a cloud call —
    // there was nothing else in the chain to fall through to.
    expect(getProviderChain()).toEqual(["local"]);
    expect(received).toHaveLength(0);
  });
});

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetLlmClientsForTests } from "../src/lib/openaiClient";
import { resetLocalModelCatalogForTests } from "../src/lib/localModelCatalog";
import {
  createChatCompletionWithFailover,
  getLlmRoutingStatus,
  isAnimaCustomMode,
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
  /** Model ids the stub serves. `null` = accept anything (the happy path). */
  let servedModels: string[] | null = null;
  let modelsListCalls = 0;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      // Ollama / vLLM / llama.cpp all expose this alongside chat completions.
      if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
        modelsListCalls += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: (servedModels ?? []).map((id) => ({ id, object: "model", owned_by: "library" })),
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
        // Reproduce the real 404 an Ollama/vLLM host returns for a tag it does
        // not have, verbatim — including OpenAI's wording, which is what the
        // user actually sees in the app.
        if (servedModels && !servedModels.includes(body.model)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message: `The model \`${body.model}\` does not exist or you do not have access to it.`,
                type: "invalid_request_error",
                code: "model_not_found",
              },
            }),
          );
          return;
        }
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
    // Pointed at the live stub — mirrors a real Ollama/vLLM host. There is no
    // provider mode to set: this is the only chat backend that exists.
    process.env.ANIMA_LOCAL_LLM_BASE_URL = baseUrl;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.VLLM_BASE_URL;
    delete process.env.ANIMA_LOCAL_LLM_BACKEND;
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    // No cloud key should ever matter; leaving them unset makes any
    // accidental cloud call fail loudly instead of silently "working" via a
    // real provider (there is no cloud call path in the code at all).
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
    servedModels = null;
    modelsListCalls = 0;
    replyText = "Anima LLM ready — served locally, no flagship cloud model involved.";
    resetLlmClientsForTests();
    resetLocalModelCatalogForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLlmClientsForTests();
    resetLocalModelCatalogForTests();
  });

  it("resolves to the self-hosted Anima LLM as the only provider", () => {
    expect(isAnimaCustomMode()).toBe(true);
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("ok");
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

  it("recovers over real HTTP when the host does not serve the configured tag", async () => {
    // The reported failure: `ollama create anima-chat` was never run on the
    // host, so it only has the base weights. Every turn used to die on
    // "404 The model `anima-chat` does not exist or you do not have access to it."
    servedModels = ["nomic-embed-text:latest", "qwen2.5:3b"];

    const result = await createChatCompletionWithFailover({
      tier: "standard",
      maxTokens: 64,
      messages: [{ role: "user", content: "Are you there?" }],
    });

    expect(result.content).toBe(replyText);
    expect(result.provider).toBe("local");
    // Answered by the model the host really has — not the embedding model.
    expect(result.model).toBe("qwen2.5:3b");
    expect(received).toHaveLength(1);
    expect(received[0]!.model).toBe("qwen2.5:3b");
    expect(modelsListCalls).toBe(1);
  });

  it("keeps answering on later turns without re-listing or re-404ing", async () => {
    servedModels = ["qwen2.5:3b"];

    for (const text of ["first", "second", "third"]) {
      const result = await createChatCompletionWithFailover({
        tier: "standard",
        maxTokens: 64,
        messages: [{ role: "user", content: text }],
      });
      expect(result.model).toBe("qwen2.5:3b");
    }

    // Three successful turns, one discovery — consistency, not a 404 per message.
    expect(received.map((r) => r.model)).toEqual(["qwen2.5:3b", "qwen2.5:3b", "qwen2.5:3b"]);
    expect(modelsListCalls).toBe(1);
  });

  it("explains the mismatch instead of surfacing a bare 404 when nothing can chat", async () => {
    // Host is up and reachable, but serves only an embedding model.
    servedModels = ["nomic-embed-text:latest"];

    await expect(
      createChatCompletionWithFailover({
        tier: "standard",
        maxTokens: 64,
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toThrow(/does not serve a model named "anima-chat".*nomic-embed-text/is);

    expect(received).toHaveLength(0);
  });

  it("fails clearly instead of silently switching to a cloud flagship model when local is unreachable", async () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://127.0.0.1:1/v1"; // nothing listens here
    resetLlmClientsForTests();

    await expect(
      createChatCompletionWithFailover({
        tier: "standard",
        maxTokens: 64,
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).rejects.toThrow();

    // The failed local attempt must not have fallen through to a cloud call —
    // there is no other provider in the code to fall through to.
    expect(received).toHaveLength(0);
  });
});

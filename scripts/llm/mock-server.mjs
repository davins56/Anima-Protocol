#!/usr/bin/env node
/**
 * Minimal OpenAI-compatible chat server for LOCAL SMOKE TESTING ONLY.
 *
 * This is NOT a real model — it echoes canned responses. It exists so the
 * custom-LLM wiring (ANIMA_LOCAL_LLM_BASE_URL, ANIMA_LLM_PROVIDER=custom,
 * /api/healthz/llm) can be exercised end-to-end without a GPU or network
 * access to Ollama/Hugging Face, e.g. in a sandboxed CI/dev container.
 *
 * For a real self-hosted brain, follow docs/custom-llm.md (Ollama + Qwen2.5,
 * or vLLM + fine-tuned Ministral) instead of this stub.
 *
 *   node scripts/llm/mock-server.mjs [--port 11555]
 */
import { createServer } from "node:http";

const port = Number(process.argv.includes("--port")
  ? process.argv[process.argv.indexOf("--port") + 1]
  : process.env.PORT || 11555);

const modelId = process.env.ANIMA_OLLAMA_MODEL_STANDARD || "anima-chat-mock";

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};

  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: modelId, object: "model" }] }));
    return;
  }

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    const lastUser = [...(body.messages || [])].reverse().find((m) => m.role === "user");
    const content = `[mock anima-chat] You said: ${lastUser?.content ?? "(nothing)"}`;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "mock-" + Date.now(),
        object: "chat.completion",
        model: body.model || modelId,
        choices: [
          { index: 0, message: { role: "assistant", content }, finish_reason: "stop" },
        ],
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[mock-anima-llm] listening on http://127.0.0.1:${port}/v1 (model=${modelId})`);
});

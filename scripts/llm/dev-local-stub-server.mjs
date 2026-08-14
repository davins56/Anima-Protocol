#!/usr/bin/env node
// Throwaway OpenAI-compatible stand-in for `ollama serve` / vLLM, used only to
// prove the api-server's custom-LLM wiring against a real HTTP endpoint in
// environments where pulling actual Ollama weights is blocked by network
// policy. Not part of the app — dev/verification use only.
import { createServer } from "node:http";

const port = Number(process.env.STUB_PORT || 41777);
const modelId = process.env.STUB_MODEL || "anima-chat";

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: modelId, object: "model" }] }));
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
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-local-stub",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model || modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Anima LLM ready — served locally, no flagship cloud model involved.",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`stub local LLM listening on http://127.0.0.1:${port}/v1 (model=${modelId})`);
});

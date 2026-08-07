#!/usr/bin/env node
/**
 * One-shot OpenAI-compatible chat against the local Anima LLM.
 *
 *   node scripts/llm/chat-smoke.mjs "Who are you?"
 *   pnpm llm:chat -- "Tell me a short hello"
 */
const base =
  (process.env.ANIMA_LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434/v1").replace(
    /\/$/,
    "",
  );
const model =
  process.env.ANIMA_OLLAMA_MODEL_STANDARD ||
  process.env.ANIMA_OLLAMA_CHAT_TAG ||
  "anima-chat";
const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "In one short sentence, introduce yourself as the Anima Protocol LLM.";

const res = await fetch(`${base}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.ANIMA_LOCAL_LLM_API_KEY || "local"}`,
  },
  body: JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content:
          "You are the Anima Protocol companion LLM. Answer briefly and in character.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 160,
    temperature: 0.85,
  }),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`HTTP ${res.status}: ${text}`);
  process.exit(1);
}

const data = await res.json();
const content = data?.choices?.[0]?.message?.content?.trim();
if (!content) {
  console.error("Empty completion:", JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(content);
console.error(`\n[model=${data.model || model} base=${base}]`);

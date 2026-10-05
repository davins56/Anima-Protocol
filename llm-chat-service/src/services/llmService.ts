import { config } from "../config.js";
import type { ChatMessage } from "../types/index.js";

export type LlmResult = { response: Response; durationMs: number };

export async function requestLlm(messages: ChatMessage[], temperature = 0.7): Promise<LlmResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.llmApiKey}` },
      body: JSON.stringify({ model: config.llmModel, messages, temperature: Math.min(1.5, Math.max(0, temperature)), max_tokens: config.maxOutputTokens, stream: true }),
      signal: controller.signal,
    });
    return { response, durationMs: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

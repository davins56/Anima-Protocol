import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { aiBinding } from "./aiBinding";

/** Production chat model — DeepSeek R1 distill via Workers AI + AI Gateway. */
export const WORKERS_AI_CHAT_MODEL =
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b";

/** wrangler.jsonc `ai.gateway.id` — documented here so healthz stays secret-free. */
export const WORKERS_AI_GATEWAY_ID = "deepseek-gateway";

export function hasWorkersAiBinding(): boolean {
  return typeof aiBinding?.run === "function";
}

export function workersAiMessages(
  messages: ChatCompletionMessageParam[],
): Array<{ role: string; content: string }> {
  return messages.map((message) => ({
    role: String(message.role),
    content:
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? ""),
  }));
}

export function extractWorkersAiText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  const rec = response as Record<string, unknown>;
  if (typeof rec.response === "string") return rec.response;
  if (rec.result && typeof rec.result === "object") {
    const inner = rec.result as Record<string, unknown>;
    if (typeof inner.response === "string") return inner.response;
  }
  return "";
}

function workersAiChunk(
  text: string,
  finish: boolean,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id: "workersai",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: WORKERS_AI_CHAT_MODEL,
    choices: [
      {
        index: 0,
        delta: text ? { content: text } : {},
        finish_reason: finish ? "stop" : null,
      },
    ],
  };
}

async function* iterateWorkersAiStream(
  response: unknown,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  if (
    response &&
    typeof response === "object" &&
    Symbol.asyncIterator in (response as object)
  ) {
    for await (const part of response as AsyncIterable<unknown>) {
      const text =
        extractWorkersAiText(part) || (typeof part === "string" ? part : "");
      if (text) yield workersAiChunk(text, false);
    }
    yield workersAiChunk("", true);
    return;
  }

  if (typeof ReadableStream !== "undefined" && response instanceof ReadableStream) {
    const reader = response.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value as Uint8Array, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const payload = trimmed.startsWith("data:")
            ? trimmed.slice(5).trim()
            : trimmed;
          if (!payload || payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload) as unknown;
            const text = extractWorkersAiText(parsed);
            if (text) yield workersAiChunk(text, false);
          } catch {
            yield workersAiChunk(payload, false);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield workersAiChunk("", true);
    return;
  }

  yield workersAiChunk(extractWorkersAiText(response), true);
}

function requireWorkersAiBinding() {
  if (!aiBinding) {
    throw new Error(
      "Workers AI binding is not available. Confirm wrangler.jsonc binds AI through gateway deepseek-gateway, then redeploy.",
    );
  }
  return aiBinding;
}

export async function completeWorkersAi(opts: {
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
}): Promise<string> {
  const binding = requireWorkersAiBinding();
  const response = await binding.run(WORKERS_AI_CHAT_MODEL, {
    messages: workersAiMessages(opts.messages),
    max_tokens: opts.maxTokens,
    ...(typeof opts.temperature === "number"
      ? { temperature: opts.temperature }
      : {}),
  });
  return extractWorkersAiText(response);
}

export async function streamWorkersAi(opts: {
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
}): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const binding = requireWorkersAiBinding();
  const response = await binding.run(WORKERS_AI_CHAT_MODEL, {
    messages: workersAiMessages(opts.messages),
    max_tokens: opts.maxTokens,
    stream: true,
    ...(typeof opts.temperature === "number"
      ? { temperature: opts.temperature }
      : {}),
  });
  return iterateWorkersAiStream(response);
}

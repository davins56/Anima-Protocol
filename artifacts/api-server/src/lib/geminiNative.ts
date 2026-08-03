// Native Gemini (Generative Language) API client.
//
// Google AI Studio now issues AQ.* "auth keys" that often fail on the
// OpenAI-compatible `/v1beta/openai` endpoint. This module calls
// generateContent / streamGenerateContent with `x-goog-api-key` instead.

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { hasGeminiKey, normalizeApiKey } from "./openaiClient";

export class GeminiApiError extends Error {
  status?: number;
  code?: string;

  constructor(
    message: string,
    opts?: { status?: number; code?: string; cause?: unknown },
  ) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "GeminiApiError";
    this.status = opts?.status;
    this.code = opts?.code;
  }
}

type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export interface GeminiGenerateRequest {
  systemInstruction?: { parts: GeminiPart[] };
  contents: GeminiContent[];
  generationConfig?: {
    maxOutputTokens?: number;
    temperature?: number;
    /**
     * Gemini 2.5+ counts thinking tokens against maxOutputTokens. Uncapped
     * dynamic thinking can burn the whole budget and return empty visible text
     * (finishReason MAX_TOKENS with no parts) — which surfaces in chat as
     * "The companion returned an empty reply."
     */
    thinkingConfig?: {
      thinkingBudget?: number;
    };
  };
}

/**
 * Pick a thinking budget safe for companion chat.
 * - Flash / Flash-Lite: disable thinking (budget 0) so maxOutputTokens is
 *   available for the visible reply.
 * - Pro: cannot disable; use a modest budget and leave headroom in max tokens.
 * Override with ANIMA_GEMINI_THINKING_BUDGET (integer; use -1 for dynamic).
 */
export function thinkingBudgetForModel(model: string): number | undefined {
  const raw = process.env.ANIMA_GEMINI_THINKING_BUDGET?.trim();
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  const m = model.toLowerCase();
  if (m.includes("pro")) return 1024;
  // flash, flash-lite, and unknown chat models: disable thinking by default
  return 0;
}

function geminiApiKey(): string {
  const key =
    normalizeApiKey(process.env.GEMINI_API_KEY) ||
    normalizeApiKey(process.env.GOOGLE_API_KEY);
  if (!key) {
    throw new GeminiApiError(
      "GEMINI_API_KEY (or GOOGLE_API_KEY) must be set to use the Gemini provider.",
      { status: 401, code: "missing_api_key" },
    );
  }
  return key;
}

/** Native Generative Language API root (not the OpenAI-compatible path). */
export function geminiNativeBaseUrl(): string {
  const raw =
    process.env.GEMINI_NATIVE_BASE_URL?.trim() ||
    process.env.GEMINI_BASE_URL?.trim() ||
    "https://generativelanguage.googleapis.com/v1beta";
  return raw.replace(/\/openai\/?$/i, "").replace(/\/+$/, "");
}

function messageText(content: ChatCompletionMessageParam["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "type" in part) {
        if (part.type === "text" && "text" in part) return String(part.text || "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Convert OpenAI chat messages to a Gemini generateContent body.
 * System-only prompts (common in this codebase) become a single user turn so
 * Gemini always receives non-empty `contents`.
 */
export function toGeminiGenerateRequest(
  messages: ChatCompletionMessageParam[],
  opts?: { maxTokens?: number; temperature?: number; model?: string },
): GeminiGenerateRequest {
  const systemChunks: string[] = [];
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    const text = messageText(message.content).trim();
    if (!text) continue;

    if (message.role === "system" || message.role === "developer") {
      systemChunks.push(text);
      continue;
    }

    const role: "user" | "model" =
      message.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push({ text });
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  const systemText = systemChunks.join("\n\n").trim();
  let systemAsUserContent = false;
  if (contents.length === 0) {
    // Chat / evolution often send a single system prompt with history baked in.
    if (!systemText) {
      throw new GeminiApiError("Gemini request has no message content.", {
        status: 400,
        code: "empty_messages",
      });
    }
    contents.push({ role: "user", parts: [{ text: systemText }] });
    systemAsUserContent = true;
  }

  // Gemini rejects histories that start with a model turn.
  if (contents[0]?.role === "model") {
    contents.unshift({
      role: "user",
      parts: [{ text: "(continue)" }],
    });
  }

  const body: GeminiGenerateRequest = { contents };
  if (systemText && !systemAsUserContent) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const generationConfig: GeminiGenerateRequest["generationConfig"] = {};
  if (typeof opts?.maxTokens === "number" && opts.maxTokens > 0) {
    generationConfig.maxOutputTokens = opts.maxTokens;
  }
  if (typeof opts?.temperature === "number") {
    generationConfig.temperature = opts.temperature;
  }
  const thinkingBudget = thinkingBudgetForModel(opts?.model || "");
  if (typeof thinkingBudget === "number") {
    generationConfig.thinkingConfig = { thinkingBudget };
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }
  return body;
}

/** Visible reply text only — skip Gemini "thought" parts. */
export function extractCandidateText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0]) return "";
  const content = (candidates[0] as { content?: { parts?: unknown } }).content;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      // Thought summaries must not be shown as the companion reply.
      if ("thought" in part && (part as { thought?: unknown }).thought) {
        return "";
      }
      return "text" in part ? String((part as { text?: unknown }).text || "") : "";
    })
    .join("");
}

export function extractFinishReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || !candidates[0]) return undefined;
  const reason = (candidates[0] as { finishReason?: unknown }).finishReason;
  return typeof reason === "string" ? reason : undefined;
}

async function readErrorBody(res: Response): Promise<{
  message: string;
  code?: string;
}> {
  const raw = await res.text().catch(() => "");
  if (!raw) {
    return { message: `${res.status} status code (no body)` };
  }
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; status?: string; code?: number | string };
      message?: string;
    };
    const message =
      parsed.error?.message ||
      parsed.message ||
      raw;
    const code =
      typeof parsed.error?.status === "string"
        ? parsed.error.status
        : typeof parsed.error?.code === "string"
          ? parsed.error.code
          : undefined;
    return { message: String(message), code };
  } catch {
    return { message: raw };
  }
}

async function geminiFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new GeminiApiError(
      err instanceof Error ? err.message : `Gemini request failed: ${String(err)}`,
      { status: 502, code: "network_error", cause: err },
    );
  }
}

function openaiChunk(content: string): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id: "gemini-native",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "gemini",
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
}

function openaiCompletion(
  content: string,
  model: string,
): OpenAI.Chat.Completions.ChatCompletion {
  return {
    id: "gemini-native",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, refusal: null },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
  };
}

async function* parseGeminiSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedText = false;
  let lastFinishReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLines = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n").trim();
      if (!data || data === "[DONE]") continue;
      try {
        const payload = JSON.parse(data) as unknown;
        const finish = extractFinishReason(payload);
        if (finish) lastFinishReason = finish;
        const text = extractCandidateText(payload);
        if (text) {
          emittedText = true;
          yield openaiChunk(text);
        }
      } catch {
        // Ignore malformed SSE frames; continue reading the stream.
      }
    }
  }

  if (!emittedText) {
    const reason = lastFinishReason || "EMPTY";
    throw new GeminiApiError(
      `Gemini returned no visible text (finishReason=${reason}). ` +
        "Thinking tokens may have consumed maxOutputTokens — retry, or set " +
        "ANIMA_GEMINI_THINKING_BUDGET=0 for Flash models.",
      { status: 502, code: "empty_visible_text" },
    );
  }
}

export async function createGeminiChatCompletion(opts: {
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  if (!hasGeminiKey()) {
    throw new GeminiApiError(
      "GEMINI_API_KEY (or GOOGLE_API_KEY) must be set to use the Gemini provider.",
      { status: 401, code: "missing_api_key" },
    );
  }

  const apiKey = geminiApiKey();
  const body = toGeminiGenerateRequest(opts.messages, {
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    model: opts.model,
  });
  const url = `${geminiNativeBaseUrl()}/models/${encodeURIComponent(opts.model)}:generateContent`;

  const res = await geminiFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new GeminiApiError(err.message, {
      status: res.status,
      code: err.code,
    });
  }

  const payload = (await res.json()) as unknown;
  const text = extractCandidateText(payload);
  if (!text.trim()) {
    const reason = extractFinishReason(payload) || "EMPTY";
    throw new GeminiApiError(
      `Gemini returned no visible text (finishReason=${reason}). ` +
        "Thinking tokens may have consumed maxOutputTokens — retry, or set " +
        "ANIMA_GEMINI_THINKING_BUDGET=0 for Flash models.",
      { status: 502, code: "empty_visible_text" },
    );
  }
  return openaiCompletion(text, opts.model);
}

export async function createGeminiChatStream(opts: {
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
}): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  if (!hasGeminiKey()) {
    throw new GeminiApiError(
      "GEMINI_API_KEY (or GOOGLE_API_KEY) must be set to use the Gemini provider.",
      { status: 401, code: "missing_api_key" },
    );
  }

  const apiKey = geminiApiKey();
  const body = toGeminiGenerateRequest(opts.messages, {
    maxTokens: opts.maxTokens,
    model: opts.model,
  });
  const url = `${geminiNativeBaseUrl()}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;

  const res = await geminiFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await readErrorBody(res);
    throw new GeminiApiError(err.message, {
      status: res.status,
      code: err.code,
    });
  }

  if (!res.body) {
    throw new GeminiApiError("Gemini stream returned an empty body.", {
      status: 502,
      code: "empty_stream",
    });
  }

  return parseGeminiSse(res.body);
}

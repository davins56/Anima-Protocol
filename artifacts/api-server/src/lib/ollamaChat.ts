/**
 * Server-side adapter for Ollama's native POST /api/chat.
 *
 * Companion chat used to go through the OpenAI SDK against
 * `/v1/chat/completions`. Ollama's OpenAI layer drops `keep_alive` and is a
 * thinner wrapper around the same generate. This adapter talks to `/api/chat`
 * directly so conversation history, system/character instructions, keep_alive,
 * and streaming use the native contract.
 *
 * Model name and base URL come from API env only
 * (`ANIMA_OLLAMA_MODEL_STANDARD`, `ANIMA_LOCAL_LLM_BASE_URL` /
 * `OLLAMA_BASE_URL`). Never ship those values to the browser.
 */

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  localChatKeepAliveFields,
  ollamaNativeOrigin,
} from "./localLlmWarm";
import {
  hasLocalLlm,
  localLlmBaseUrl,
  normalizeApiKey,
} from "./openaiClient";

export const OLLAMA_UNAVAILABLE_HINT =
  "The Ollama model server is not running or not reachable. " +
  "Start it with `ollama serve` (or `pnpm llm:up`) and confirm " +
  "ANIMA_LOCAL_LLM_BASE_URL and ANIMA_OLLAMA_MODEL_STANDARD on the API host — " +
  "not in the browser.";

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface OllamaChatCompletionResult {
  content: string;
  model: string;
}

export interface OllamaChatConfig {
  origin: string | null;
  chatUrl: string | null;
  model: string;
}

/**
 * Native `/api/chat` is the default for the Ollama backend.
 * vLLM stays on the OpenAI-compatible `/v1` client.
 * Set ANIMA_OLLAMA_NATIVE_CHAT=0 to force the `/v1` client (tests / proxies).
 */
export function isOllamaNativeChatEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const backend = (env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase();
  if (backend === "vllm") return false;
  const flag = (env.ANIMA_OLLAMA_NATIVE_CHAT ?? "1").trim().toLowerCase();
  if (flag === "0" || flag === "off" || flag === "false" || flag === "no") {
    return false;
  }
  return hasLocalLlm(env);
}

export function resolveOllamaModelName(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.ANIMA_OLLAMA_MODEL_STANDARD?.trim() ||
    env.ANIMA_OLLAMA_MODEL?.trim() ||
    env.OLLAMA_MODEL?.trim() ||
    "anima-chat"
  );
}

export function resolveOllamaChatConfig(
  env: NodeJS.ProcessEnv = process.env,
): OllamaChatConfig {
  const base = localLlmBaseUrl(env);
  const origin = base ? ollamaNativeOrigin(base) : null;
  return {
    origin,
    chatUrl: origin ? `${origin}/api/chat` : null,
    model: resolveOllamaModelName(env),
  };
}

function ollamaAuthHeader(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const key =
    normalizeApiKey(env.ANIMA_LOCAL_LLM_API_KEY) ||
    normalizeApiKey(env.VLLM_API_KEY);
  if (!key || key === "local") return null;
  return `Bearer ${key}`;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const rec = part as { text?: unknown; content?: unknown };
          if (typeof rec.text === "string") return rec.text;
          if (typeof rec.content === "string") return rec.content;
        }
        return "";
      })
      .join("");
  }
  if (content == null) return "";
  return String(content);
}

function normalizeRole(role: unknown): OllamaChatMessage["role"] {
  if (role === "system" || role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return "user";
}

/** Map OpenAI-style chat messages onto Ollama's /api/chat messages array. */
export function toOllamaMessages(
  messages: ChatCompletionMessageParam[],
): OllamaChatMessage[] {
  const out: OllamaChatMessage[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = textFromContent(
      (message as { content?: unknown }).content,
    );
    out.push({
      role: normalizeRole((message as { role?: unknown }).role),
      content,
    });
  }
  return out;
}

function ollamaOptions(req: OllamaChatRequest): Record<string, number> {
  const options: Record<string, number> = {};
  if (typeof req.temperature === "number" && Number.isFinite(req.temperature)) {
    options.temperature = req.temperature;
  }
  if (typeof req.maxTokens === "number" && Number.isFinite(req.maxTokens)) {
    options.num_predict = Math.max(1, Math.floor(req.maxTokens));
  }
  return options;
}

function buildOllamaBody(
  req: OllamaChatRequest,
  stream: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toOllamaMessages(req.messages),
    stream,
    ...localChatKeepAliveFields(env),
  };
  const options = ollamaOptions(req);
  if (Object.keys(options).length > 0) {
    body.options = options;
  }
  return body;
}

export class OllamaChatError extends Error {
  status?: number;
  code?: string;
  constructor(
    message: string,
    opts: { status?: number; code?: string; cause?: unknown; connection?: boolean } = {},
  ) {
    super(message);
    this.name = opts.connection ? "APIConnectionError" : "OllamaChatError";
    this.status = opts.status;
    this.code = opts.code;
    if (opts.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = opts.cause;
    }
  }
}

function connectionError(cause: unknown): OllamaChatError {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { code?: unknown }).code || "")
      : "";
  const nested =
    cause && typeof cause === "object" && "cause" in cause
      ? (cause as { cause?: { code?: unknown } }).cause
      : undefined;
  const nestedCode = nested && typeof nested.code === "string" ? nested.code : "";
  return new OllamaChatError(OLLAMA_UNAVAILABLE_HINT, {
    connection: true,
    code: code || nestedCode || "ECONNREFUSED",
    cause,
  });
}

function errorFromHttp(status: number, raw: string): OllamaChatError {
  let detail = raw.trim();
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed?.error === "string" && parsed.error.trim()) {
      detail = parsed.error.trim();
    } else if (
      parsed?.error &&
      typeof parsed.error === "object" &&
      typeof (parsed.error as { message?: unknown }).message === "string"
    ) {
      detail = String((parsed.error as { message: string }).message);
    }
  } catch {
    // keep raw
  }
  const lower = detail.toLowerCase();
  const modelMissing =
    status === 404 ||
    lower.includes("model") && (lower.includes("not found") || lower.includes("does not exist"));
  if (status === 401 || status === 403) {
    return new OllamaChatError(
      `Ollama authentication failed (${status}). Check ANIMA_LOCAL_LLM_API_KEY on the API host.`,
      { status, code: "authentication_error" },
    );
  }
  if (modelMissing) {
    return new OllamaChatError(
      detail || `model not found (HTTP ${status})`,
      { status: status === 404 ? 404 : status, code: "model_not_found" },
    );
  }
  if (status === 502 || status === 503 || status === 504) {
    return new OllamaChatError(OLLAMA_UNAVAILABLE_HINT, {
      status,
      connection: true,
      code: "ECONNRESET",
    });
  }
  return new OllamaChatError(
    detail || `Ollama /api/chat failed (HTTP ${status})`,
    { status },
  );
}

async function postOllamaChat(
  req: OllamaChatRequest,
  stream: boolean,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const { chatUrl } = resolveOllamaChatConfig(env);
  if (!chatUrl) {
    throw new OllamaChatError(
      "ANIMA_LOCAL_LLM_BASE_URL is unset, so the API cannot reach Ollama. " +
        "Set it on the API host (for example http://localhost:11434/v1) — not in the browser.",
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: stream ? "application/x-ndjson, application/json" : "application/json",
  };
  const auth = ollamaAuthHeader(env);
  if (auth) headers.Authorization = auth;

  let res: Response;
  try {
    res = await fetchImpl(chatUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(buildOllamaBody(req, stream, env)),
      signal: req.signal,
    });
  } catch (err) {
    if (err && typeof err === "object") {
      const name = String((err as { name?: unknown }).name || "");
      if (name === "AbortError" || name === "TimeoutError") throw err;
    }
    throw connectionError(err);
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    throw errorFromHttp(res.status, raw);
  }
  return res;
}

function chunkFromOllamaLine(
  payload: Record<string, unknown>,
  fallbackModel: string,
): OpenAI.Chat.Completions.ChatCompletionChunk | null {
  if (typeof payload.error === "string" && payload.error.trim()) {
    throw new OllamaChatError(payload.error.trim(), { code: "api_error" });
  }
  const message =
    payload.message && typeof payload.message === "object"
      ? (payload.message as { content?: unknown })
      : {};
  const content = typeof message.content === "string" ? message.content : "";
  const done = payload.done === true;
  const model =
    typeof payload.model === "string" && payload.model.trim()
      ? payload.model
      : fallbackModel;
  const base = {
    id: "chatcmpl-ollama",
    object: "chat.completion.chunk" as const,
    created: 0,
    model,
  };
  if (done) {
    return {
      ...base,
      choices: [
        {
          index: 0,
          delta: content ? { content } : {},
          finish_reason: payload.done_reason === "length" ? "length" : "stop",
        },
      ],
    };
  }
  if (!content) return null;
  return {
    ...base,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
}

async function* iterateOllamaNdjson(
  body: ReadableStream<Uint8Array>,
  fallbackModel: string,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const chunk = chunkFromOllamaLine(
          parsed as Record<string, unknown>,
          fallbackModel,
        );
        if (chunk) yield chunk;
      }
    }
    const tail = buffer.trim();
    if (tail) {
      try {
        const parsed = JSON.parse(tail);
        if (parsed && typeof parsed === "object") {
          const chunk = chunkFromOllamaLine(
            parsed as Record<string, unknown>,
            fallbackModel,
          );
          if (chunk) yield chunk;
        }
      } catch {
        // ignore a trailing partial line
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function createOllamaChatStream(
  req: OllamaChatRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const res = await postOllamaChat(req, true, env, fetchImpl);
  if (!res.body) {
    throw new OllamaChatError("Ollama /api/chat returned an empty stream body");
  }
  return iterateOllamaNdjson(res.body, req.model);
}

export async function createOllamaChatCompletion(
  req: OllamaChatRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<OllamaChatCompletionResult> {
  const res = await postOllamaChat(req, false, env, fetchImpl);
  const raw = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    throw new OllamaChatError("Ollama /api/chat returned a non-JSON body");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new OllamaChatError("Ollama /api/chat returned an unexpected body");
  }
  const payload = parsed as {
    error?: unknown;
    model?: unknown;
    message?: { content?: unknown };
  };
  if (typeof payload.error === "string" && payload.error.trim()) {
    throw errorFromHttp(404, raw);
  }
  const content =
    typeof payload.message?.content === "string" ? payload.message.content : "";
  const model =
    typeof payload.model === "string" && payload.model.trim()
      ? payload.model
      : req.model;
  return { content, model };
}

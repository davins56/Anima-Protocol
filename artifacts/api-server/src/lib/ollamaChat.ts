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
import { combineAbortSignals } from "./chatTimeouts";
import {
  localChatKeepAliveFields,
  localLlmAuthorizationHeader,
  ollamaNativeOrigin,
  ollamaNumCtx,
} from "./localLlmWarm";
import {
  hasLocalLlm,
  localLlmBaseUrl,
} from "./openaiClient";
import { messagesForLocalOllama } from "./promptBuilder";

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
  /**
   * Raises the 200-token `num_predict` ceiling for one call. Deferred JSON
   * jobs use this. Chat replies leave it unset.
   */
  numPredictCeiling?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** Override `ANIMA_LOCAL_LLM_BASE_URL` for the backup host. */
  baseUrl?: string;
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

function normalizeOllamaModelName(name: string): string {
  return name.trim().toLowerCase().replace(/:latest$/, "");
}

/** True when `listed` is the configured tag, ignoring Ollama's `:latest` suffix. */
export function ollamaModelNamesMatch(wanted: string, listed: string): boolean {
  const want = normalizeOllamaModelName(wanted);
  const have = normalizeOllamaModelName(listed);
  return Boolean(want) && want === have;
}

function modelNamesFromOllamaList(body: unknown): string[] {
  const models = (body as { models?: unknown } | null)?.models;
  if (!Array.isArray(models)) return [];
  const names: string[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { name?: unknown; model?: unknown };
    const name =
      typeof rec.name === "string"
        ? rec.name
        : typeof rec.model === "string"
          ? rec.model
          : "";
    if (name.trim()) names.push(name.trim());
  }
  return names;
}

export interface OllamaModelPresence {
  /** True when the configured model is in `/api/ps` or `/api/tags`. */
  ok: boolean;
  models: string[];
  /** Which listing contained the model, when one did. */
  via: "ps" | "tags" | null;
  status?: number;
  message?: string;
  /**
   * Both list routes answered 404. The proxy in front of Ollama is not
   * forwarding `/api/ps` or `/api/tags`. The caller should use the tiny
   * generate probe instead of reporting the model missing.
   */
  listBlocked?: boolean;
}

async function discardResponseBody(response: Response): Promise<void> {
  const body = response.body;
  if (!body) return;
  try {
    await body.cancel();
  } catch {
    try {
      await response.arrayBuffer();
    } catch {
      // Already closed.
    }
  }
}

/**
 * Health check for the local Ollama host that does not generate.
 * A generate of "Reply with the single word: ok" replaces the cached
 * companion prompt. GET `/api/ps` first. A non-2xx answer is drained and
 * the probe continues with GET `/api/tags`, which the tunnel answers
 * without taking the model slot. `/api/tags` is also used when `/api/ps`
 * is 2xx but the model is installed and not loaded. Every list body is
 * read or cancelled.
 */
export async function probeOllamaModelListed(opts: {
  model: string;
  baseUrl?: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<OllamaModelPresence> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl?.trim() || localLlmBaseUrl(env);
  const origin = base ? ollamaNativeOrigin(base) : null;
  if (!origin) {
    return {
      ok: false,
      models: [],
      via: null,
      message: "ANIMA_LOCAL_LLM_BASE_URL is unset.",
    };
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  const auth = localLlmAuthorizationHeader(env);
  if (auth) headers.Authorization = auth;

  const read = async (
    path: "/api/ps" | "/api/tags",
  ): Promise<{ ok: boolean; status: number; models: string[] }> => {
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method: "GET",
        headers,
        signal: opts.signal,
      });
    } catch (err) {
      if (err && typeof err === "object") {
        const name = String((err as { name?: unknown }).name || "");
        if (name === "AbortError" || name === "TimeoutError") throw err;
      }
      throw connectionError(err);
    }
    // Read the body on every status. A 2xx is the model list. A non-2xx
    // still has to be drained before the /api/tags fallback, or before
    // the probe returns.
    let raw = "";
    try {
      raw = await response.text();
    } catch {
      await discardResponseBody(response);
    }
    if (!response.ok) {
      return { ok: false, status: response.status, models: [] };
    }
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = null;
    }
    return { ok: true, status: response.status, models: modelNamesFromOllamaList(body) };
  };

  const ps = await read("/api/ps");
  if (ps.ok && ps.models.some((name) => ollamaModelNamesMatch(opts.model, name))) {
    return { ok: true, models: ps.models, via: "ps", status: ps.status };
  }
  const tags = await read("/api/tags");
  const models = tags.models.length > 0 ? tags.models : ps.models;
  if (tags.ok && tags.models.some((name) => ollamaModelNamesMatch(opts.model, name))) {
    return { ok: true, models: tags.models, via: "tags", status: tags.status };
  }
  if (!ps.ok && !tags.ok) {
    const status = tags.status || ps.status;
    if (ps.status === 404 && tags.status === 404) {
      return {
        ok: false,
        models: [],
        via: null,
        status,
        listBlocked: true,
        message: "Ollama model list endpoints are not available.",
      };
    }
    throw new OllamaChatError(
      status
        ? `Ollama model list failed (HTTP ${status})`
        : "Ollama model list failed.",
      { status: status || undefined, connection: status === 0 },
    );
  }
  return {
    ok: false,
    models,
    via: null,
    status: tags.status || ps.status,
    message: `Model ${opts.model} is not listed by Ollama.`,
  };
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
  const normalized: Array<{ role: OllamaChatMessage["role"]; content: string }> = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    normalized.push({
      role: normalizeRole((message as { role?: unknown }).role),
      content: textFromContent((message as { content?: unknown }).content),
    });
  }
  // Fold on the original array's layout. Normalizing into `normalized`
  // first would miss companionLocalLayouts and send the volatile system
  // message on every turn.
  return messagesForLocalOllama(normalized, messages);
}

/**
 * Qwen2.5's published chat sampling (temperature 0.7, top_p 0.8, top_k 20,
 * repetition penalty 1.05). The old Modelfile ran top_p 0.92 with
 * repeat_penalty 1.1. Companion chat now asks for COMPANION_CHAT_TEMPERATURE
 * (one step under the 0.75 this ceiling used to apply to a 0.85 request).
 * Ensemble minds still ask up to 1.15 and stay clamped here.
 * On a 3B model that combination penalizes "the", "a", "to" out of the recent
 * window and samples the long tail: dropped articles, odd word swaps, and
 * stray Chinese tokens. Sent per request because the Fly volume keeps an
 * `anima-chat` built from whatever Modelfile existed on first boot.
 */
export const OLLAMA_CHAT_SAMPLING = {
  top_p: 0.8,
  top_k: 20,
  repeat_penalty: 1.05,
} as const;

/** Ceiling for caller temperatures. Override with ANIMA_OLLAMA_MAX_TEMPERATURE. */
export const OLLAMA_MAX_TEMPERATURE = 0.75;

/**
 * Companion chat reply temperature on the local model path.
 * The chat route used to request 0.85, and native Ollama clamped that to
 * this ceiling (0.75), so the model sampled companion replies at 0.75.
 * 0.65 is one 0.1 step below that applied temperature and stays under the
 * ceiling, so the clamp does not undo it. Journal, proactive, summaries,
 * and ensemble minds do not read this constant.
 */
export const COMPANION_CHAT_TEMPERATURE = 0.65;

/**
 * Hard ceiling for `num_predict` on every native Ollama call.
 * The droplet generates about 9 tokens/s on one vCPU (84 tokens in 9.4s).
 * A chat reply stays in the 160–200 token band so one turn is roughly
 * 18–22s of decode instead of holding the only slot for a long essay.
 * Warm-up calls pass 1 and stay under this cap.
 */
export const OLLAMA_NUM_PREDICT_CAP = 200;

export function capOllamaNumPredict(
  requested: number | undefined,
  ceiling: number = OLLAMA_NUM_PREDICT_CAP,
): number {
  const limit =
    Number.isFinite(ceiling) && ceiling > 0 ? Math.floor(ceiling) : OLLAMA_NUM_PREDICT_CAP;
  const raw =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : limit;
  return Math.min(Math.max(1, raw), limit);
}

function maxTemperature(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ANIMA_OLLAMA_MAX_TEMPERATURE);
  return Number.isFinite(raw) && raw > 0 ? raw : OLLAMA_MAX_TEMPERATURE;
}

function ollamaOptions(
  req: OllamaChatRequest,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, number> {
  const options: Record<string, number> = {
    ...OLLAMA_CHAT_SAMPLING,
    num_ctx: ollamaNumCtx(env),
    num_predict: capOllamaNumPredict(req.maxTokens, req.numPredictCeiling),
  };
  if (typeof req.temperature === "number" && Number.isFinite(req.temperature)) {
    options.temperature = Math.min(Math.max(req.temperature, 0), maxTemperature(env));
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
  body.options = ollamaOptions(req, env);
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
  const override = req.baseUrl?.trim();
  const chatUrl = override
    ? `${ollamaNativeOrigin(override)}/api/chat`
    : resolveOllamaChatConfig(env).chatUrl;
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
  const auth = localLlmAuthorizationHeader(env);
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
  isCancelled: () => boolean,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let sawDone = false;
  const emit = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (record.done === true) sawDone = true;
    return chunkFromOllamaLine(record, fallbackModel);
  };
  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const chunk = emit(line);
        if (chunk) yield chunk;
        if (sawDone) break;
      }
    }
    if (!sawDone) {
      const chunk = emit(buffer + decoder.decode());
      if (chunk) yield chunk;
    }
    // Ollama always ends a stream with a `done: true` line. Without it the
    // host or a proxy cut the connection mid-reply — surface that instead of
    // saving a truncated answer as if it were complete.
    if (!sawDone && !isCancelled()) {
      throw new OllamaChatError(
        "Ollama /api/chat stream ended before the reply finished",
        { connection: true, code: "ECONNRESET" },
      );
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
  // Own an abort handle for the whole stream. consumeLlmStream calls
  // `iterator.return()` when a reply stalls or runs past its budget; on a
  // generator parked in `reader.read()` that call only queues, so without an
  // abort the HTTP request stays open and Ollama keeps generating into a
  // closed turn — holding the model while the next user waits behind it.
  const upstream = new AbortController();
  const signal = req.signal
    ? combineAbortSignals(req.signal, upstream.signal)
    : upstream.signal;
  const res = await postOllamaChat({ ...req, signal }, true, env, fetchImpl);
  if (!res.body) {
    throw new OllamaChatError("Ollama /api/chat returned an empty stream body");
  }
  const chunks = iterateOllamaNdjson(
    res.body,
    req.model,
    () => upstream.signal.aborted,
  );
  const cancel = () => {
    if (!upstream.signal.aborted) upstream.abort();
  };
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => chunks.next(),
        async return(value?: unknown) {
          cancel();
          try {
            return await chunks.return(value as undefined);
          } catch {
            return { done: true as const, value: undefined };
          }
        },
        async throw(err?: unknown) {
          cancel();
          return chunks.throw(err);
        },
      };
    },
  };
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
    // An error inside a 200 body is not a 404. errorFromHttp still flags
    // "model … not found" from the message; anything else (out of memory,
    // context overflow) must not send failover hunting for another tag.
    throw errorFromHttp(500, raw);
  }
  const content =
    typeof payload.message?.content === "string" ? payload.message.content : "";
  const model =
    typeof payload.model === "string" && payload.model.trim()
      ? payload.model
      : req.model;
  return { content, model };
}

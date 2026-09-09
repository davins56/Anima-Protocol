import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { aiBinding } from "./aiBinding";
import { visibleAssistantReply } from "./visibleAssistantReply";

/** Production chat model — DeepSeek R1 distill via Workers AI + AI Gateway. */
export const WORKERS_AI_CHAT_MODEL =
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b";

/** wrangler.jsonc `ai.gateway.id` — documented here so healthz stays secret-free. */
export const WORKERS_AI_GATEWAY_ID = "deepseek-gateway";

/** Cloudflare Workers AI error when the free-plan 10k neurons/day cap is hit. */
export const WORKERS_AI_FREE_QUOTA_CODE = 4006;

/** Free-plan neuron budget advertised in the 4006 error body. */
export const WORKERS_AI_FREE_PLAN_NEURONS_PER_DAY = 10_000;

export const WORKERS_AI_FREE_QUOTA_HINT =
  "Workers AI daily free quota exhausted — enable Workers Paid or temporarily allow OpenRouter failover";

export const WORKERS_AI_USER_HINT =
  "DeepSeek on Workers AI failed to reply. Confirm the AI binding uses @cf/deepseek-ai/deepseek-r1-distill-qwen-32b via AI Gateway deepseek-gateway, then retry.";

const WORKERS_AI_FREE_QUOTA_RE =
  /\b4006\b|10[, ]?000 neurons|daily free (?:allocation|quota)|used up your daily free/i;

export class WorkersAiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkersAiRequestError";
  }
}

export function hasWorkersAiBinding(): boolean {
  return typeof aiBinding?.run === "function";
}

/** Isolate-local: after 4006, later turns skip DeepSeek and hop OpenRouter immediately. */
let workersAiQuotaExhaustedThisIsolate = false;

export function markWorkersAiQuotaExhausted(): void {
  workersAiQuotaExhaustedThisIsolate = true;
}

export function isWorkersAiQuotaExhaustedThisIsolate(): boolean {
  return workersAiQuotaExhaustedThisIsolate;
}

export function resetWorkersAiQuotaSkipForTests(): void {
  workersAiQuotaExhaustedThisIsolate = false;
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

function workersAiErrorHaystack(value: unknown, depth = 0): string {
  if (value == null || depth > 3) return "";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (typeof value !== "object") return "";
  const rec = value as Record<string, unknown>;
  const parts: unknown[] = [rec.code, rec.message, rec.error, rec.detail];
  if (Array.isArray(rec.errors)) {
    for (const item of rec.errors) {
      parts.push(workersAiErrorHaystack(item, depth + 1));
    }
  }
  if (rec.cause != null) parts.push(workersAiErrorHaystack(rec.cause, depth + 1));
  return parts.map((part) => (part == null ? "" : String(part))).join(" ");
}

/** True for Workers AI error 4006 (free-plan 10k neurons/day exhausted). */
export function isWorkersAiFreeQuotaError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "object") {
    const rec = err as { code?: unknown; errors?: unknown };
    if (rec.code === WORKERS_AI_FREE_QUOTA_CODE || rec.code === "4006") {
      return true;
    }
    if (Array.isArray(rec.errors)) {
      for (const item of rec.errors) {
        if (
          item &&
          typeof item === "object" &&
          ((item as { code?: unknown }).code === WORKERS_AI_FREE_QUOTA_CODE ||
            (item as { code?: unknown }).code === "4006")
        ) {
          return true;
        }
      }
    }
  }
  return WORKERS_AI_FREE_QUOTA_RE.test(workersAiErrorHaystack(err));
}

export type WorkersAiHttpFailure = {
  status: number;
  error: string;
  code: string;
};

/** Map a Workers AI binding failure to the /api/ai/chat JSON body. */
export function workersAiHttpFailure(err: unknown): WorkersAiHttpFailure {
  if (isWorkersAiFreeQuotaError(err)) {
    markWorkersAiQuotaExhausted();
    return {
      status: 429,
      error: WORKERS_AI_FREE_QUOTA_HINT,
      code: "workersai_free_quota_exhausted",
    };
  }
  return {
    status: 502,
    error: "The AI service is temporarily unavailable.",
    code: "ai_request_failed",
  };
}

export function formatWorkersAiError(err: unknown): string {
  if (isWorkersAiFreeQuotaError(err)) {
    markWorkersAiQuotaExhausted();
    return WORKERS_AI_FREE_QUOTA_HINT;
  }
  if (err instanceof WorkersAiRequestError) return err.message;
  const detail =
    err instanceof Error
      ? err.message.trim()
      : typeof err === "string"
        ? err.trim()
        : "";
  if (!detail) return WORKERS_AI_USER_HINT;
  if (isWorkersAiFreeQuotaError(detail)) return WORKERS_AI_FREE_QUOTA_HINT;
  if (/deepseek on workers ai/i.test(detail)) return detail;
  return `DeepSeek on Workers AI failed: ${detail}`;
}

function withWorkersAiErrorCode(code: unknown, message: string): string {
  if (code == null || code === "") return message;
  const codeText = String(code).trim();
  if (!codeText) return message;
  return message.includes(codeText) ? message : `${codeText}: ${message}`;
}

export function workersAiErrorMessage(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const rec = response as Record<string, unknown>;
  if (rec.success === false && Array.isArray(rec.errors) && rec.errors[0]) {
    const first = rec.errors[0] as Record<string, unknown>;
    const message = String(first.message || first.detail || "").trim();
    return withWorkersAiErrorCode(first.code, message || "Workers AI request failed");
  }
  if (rec.error != null) {
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
    if (typeof rec.error === "object") {
      const err = rec.error as Record<string, unknown>;
      const message = String(err.message || err.detail || "").trim();
      return withWorkersAiErrorCode(err.code, message || "Workers AI request failed");
    }
  }
  return null;
}

/** Alias kept for failover hop tests — same detector as isWorkersAiFreeQuotaError. */
export function isWorkersAiNeuronQuotaError(err: unknown): boolean {
  return isWorkersAiFreeQuotaError(err);
}

function throwIfWorkersAiError(response: unknown): void {
  if (isWorkersAiFreeQuotaError(response)) {
    throw new WorkersAiRequestError(WORKERS_AI_FREE_QUOTA_HINT);
  }
  const message = workersAiErrorMessage(response);
  if (message) {
    throw new WorkersAiRequestError(formatWorkersAiError(message));
  }
}

function openaiChoice(response: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(response.choices) || !response.choices[0]) return null;
  const choice = response.choices[0];
  return choice && typeof choice === "object"
    ? (choice as Record<string, unknown>)
    : null;
}

export function extractWorkersAiReasoning(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const rec = response as Record<string, unknown>;
  if (typeof rec.reasoning === "string") return rec.reasoning;
  if (typeof rec.reasoning_content === "string") return rec.reasoning_content;
  const choice = openaiChoice(rec);
  if (!choice) return "";
  const delta = choice.delta;
  if (delta && typeof delta === "object") {
    const inner = delta as Record<string, unknown>;
    if (typeof inner.reasoning === "string") return inner.reasoning;
    if (typeof inner.reasoning_content === "string") return inner.reasoning_content;
  }
  const message = choice.message;
  if (message && typeof message === "object") {
    const inner = message as Record<string, unknown>;
    if (typeof inner.reasoning === "string") return inner.reasoning;
    if (typeof inner.reasoning_content === "string") return inner.reasoning_content;
  }
  return "";
}

export function extractWorkersAiText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  throwIfWorkersAiError(response);
  const rec = response as Record<string, unknown>;
  if (typeof rec.response === "string") return rec.response;
  if (typeof rec.output === "string") return rec.output;
  if (typeof rec.text === "string") return rec.text;
  if (rec.result && typeof rec.result === "object") {
    throwIfWorkersAiError(rec.result);
    const inner = rec.result as Record<string, unknown>;
    if (typeof inner.response === "string") return inner.response;
    if (typeof inner.output === "string") return inner.output;
    if (typeof inner.text === "string") return inner.text;
  }
  const choice = openaiChoice(rec);
  if (choice) {
    const delta = choice.delta;
    if (delta && typeof delta === "object") {
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
    const message = choice.message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
  }
  return "";
}

function workersAiChunk(
  text: string,
  finish: boolean,
  reasoning = "",
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id: "workersai",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: WORKERS_AI_CHAT_MODEL,
    choices: [
      {
        index: 0,
        delta: {
          ...(text ? { content: text } : {}),
          ...(reasoning ? { reasoning } : {}),
        },
        finish_reason: finish ? "stop" : null,
      },
    ],
  };
}

function isReadableByteStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream;
}

function isByteChunk(part: unknown): part is Uint8Array | ArrayBuffer {
  return (
    part instanceof Uint8Array ||
    part instanceof ArrayBuffer ||
    (typeof Buffer !== "undefined" && Buffer.isBuffer(part))
  );
}

function bytesFromChunk(part: Uint8Array | ArrayBuffer): Uint8Array {
  if (part instanceof ArrayBuffer) return new Uint8Array(part);
  return part;
}

function* emitParsedSseLine(
  line: string,
): Generator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const trimmed = line.trim();
  if (!trimmed) return;
  const payload = trimmed.startsWith("data:")
    ? trimmed.slice(5).trim()
    : trimmed;
  if (!payload || payload === "[DONE]") return;
  try {
    const parsed = JSON.parse(payload) as unknown;
    const text = extractWorkersAiText(parsed);
    const reasoning = text ? "" : extractWorkersAiReasoning(parsed);
    if (text || reasoning) yield workersAiChunk(text, false, reasoning);
  } catch (err) {
    // 4006 / Workers AI error objects must not become "content" — that hid
    // the failure from llmFailover after stream-open already succeeded.
    if (err instanceof SyntaxError) {
      yield workersAiChunk(payload, false);
      return;
    }
    throw err;
  }
}

/**
 * Pull the first iterator result before createChatStreamWithFailover treats
 * Workers AI as open. Production `AI.run({ stream: true })` returns a
 * ReadableStream/Response immediately; 4006 arrives on first read.
 */
async function ensureWorkersAiStreamOpens(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const iterator = stream[Symbol.asyncIterator]();
  let first: IteratorResult<OpenAI.Chat.Completions.ChatCompletionChunk>;
  try {
    first = await iterator.next();
  } catch (err) {
    try {
      void iterator.return?.();
    } catch {
      // Ignore cancel failures; the hop path must still see the original error.
    }
    throw err;
  }

  async function* replay(): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
    try {
      if (!first.done) yield first.value;
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      try {
        void iterator.return?.();
      } catch {
        // Best-effort cancel.
      }
    }
  }

  return replay();
}

async function* iterateSseByteStream(
  readChunk: () => Promise<Uint8Array | ArrayBuffer | undefined>,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const value = await readChunk();
    if (!value) break;
    buf += decoder.decode(bytesFromChunk(value), { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      yield* emitParsedSseLine(line);
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield* emitParsedSseLine(buf);
  yield workersAiChunk("", true);
}

async function* iterateWorkersAiStream(
  response: unknown,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  if (typeof Response !== "undefined" && response instanceof Response) {
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new WorkersAiRequestError(
        formatWorkersAiError(
          body.trim() || `Workers AI stream failed (${response.status})`,
        ),
      );
    }
    yield* iterateWorkersAiStream(response.body);
    return;
  }

  // Prefer getReader() before Symbol.asyncIterator. WHATWG ReadableStream is
  // async-iterable and yields Uint8Array SSE bytes; treating those as JSON
  // objects produced an empty "success" and Chat showed "reply failed".
  if (isReadableByteStream(response)) {
    const reader = response.getReader();
    try {
      yield* iterateSseByteStream(async () => {
        const { done, value } = await reader.read();
        if (done) return undefined;
        return value;
      });
    } finally {
      reader.releaseLock();
    }
    return;
  }

  if (
    response &&
    typeof response === "object" &&
    Symbol.asyncIterator in (response as object)
  ) {
    const decoder = new TextDecoder();
    let buf = "";
    let byteMode = false;
    for await (const part of response as AsyncIterable<unknown>) {
      if (isByteChunk(part) || byteMode) {
        byteMode = true;
        if (!isByteChunk(part)) continue;
        buf += decoder.decode(bytesFromChunk(part), { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          yield* emitParsedSseLine(line);
        }
        continue;
      }
      const text =
        extractWorkersAiText(part) || (typeof part === "string" ? part : "");
      const reasoning = text ? "" : extractWorkersAiReasoning(part);
      if (text || reasoning) yield workersAiChunk(text, false, reasoning);
    }
    if (byteMode) {
      buf += decoder.decode();
      if (buf.trim()) yield* emitParsedSseLine(buf);
    }
    yield workersAiChunk("", true);
    return;
  }

  const text = extractWorkersAiText(response);
  const reasoning = text ? "" : extractWorkersAiReasoning(response);
  yield workersAiChunk(text, true, reasoning);
}

function requireWorkersAiBinding() {
  if (!aiBinding) {
    throw new WorkersAiRequestError(
      "Workers AI binding is not available. Confirm wrangler.jsonc binds AI through gateway deepseek-gateway, then redeploy.",
    );
  }
  return aiBinding;
}

function runOptions(
  opts: {
    messages: ChatCompletionMessageParam[];
    maxTokens: number;
    temperature?: number;
  },
  stream: boolean,
): Record<string, unknown> {
  return {
    messages: workersAiMessages(opts.messages),
    max_tokens: opts.maxTokens,
    ...(stream ? { stream: true } : {}),
    ...(typeof opts.temperature === "number"
      ? { temperature: opts.temperature }
      : {}),
  };
}

export async function completeWorkersAi(opts: {
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
}): Promise<string> {
  const binding = requireWorkersAiBinding();
  const response = await binding.run(
    WORKERS_AI_CHAT_MODEL,
    runOptions(opts, false),
  );
  const text = extractWorkersAiText(response);
  const reasoning = extractWorkersAiReasoning(response);
  const visible =
    visibleAssistantReply(text, { allowThinkFallback: true }).trim() ||
    visibleAssistantReply(reasoning, { allowThinkFallback: true }).trim();
  if (visible) return visible;
  throw new WorkersAiRequestError(
    "DeepSeek on Workers AI returned an empty reply. Please try again.",
  );
}

async function* withEmptyStreamFallback(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  opts: {
    messages: ChatCompletionMessageParam[];
    maxTokens: number;
    temperature?: number;
  },
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  let content = "";
  let pendingFinish: OpenAI.Chat.Completions.ChatCompletionChunk | null = null;
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (typeof delta === "string") content += delta;
    if (chunk.choices[0]?.finish_reason && !delta) {
      pendingFinish = chunk;
      continue;
    }
    yield chunk;
  }
  if (content.trim()) {
    if (pendingFinish) yield pendingFinish;
    return;
  }
  // Healthz uses the non-stream run and succeeds; if stream bytes were
  // unreadable, complete the same turn once so Chat still gets a reply.
  const text = await completeWorkersAi(opts);
  yield workersAiChunk(text, true);
}

export async function streamWorkersAi(opts: {
  messages: ChatCompletionMessageParam[];
  maxTokens: number;
  temperature?: number;
}): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const binding = requireWorkersAiBinding();
  try {
    const response = await binding.run(
      WORKERS_AI_CHAT_MODEL,
      runOptions(opts, true),
    );
    // Fail at stream-open so llmFailover can hop (e.g. 4006 neuron quota)
    // instead of returning a "successful" stream that throws on first read.
    if (typeof Response !== "undefined" && response instanceof Response && !response.ok) {
      const body = await response.text().catch(() => "");
      throw new WorkersAiRequestError(
        formatWorkersAiError(
          body.trim() || `Workers AI stream failed (${response.status})`,
        ),
      );
    }
    if (isWorkersAiFreeQuotaError(response)) {
      throw new WorkersAiRequestError(WORKERS_AI_FREE_QUOTA_HINT);
    }
    const errorMessage = workersAiErrorMessage(response);
    if (errorMessage) {
      throw new WorkersAiRequestError(formatWorkersAiError(errorMessage));
    }
    return await ensureWorkersAiStreamOpens(
      withEmptyStreamFallback(iterateWorkersAiStream(response), opts),
    );
  } catch (err) {
    if (err instanceof WorkersAiRequestError) throw err;
    if (isWorkersAiFreeQuotaError(err)) {
      markWorkersAiQuotaExhausted();
      throw new WorkersAiRequestError(WORKERS_AI_FREE_QUOTA_HINT);
    }
    if (isWorkersAiQuotaExhaustedThisIsolate()) {
      throw new WorkersAiRequestError(WORKERS_AI_FREE_QUOTA_HINT);
    }
    const text = await completeWorkersAi(opts).catch(() => "");
    if (text.trim()) return iterateWorkersAiStream({ response: text });
    throw new WorkersAiRequestError(formatWorkersAiError(err));
  }
}

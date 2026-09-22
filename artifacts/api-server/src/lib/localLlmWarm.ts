/**
 * Ollama keep-alive / warm hints for local-only chat.
 *
 * After #464 the provider chain is `["local"]` with no OpenRouter hop.
 * A cold anima-chat load is ~15–18s. `/chat/messages` already waits 45s
 * (`LLM_OPEN_TIMEOUT_LOCAL_ONLY_MS`); `/api/ai/chat` stays at 18s so it
 * finishes under the Worker ~20s wall. Do not hop to OpenRouter.
 *
 * Ollama's OpenAI `/v1/chat/completions` struct drops `keep_alive`, so the
 * field on the Worker body is not enough by itself. The public-v1 proxy
 * (`scripts/llm/public-v1/openai-proxy.py`) rewrites that route onto native
 * `/api/chat`, which honors it. Host `OLLAMA_KEEP_ALIVE` (default 30m here)
 * covers clients that still hit raw `/v1`. vLLM ignores keep_alive.
 *
 * A non-blocking native `/api/generate` warm still runs on Node while
 * `/chat/messages` loads context. It stays skipped on Cloudflare Workers
 * (#480) — an extra subrequest on the chat invocation burned the budget.
 * Failures are swallowed — this must never delay or fail a chat turn.
 */

import {
  hasLocalLlm,
  isCloudflareWorkerRuntime,
  localLlmBaseUrl,
  normalizeApiKey,
} from "./openaiClient";

export const DEFAULT_OLLAMA_KEEP_ALIVE = "30m";

const WARM_TIMEOUT_MS = 45_000;

let inFlightWarm: Promise<void> | null = null;
let lastWarmAt = 0;
const WARM_DEDUP_MS = 30_000;

export function ollamaKeepAliveDuration(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const backend = (env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase();
  if (backend === "vllm") return null;
  const raw = (env.ANIMA_OLLAMA_KEEP_ALIVE ?? DEFAULT_OLLAMA_KEEP_ALIVE).trim();
  if (!raw || raw === "0" || /^(off|false|no)$/i.test(raw)) return null;
  return raw;
}

/**
 * Extra body field on the OpenAI-compatible request.
 * Current Ollama drops it on `/v1/chat/completions`; the public-v1 proxy
 * copies it onto native `/api/chat`. Still send it from every local call.
 */
export function localChatKeepAliveFields(
  env: NodeJS.ProcessEnv = process.env,
): { keep_alive?: string } {
  const keepAlive = ollamaKeepAliveDuration(env);
  if (!keepAlive) return {};
  return { keep_alive: keepAlive };
}

export function ollamaNativeOrigin(openaiV1Url: string): string {
  const trimmed = openaiV1Url.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

function configuredOllamaModel(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.ANIMA_OLLAMA_MODEL_STANDARD?.trim() ||
    env.ANIMA_OLLAMA_MODEL?.trim() ||
    "anima-chat"
  );
}

function localLlmAuthHeader(env: NodeJS.ProcessEnv = process.env): string | null {
  const key =
    normalizeApiKey(env.ANIMA_LOCAL_LLM_API_KEY) ||
    normalizeApiKey(env.VLLM_API_KEY);
  if (!key || key === "local") return null;
  return `Bearer ${key}`;
}

/**
 * Best-effort: start loading anima-chat into RAM (Ollama empty-prompt generate)
 * without awaiting. Safe to call on every `/chat/messages` turn on Node.
 *
 * Skipped on Cloudflare Workers: the warm fetch shares the invocation's
 * subrequest budget with Hyperdrive and the actual `/v1/chat/completions`
 * open. When Fly is slow/wedged that extra hop is what trips
 * "Too many subrequests by single Worker invocation." keep_alive on the
 * generate itself (localChatKeepAliveFields) still keeps weights resident.
 */
export function hintLocalLlmWarm(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  globalObj: typeof globalThis = globalThis,
): void {
  if (isCloudflareWorkerRuntime(globalObj)) return;
  if (inFlightWarm) return;
  if (Date.now() - lastWarmAt < WARM_DEDUP_MS) return;
  if (!ollamaKeepAliveDuration(env)) return;
  if (!hasLocalLlm(env)) return;
  const v1 = localLlmBaseUrl(env);
  if (!v1) return;

  inFlightWarm = warmOnce(v1, env, fetchImpl).finally(() => {
    inFlightWarm = null;
  });
}

async function warmOnce(
  openaiV1Url: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<void> {
  const keepAlive = ollamaKeepAliveDuration(env);
  if (!keepAlive) return;
  const url = `${ollamaNativeOrigin(openaiV1Url)}/api/generate`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const auth = localLlmAuthHeader(env);
  if (auth) headers.Authorization = auth;

  try {
    await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: configuredOllamaModel(env),
        keep_alive: keepAlive,
      }),
      signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
    });
    lastWarmAt = Date.now();
  } catch {
    // Host down, path not exposed, or still loading — the chat generate owns the error.
  }
}

export function resetLocalLlmWarmForTests(): void {
  inFlightWarm = null;
  lastWarmAt = 0;
}

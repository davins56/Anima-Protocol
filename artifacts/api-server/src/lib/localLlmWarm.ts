/**
 * Ollama keep-alive / warm hints for local-only chat.
 *
 * After #464 the provider chain is `["local"]` with no OpenRouter hop.
 * `/chat/messages` waits `LLM_LOCAL_FIRST_TOKEN_MS` (90s) for CPU prefill;
 * `/api/ai/chat` stays at 18s so it finishes under the Worker ~20s wall.
 * Do not hop to OpenRouter.
 *
 * Do not send `keep_alive` unless `ANIMA_OLLAMA_KEEP_ALIVE` is set. A body
 * field overrides the droplet daemon (`OLLAMA_KEEP_ALIVE=-1` keeps the model
 * loaded). The old default of `30m` unloaded anima-chat half an hour after
 * the last request and forced a reload. vLLM ignores keep_alive.
 *
 * A non-blocking native `/api/generate` warm still runs on Node while
 * `/chat/messages` loads context. It stays skipped on Cloudflare Workers
 * (#480) — an extra subrequest on the chat invocation burned the budget.
 * Failures are swallowed — this must never delay or fail a chat turn.
 *
 * Signed-in app open uses a different path: `POST /api/llm/warm` is its own
 * request, so the one native generate does not share a chat turn's subrequest
 * budget. The browser may call that route at most once per session; this
 * module also skips the upstream call when a warm already succeeded recently.
 */

import { combineAbortSignals } from "./chatTimeouts";
import {
  hasLocalLlm,
  isCloudflareWorkerRuntime,
  localLlmBaseUrl,
  normalizeApiKey,
} from "./openaiClient";
import { companionLlmTurnOpen, localCallSignal } from "./sidecarLlm";

/**
 * Value operators can set on `ANIMA_OLLAMA_KEEP_ALIVE` when they want the
 * app to override the daemon. Not sent unless that env var is set.
 */
export const DEFAULT_OLLAMA_KEEP_ALIVE = "30m";

/** Empty `/api/generate` warm must not occupy the single Ollama slot. */
export const OLLAMA_WARM_NUM_PREDICT = 1;

/**
 * Context window sent on every Ollama call (chat, probe, warm).
 * Must match across those calls: a different `num_ctx` makes Ollama unload
 * and reload anima-chat. 8192 matches `scripts/llm/Modelfile.anima-chat`.
 * Override with `ANIMA_OLLAMA_NUM_CTX` when the droplet's model differs.
 */
export const OLLAMA_NUM_CTX = 8192;

export function ollamaNumCtx(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ANIMA_OLLAMA_NUM_CTX);
  if (Number.isFinite(raw) && raw >= 512) return Math.floor(raw);
  return OLLAMA_NUM_CTX;
}

const WARM_TIMEOUT_MS = 45_000;

/**
 * App-open preload cap. A cold anima-chat load is ~15–18s; aborting sooner
 * cancels that load. This stays well under the 45s chat-open budget.
 */
export const APP_OPEN_LLM_WARM_TIMEOUT_MS = 22_000;

/** Skip another preload after a successful native warm. */
export const APP_OPEN_LLM_WARM_COOLDOWN_MS = 5 * 60 * 1000;

/** Collapse repeats while the host is down or still timing out. */
export const APP_OPEN_LLM_WARM_FAILURE_BACKOFF_MS = 60_000;

let inFlightWarm: Promise<boolean | "busy"> | null = null;
let lastWarmAt = 0;
let lastSuccessfulWarmAt = 0;
let lastAppWarmFailureAt = 0;
const WARM_DEDUP_MS = 30_000;

export type AppOpenLlmWarmResult = {
  ok: boolean;
  warmed: boolean;
  skipped?: "recent" | "in_flight" | "unconfigured" | "busy";
};

/**
 * `keep_alive` for a native Ollama body. Omitted unless the operator set
 * `ANIMA_OLLAMA_KEEP_ALIVE`, so the droplet's `OLLAMA_KEEP_ALIVE` wins.
 */
export function ollamaKeepAliveDuration(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const backend = (env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase();
  if (backend === "vllm") return null;
  if (env.ANIMA_OLLAMA_KEEP_ALIVE == null) return null;
  const raw = String(env.ANIMA_OLLAMA_KEEP_ALIVE).trim();
  if (!raw || raw === "0" || /^(off|false|no)$/i.test(raw)) return null;
  return raw;
}

/**
 * Extra body field on the OpenAI-compatible request.
 * Omitted unless `ANIMA_OLLAMA_KEEP_ALIVE` is set. The public-v1 proxy
 * copies a present field onto native `/api/chat` and does not invent one.
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
    env.OLLAMA_MODEL?.trim() ||
    "anima-chat"
  );
}

/**
 * Bearer token for the local Ollama / vLLM host. Native `/api/chat` and the
 * list probe both send this. A key of `local` is the OpenAI SDK placeholder
 * for an open host and is not a password, so it is omitted.
 * Chat does not send Cloudflare Access service-token headers.
 */
export function localLlmAuthorizationHeader(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
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
 * "Too many subrequests by single Worker invocation."
 */
export function hintLocalLlmWarm(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  globalObj: typeof globalThis = globalThis,
): void {
  if (isCloudflareWorkerRuntime(globalObj)) return;
  if (companionLlmTurnOpen()) return;
  if (inFlightWarm) return;
  if (Date.now() - lastWarmAt < WARM_DEDUP_MS) return;
  if (!hasLocalLlm(env)) return;
  const v1 = localLlmBaseUrl(env);
  if (!v1) return;

  inFlightWarm = warmOnce(v1, env, fetchImpl, WARM_TIMEOUT_MS).finally(() => {
    inFlightWarm = null;
  });
}

/**
 * Load anima-chat for a signed-in app open. Own invocation — runs on Workers.
 * Never calls OpenRouter, OpenAI, or any other provider. Callers must not
 * put the model URL, key, or this result's internals on a browser-visible
 * error string.
 */
export async function warmLocalLlmForAppOpen(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  globalObj: typeof globalThis = globalThis,
): Promise<AppOpenLlmWarmResult> {
  if (companionLlmTurnOpen()) {
    return { ok: true, warmed: false, skipped: "busy" };
  }
  if (inFlightWarm) {
    return { ok: true, warmed: false, skipped: "in_flight" };
  }
  const now = Date.now();
  if (now - lastSuccessfulWarmAt < APP_OPEN_LLM_WARM_COOLDOWN_MS) {
    return { ok: true, warmed: false, skipped: "recent" };
  }
  if (now - lastAppWarmFailureAt < APP_OPEN_LLM_WARM_FAILURE_BACKOFF_MS) {
    return { ok: true, warmed: false, skipped: "recent" };
  }
  if (!hasLocalLlm(env, globalObj)) {
    return { ok: true, warmed: false, skipped: "unconfigured" };
  }
  const v1 = localLlmBaseUrl(env, globalObj);
  if (!v1) {
    return { ok: true, warmed: false, skipped: "unconfigured" };
  }

  const run = warmOnce(v1, env, fetchImpl, APP_OPEN_LLM_WARM_TIMEOUT_MS);
  inFlightWarm = run;
  try {
    const ok = await run;
    if (ok === "busy") return { ok: true, warmed: false, skipped: "busy" };
    if (!ok) lastAppWarmFailureAt = Date.now();
    return ok
      ? { ok: true, warmed: true }
      : { ok: false, warmed: false };
  } finally {
    if (inFlightWarm === run) inFlightWarm = null;
  }
}

async function warmOnce(
  openaiV1Url: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean | "busy"> {
  const keepAlive = ollamaKeepAliveDuration(env);
  const url = `${ollamaNativeOrigin(openaiV1Url)}/api/generate`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const auth = localLlmAuthorizationHeader(env);
  if (auth) headers.Authorization = auth;
  const body: Record<string, unknown> = {
    model: configuredOllamaModel(env),
    // Empty prompt + one token: preload weights without a long generate
    // sitting in front of the next chat turn.
    prompt: "",
    stream: false,
    options: { num_ctx: ollamaNumCtx(env), num_predict: OLLAMA_WARM_NUM_PREDICT },
  };
  if (keepAlive) body.keep_alive = keepAlive;
  // Dynamic import: llmFailover already imports this module for keep-alive.
  const { acquireLocalLlmBackground, localLlmSlotEnabled } = await import(
    "./localLlmSlot"
  );
  const slot = localLlmSlotEnabled(env)
    ? await acquireLocalLlmBackground("llm-warm", { job: "llm-warm" })
    : null;
  if (localLlmSlotEnabled(env) && !slot) return "busy";

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signals = [timeoutSignal];
  if (slot && "signal" in slot && slot.signal) signals.push(slot.signal);
  const background = localCallSignal();
  if (background) signals.push(background);
  const signal = combineAbortSignals(...signals);

  try {
    // Last check before the bytes leave. The slot flag is not a substitute
    // for the chat_turns ledger on another isolate.
    const { localChatActivityActive } = await import("./localLlmPriority");
    if (await localChatActivityActive()) return "busy";
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    await response.text().catch(() => "");
    lastWarmAt = Date.now();
    if (!response.ok) return false;
    lastSuccessfulWarmAt = Date.now();
    return true;
  } catch {
    // Host down, path not exposed, or still loading — the chat generate owns the error.
    return false;
  } finally {
    await slot?.release();
  }
}

export function resetLocalLlmWarmForTests(): void {
  inFlightWarm = null;
  lastWarmAt = 0;
  lastSuccessfulWarmAt = 0;
  lastAppWarmFailureAt = 0;
}

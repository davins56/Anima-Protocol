import OpenAI from "openai";
import { isCloudflareWorkerRuntime } from "@workspace/db";

/** Same Worker signal as `@workspace/db` — re-exported so LLM routing stays in lockstep. */
export { isCloudflareWorkerRuntime };

let openaiClient: OpenAI | null = null;
let openaiClientKey: string | null = null;

let localLlmClient: OpenAI | null = null;
let localLlmClientKey: string | null = null;

let openRouterClient: OpenAI | null = null;
let openRouterClientKey: string | null = null;
let minimaxClient: OpenAI | null = null;
let minimaxClientKey: string | null = null;

/** OpenRouter OpenAI-compatible base (chat completions + models). */
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Venice Uncensored — Cognitive Computations × Venice.ai (Dolphin Mistral 24B).
 * Reputable open-weight uncensored instruct model via OpenRouter.
 * @see https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition
 */
export const OPENROUTER_VENICE_UNCENSORED =
  "cognitivecomputations/dolphin-mistral-24b-venice-edition";

/**
 * Zero-cost OpenRouter free-tier model (not uncensored-branded).
 * Must stay on a slug that still appears in GET /api/v1/models `:free`
 * *and* accepts a live completion with a valid OpenRouter key.
 * `openai/gpt-oss-20b:free` was retired (404; paid slug is openai/gpt-oss-20b).
 * `google/gemma-4-31b-it:free` is still in the catalog, but the Google
 * provider returns HTTP 401 ("Request had invalid authentication credentials").
 * MiniMax m2.7 (`minimax/minimax-m2.7:free`) is still in the catalog, but
 * the production OpenRouter activity log for this account (2026-09-05)
 * showed repeated provider 429 / 502 on that slug and no Venice traffic.
 * Default is therefore m3:free; Gemma is the next hop; m2.7 is last.
 * Set ANIMA_OPENROUTER_FREE=true or override ANIMA_OPENROUTER_MODEL_STANDARD.
 */
export const OPENROUTER_FREE_M27_MODEL = "minimax/minimax-m2.7:free";
export const OPENROUTER_FREE_M3_MODEL = "minimax/minimax-m3:free";
export const OPENROUTER_FREE_MODEL = OPENROUTER_FREE_M3_MODEL;
export const MINIMAX_FREE_MODEL = "minimax/minimax-01:free";
export const JULES_FREE_MODEL = "google/gemma-3-12b-it:free";

/**
 * Ordered :free slugs to try after the preferred OpenRouter model fails
 * with a provider blip (not the account-wide free-models-per-day cap).
 * Healthier slugs first; m2.7 last because it is chronically 429/502.
 */
export const OPENROUTER_FREE_MODEL_CANDIDATES = [
  OPENROUTER_FREE_MODEL,
  JULES_FREE_MODEL,
  MINIMAX_FREE_MODEL,
  OPENROUTER_FREE_M27_MODEL,
] as const;

/** MiniMax Global OpenAI-compatible base URL. */
export const MINIMAX_BASE_URL = "https://api.minimax.io/v1";

/** Default MiniMax chat model. Override with ANIMA_MINIMAX_MODEL. */
export const MINIMAX_DEFAULT_MODEL = "MiniMax-M2.5";

/** Env names checked for a MiniMax key (first non-empty wins). */
export const MINIMAX_KEY_ENV_NAMES = [
  "MINIMAX_API_KEY",
  "ANIMA_MINIMAX_API_KEY",
] as const;

/** Env names checked for an OpenRouter key (first non-empty wins). */
export const OPENROUTER_KEY_ENV_NAMES = [
  "OPENROUTER_API_KEY",
  "ANIMA_OPENROUTER_API_KEY",
  "OPEN_ROUTER_API_KEY",
] as const;

/** Normalize env keys that were pasted with surrounding quotes or whitespace. */
export function normalizeApiKey(raw: string | undefined): string | null {
  if (!raw) return null;
  let key = raw.replace(/^\uFEFF/, "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  // Dashboard / curl pastes often include the Bearer prefix.
  if (/^bearer\s+/i.test(key)) {
    key = key.replace(/^bearer\s+/i, "").trim();
  }
  key = key.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "").trim();
  return key || null;
}

/** OpenAI key — used only for image generation/edit, never for chat. */
export function hasOpenAIKey(): boolean {
  return Boolean(normalizeApiKey(process.env.OPENAI_API_KEY));
}

/** Hosts that only exist on the same machine as the process. */
const LOOPBACK_LLM_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** ANIMA_RUNTIME values that must not invent or call loopback LLM URLs. */
const NO_LOOPBACK_ANIMA_RUNTIMES = new Set([
  "worker",
  "cloudflare",
  "cloudflare-workers",
  "vercel",
  "serverless",
  "edge",
]);

/** ANIMA_RUNTIME values that keep the local-dev localhost default. */
const LOOPBACK_OK_ANIMA_RUNTIMES = new Set(["node", "local", "dev", "docker"]);

/**
 * True on runtimes that cannot open loopback TCP (Workers isolate, Vercel,
 * Cloudflare Pages). Local Node / Docker keep the Ollama localhost default.
 *
 * Detection (first match wins):
 * - `ANIMA_RUNTIME=node|local|dev|docker` → loopback allowed (tests / VPS)
 * - `ANIMA_RUNTIME=worker|cloudflare|vercel|serverless|edge` → no loopback
 * - `VERCEL` / `VERCEL_ENV` / `CF_PAGES` → no loopback
 * - `isCloudflareWorkerRuntime()` (`navigator.userAgent === "Cloudflare-Workers"`)
 *
 * Do not treat `NODE_ENV=production` as no-loopback: a VPS can run Node
 * production next to Ollama on localhost.
 */
export function isLoopbackUnreachableRuntime(
  env: NodeJS.ProcessEnv = process.env,
  globalObj: typeof globalThis = globalThis,
): boolean {
  const runtime = (env.ANIMA_RUNTIME || "").trim().toLowerCase();
  if (runtime) {
    if (LOOPBACK_OK_ANIMA_RUNTIMES.has(runtime)) return false;
    if (NO_LOOPBACK_ANIMA_RUNTIMES.has(runtime)) return true;
  }
  if (env.VERCEL || env.VERCEL_ENV) return true;
  if (env.CF_PAGES) return true;
  return isCloudflareWorkerRuntime(globalObj);
}

/** True when hostname is loopback / unspecified (not reachable from Workers). */
export function isLoopbackLlmHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return LOOPBACK_LLM_HOSTS.has(h);
}

function urlLooksLoopback(raw: string): boolean {
  try {
    return isLoopbackLlmHost(new URL(raw).hostname);
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0/i.test(raw);
  }
}

/**
 * Operator-supplied OpenAI-compatible base URL, or null when unset.
 * Does not invent localhost and does not apply the serverless loopback guard.
 */
export function readExplicitLocalLlmBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const direct =
    env.ANIMA_LOCAL_LLM_BASE_URL?.trim() || env.VLLM_BASE_URL?.trim();
  if (direct) return direct.replace(/\/$/, "");
  const ollama = env.OLLAMA_BASE_URL?.trim();
  if (!ollama) return null;
  const root = ollama.replace(/\/$/, "");
  return root.endsWith("/v1") ? root : `${root}/v1`;
}

/**
 * Base URL for a local OpenAI-compatible server (vLLM, Ollama `/v1`, llama.cpp).
 * Prefers ANIMA_LOCAL_LLM_BASE_URL, then VLLM_BASE_URL, then Ollama's OpenAI path.
 * On Cloudflare Workers / Vercel / other no-loopback runtimes, localhost is
 * never invented — set ANIMA_LOCAL_LLM_BASE_URL to a public HTTPS host.
 * An explicit loopback URL on those runtimes is treated as unset (misconfigured)
 * so chat does not burn a turn on CF error 1003.
 */
export function localLlmBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  globalObj: typeof globalThis = globalThis,
): string | null {
  const explicit = readExplicitLocalLlmBaseUrl(env);
  if (explicit) {
    if (isLoopbackUnreachableRuntime(env, globalObj) && urlLooksLoopback(explicit)) {
      return null;
    }
    return explicit;
  }

  if (isLoopbackUnreachableRuntime(env, globalObj)) return null;

  return "http://localhost:11434/v1";
}

/** True when a usable (non-loopback-on-serverless) local LLM endpoint is set. */
export function hasLocalLlm(
  env: NodeJS.ProcessEnv = process.env,
  globalObj: typeof globalThis = globalThis,
): boolean {
  return Boolean(localLlmBaseUrl(env, globalObj));
}

/**
 * Hostnames of closed cloud chat APIs that must never be used as
 * ANIMA_LOCAL_LLM_BASE_URL. Chat only talks to a self-hosted Anima LLM
 * (Ollama / vLLM / llama.cpp). Pointing at these hosts with model tag
 * `anima-chat` produces OpenAI's "model does not exist" 404 in production.
 */
const CLOUD_FLAGSHIP_LLM_HOSTS = new Set([
  "api.openai.com",
  "openai.com",
  "api.groq.com",
  "groq.com",
  "generativelanguage.googleapis.com",
  "api.anthropic.com",
  "api.x.ai",
  "api.moonshot.ai",
  "api.moonshot.cn",
]);

/** True when hostname is a known closed cloud chat API (not a self-hosted Anima LLM). */
export function isCloudFlagshipLlmHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  if (CLOUD_FLAGSHIP_LLM_HOSTS.has(h)) return true;
  // Catch regional / CDN variants like eastus.api.openai.com
  for (const blocked of CLOUD_FLAGSHIP_LLM_HOSTS) {
    if (h.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

/**
 * Transport-level retries for the self-hosted endpoint. Tunables via
 * ANIMA_LOCAL_LLM_MAX_RETRIES (0 disables) for hosts where a retry is more
 * expensive than a failed turn — e.g. a single-slot GPU box.
 */
export function localLlmMaxRetries(): number {
  const raw = Number(process.env.ANIMA_LOCAL_LLM_MAX_RETRIES);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return 2;
}

/**
 * Transport-level retries for OpenRouter. Default 2 so a single provider
 * 502/503 or dropped connection does not kill the turn. The SDK only retries
 * connection errors and 408/409/429/5xx, and only before a stream starts.
 * Override with ANIMA_OPENROUTER_MAX_RETRIES (0 disables).
 */
export function openRouterMaxRetries(): number {
  const raw = Number(process.env.ANIMA_OPENROUTER_MAX_RETRIES);
  if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
  return 2;
}

export interface LocalLlmBaseUrlSummary {
  configured: boolean;
  host: string | null;
  hasV1Path: boolean;
  isHttps: boolean;
  isLocalhost: boolean;
  /** True when ANIMA_LOCAL_LLM_BASE_URL points at OpenAI/Groq/Gemini/etc. */
  isCloudFlagship: boolean;
  /**
   * True when the operator explicitly set a loopback URL on a runtime that
   * cannot reach loopback (Workers / Vercel). `configured` is false so the
   * provider chain skips `local` instead of attempting the fetch.
   */
  isLoopbackMisconfigured: boolean;
}

function describeLocalLlmBase(
  base: string | null,
  configured: boolean,
  isLoopbackMisconfigured: boolean,
): LocalLlmBaseUrlSummary {
  if (!base) {
    return {
      configured: false,
      host: null,
      hasV1Path: false,
      isHttps: false,
      isLocalhost: false,
      isCloudFlagship: false,
      isLoopbackMisconfigured,
    };
  }
  try {
    const url = new URL(base);
    const host = url.hostname || null;
    const path = (url.pathname || "").replace(/\/$/, "");
    const isLocalhost = isLoopbackLlmHost(host);
    return {
      configured,
      host,
      hasV1Path: path === "/v1" || path.endsWith("/v1"),
      isHttps: url.protocol === "https:",
      isLocalhost,
      isCloudFlagship: isCloudFlagshipLlmHost(host),
      isLoopbackMisconfigured,
    };
  } catch {
    const hostMatch = base.match(/^https?:\/\/([^/:]+)/i);
    const host = hostMatch?.[1] ?? null;
    return {
      configured,
      host,
      hasV1Path: /\/v1\/?$/.test(base),
      isHttps: /^https:/i.test(base),
      isLocalhost: urlLooksLoopback(base),
      isCloudFlagship: isCloudFlagshipLlmHost(host),
      isLoopbackMisconfigured,
    };
  }
}

/**
 * Secret-free summary of the configured local LLM base URL for healthz / logs.
 * Returns hostname + whether the path looks OpenAI-compatible (`/v1`).
 * On serverless, an invented or explicit localhost URL is not `configured`.
 */
export function summarizeLocalLlmBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  globalObj: typeof globalThis = globalThis,
): LocalLlmBaseUrlSummary {
  const explicit = readExplicitLocalLlmBaseUrl(env);
  const noLoopback = isLoopbackUnreachableRuntime(env, globalObj);
  const loopbackRejected = Boolean(explicit && noLoopback && urlLooksLoopback(explicit));
  if (loopbackRejected) {
    return describeLocalLlmBase(explicit, false, true);
  }
  const base = localLlmBaseUrl(env, globalObj);
  return describeLocalLlmBase(base, Boolean(base), false);
}

let loggedLocalLlmInit = false;

/** One-time operator log of local LLM routing (no API keys). */
export function logLocalLlmClientInitOnce(): void {
  if (loggedLocalLlmInit) return;
  loggedLocalLlmInit = true;
  const summary = summarizeLocalLlmBaseUrl();
  const backend =
    (process.env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase() ||
    "ollama";
  const model =
    process.env.ANIMA_OLLAMA_MODEL_STANDARD?.trim() ||
    process.env.ANIMA_VLLM_MODEL?.trim() ||
    "(default from registry)";
  if (summary.isLoopbackMisconfigured) {
    console.error(
      `[llm] MISCONFIGURED: ANIMA_LOCAL_LLM_BASE_URL host=${summary.host} is loopback, ` +
        `which this serverless runtime cannot reach (Cloudflare error 1003). ` +
        `Set ANIMA_LOCAL_LLM_BASE_URL to a public HTTPS OpenAI-compatible URL (…/v1), ` +
        `e.g. https://anima-chat-llm.fly.dev/v1. See deploy/ollama-fly/README.md.`,
    );
    return;
  }
  if (!summary.configured) {
    console.info(
      "[llm] ANIMA_LOCAL_LLM_BASE_URL unset — this runtime will not invent localhost. " +
        "Set a public HTTPS OpenAI-compatible URL (…/v1) and ANIMA_OLLAMA_MODEL_STANDARD, then redeploy. " +
        "See deploy/ollama-fly/README.md.",
    );
    return;
  }
  if (summary.isCloudFlagship) {
    console.error(
      `[llm] MISCONFIGURED: ANIMA_LOCAL_LLM_BASE_URL host=${summary.host} is a cloud flagship API. ` +
        `Chat requires a self-hosted Ollama/vLLM URL serving model=${model}. See docs/llm-deploy.md.`,
    );
    return;
  }
  console.info(
    `[llm] local client: host=${summary.host ?? "?"} https=${summary.isHttps} v1=${summary.hasV1Path} localhost=${summary.isLocalhost} backend=${backend} model=${model}`,
  );
}

/** Test helper — allow re-logging after env changes. */
export function resetLocalLlmInitLogForTests(): void {
  loggedLocalLlmInit = false;
}

/** OpenAI client — used only for image generation/edit, never for chat. */
export function getOpenAIClient(): OpenAI {
  const apiKey = normalizeApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be set.");
  }
  if (!openaiClient || openaiClientKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    openaiClientKey = apiKey;
  }
  return openaiClient;
}

/**
 * OpenAI-compatible client for local vLLM / Ollama / llama.cpp.
 * Returns null when no local base URL is configured.
 */
export function getLocalLlmClient(): OpenAI | null {
  const baseURL = localLlmBaseUrl();
  if (!baseURL) {
    logLocalLlmClientInitOnce();
    return null;
  }
  const apiKey =
    normalizeApiKey(process.env.ANIMA_LOCAL_LLM_API_KEY) ||
    normalizeApiKey(process.env.VLLM_API_KEY) ||
    "local";
  const cacheKey = `${baseURL}::${apiKey}`;
  if (!localLlmClient || localLlmClientKey !== cacheKey) {
    localLlmClient = new OpenAI({
      apiKey,
      baseURL,
      // Self-hosted endpoints are usually reached over a tunnel (cloudflared,
      // Fly, a VPS reverse proxy), where a dropped connection or a cold-start
      // 502 is routine. With no retries every one of those killed a chat turn
      // outright. The SDK only retries connection errors and 408/409/429/5xx,
      // and only before a stream has started, so this cannot duplicate a
      // partially-delivered reply.
      maxRetries: localLlmMaxRetries(),
    });
    localLlmClientKey = cacheKey;
    logLocalLlmClientInitOnce();
  }
  return localLlmClient;
}

/** OpenRouter API key — free signup at https://openrouter.ai/keys */
export function hasOpenRouterKey(): boolean {
  return Boolean(getOpenRouterApiKey());
}

export function getOpenRouterApiKey(): string | null {
  for (const name of OPENROUTER_KEY_ENV_NAMES) {
    const key = normalizeApiKey(process.env[name]);
    if (key) return key;
  }
  return null;
}

/** Which env var supplied the OpenRouter key (secret-free). */
export function getOpenRouterApiKeySource(): string | null {
  for (const name of OPENROUTER_KEY_ENV_NAMES) {
    if (normalizeApiKey(process.env[name])) return name;
  }
  return null;
}

/** Last 4 characters of the configured OpenRouter key, or null. */
export function openRouterKeyFingerprint(): string | null {
  const key = getOpenRouterApiKey();
  if (!key || key.length < 8) return null;
  return key.slice(-4);
}

/** MiniMax API key, using the same OpenAI-compatible chat contract. */
export function getMinimaxApiKey(): string | null {
  for (const name of MINIMAX_KEY_ENV_NAMES) {
    const key = normalizeApiKey(process.env[name]);
    if (key) return key;
  }
  return null;
}

export function hasMinimaxKey(): boolean {
  return Boolean(getMinimaxApiKey());
}

export function getMinimaxApiKeySource(): string | null {
  for (const name of MINIMAX_KEY_ENV_NAMES) {
    if (normalizeApiKey(process.env[name])) return name;
  }
  return null;
}

/** OpenAI-compatible MiniMax Global client for chat. */
export function getMinimaxClient(): OpenAI | null {
  const apiKey = getMinimaxApiKey();
  if (!apiKey) return null;
  const baseURL = (
    process.env.ANIMA_MINIMAX_BASE_URL?.trim() ||
    process.env.MINIMAX_BASE_URL?.trim() ||
    MINIMAX_BASE_URL
  ).replace(/\/$/, "");
  const cacheKey = `${baseURL}::${apiKey}`;
  if (!minimaxClient || minimaxClientKey !== cacheKey) {
    minimaxClient = new OpenAI({ apiKey, baseURL, maxRetries: 0 });
    minimaxClientKey = cacheKey;
    console.info(`[llm] minimax client: base_url=${baseURL}`);
  }
  return minimaxClient;
}

/**
 * OpenAI-compatible OpenRouter client for free / uncensored open-weight chat.
 * Returns null when no OpenRouter key is configured.
 */
export function getOpenRouterClient(): OpenAI | null {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) return null;
  const baseURL = (
    process.env.ANIMA_OPENROUTER_BASE_URL?.trim() || OPENROUTER_BASE_URL
  ).replace(/\/$/, "");
  const referer =
    process.env.ANIMA_OPENROUTER_HTTP_REFERER?.trim() ||
    "https://www.anima-protocol.com";
  const title =
    process.env.ANIMA_OPENROUTER_APP_TITLE?.trim() || "Anima Protocol";
  const cacheKey = `${baseURL}::${apiKey}::${referer}::${title}`;
  if (!openRouterClient || openRouterClientKey !== cacheKey) {
    openRouterClient = new OpenAI({
      apiKey,
      baseURL,
      maxRetries: openRouterMaxRetries(),
      defaultHeaders: {
        "HTTP-Referer": referer,
        "X-Title": title,
      },
    });
    openRouterClientKey = cacheKey;
    console.info(
      `[llm] openrouter client: host=openrouter.ai uncensored=${OPENROUTER_VENICE_UNCENSORED}`,
    );
  }
  return openRouterClient;
}

/** Test helper — clears cached SDK clients between cases. */
export function resetLlmClientsForTests(): void {
  openaiClient = null;
  openaiClientKey = null;
  localLlmClient = null;
  localLlmClientKey = null;
  openRouterClient = null;
  openRouterClientKey = null;
  minimaxClient = null;
  minimaxClientKey = null;
  resetLocalLlmInitLogForTests();
}

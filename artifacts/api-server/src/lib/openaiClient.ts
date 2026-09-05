import OpenAI from "openai";

let openaiClient: OpenAI | null = null;
let openaiClientKey: string | null = null;

let localLlmClient: OpenAI | null = null;
let localLlmClientKey: string | null = null;

let openRouterClient: OpenAI | null = null;
let openRouterClientKey: string | null = null;

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
 * Set ANIMA_OPENROUTER_FREE=true or override ANIMA_OPENROUTER_MODEL_STANDARD.
 */
export const OPENROUTER_FREE_MODEL = "openai/gpt-oss-20b:free";
export const MINIMAX_FREE_MODEL = "minimax/minimax-01:free";
export const JULES_FREE_MODEL = "google/gemma-3-12b-it:free";

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

/**
 * Base URL for a local OpenAI-compatible server (vLLM, Ollama `/v1`, llama.cpp).
 * Prefers ANIMA_LOCAL_LLM_BASE_URL, then VLLM_BASE_URL, then Ollama's OpenAI path.
 * On Vercel, localhost is never invented — set ANIMA_LOCAL_LLM_BASE_URL to a
 * public HTTPS host.
 */
export function localLlmBaseUrl(): string | null {
  const explicit =
    process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
    process.env.VLLM_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const ollama = process.env.OLLAMA_BASE_URL?.trim();
  if (ollama) {
    const root = ollama.replace(/\/$/, "");
    return root.endsWith("/v1") ? root : `${root}/v1`;
  }

  // Never invent localhost on Vercel / serverless — operators must set a public URL.
  if (process.env.VERCEL || process.env.VERCEL_ENV) return null;

  return "http://localhost:11434/v1";
}

/** True when a local OpenAI-compatible LLM endpoint is configured. */
export function hasLocalLlm(): boolean {
  return Boolean(localLlmBaseUrl());
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
 * Secret-free summary of the configured local LLM base URL for healthz / logs.
 * Returns hostname + whether the path looks OpenAI-compatible (`/v1`).
 */
export function summarizeLocalLlmBaseUrl(): {
  configured: boolean;
  host: string | null;
  hasV1Path: boolean;
  isHttps: boolean;
  isLocalhost: boolean;
  /** True when ANIMA_LOCAL_LLM_BASE_URL points at OpenAI/Groq/Gemini/etc. */
  isCloudFlagship: boolean;
} {
  const base = localLlmBaseUrl();
  if (!base) {
    return {
      configured: false,
      host: null,
      hasV1Path: false,
      isHttps: false,
      isLocalhost: false,
      isCloudFlagship: false,
    };
  }
  try {
    const url = new URL(base);
    const host = url.hostname || null;
    const path = (url.pathname || "").replace(/\/$/, "");
    const isLocalhost =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0";
    return {
      configured: true,
      host,
      hasV1Path: path === "/v1" || path.endsWith("/v1"),
      isHttps: url.protocol === "https:",
      isLocalhost,
      isCloudFlagship: isCloudFlagshipLlmHost(host),
    };
  } catch {
    const hostMatch = base.match(/^https?:\/\/([^/:]+)/i);
    const host = hostMatch?.[1] ?? null;
    return {
      configured: true,
      host,
      hasV1Path: /\/v1\/?$/.test(base),
      isHttps: /^https:/i.test(base),
      isLocalhost: /localhost|127\.0\.0\.1/i.test(base),
      isCloudFlagship: isCloudFlagshipLlmHost(host),
    };
  }
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
  if (!summary.configured) {
    console.info(
      "[llm] ANIMA_LOCAL_LLM_BASE_URL unset — set a public HTTPS OpenAI-compatible URL (…/v1) and ANIMA_OLLAMA_MODEL_STANDARD, then redeploy. See docs/custom-llm.md.",
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
      maxRetries: 0,
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
  resetLocalLlmInitLogForTests();
}

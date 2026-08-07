import OpenAI from "openai";

let openaiClient: OpenAI | null = null;
let openaiClientKey: string | null = null;

let xaiClient: OpenAI | null = null;
let xaiClientKey: string | null = null;

let geminiClient: OpenAI | null = null;
let geminiClientKey: string | null = null;

let kimiClient: OpenAI | null = null;
let kimiClientKey: string | null = null;

let groqClient: OpenAI | null = null;
let groqClientKey: string | null = null;

let gatewayClient: OpenAI | null = null;
let gatewayClientKey: string | null = null;

let localLlmClient: OpenAI | null = null;
let localLlmClientKey: string | null = null;

/** Normalize env keys that were pasted with surrounding quotes or whitespace. */
export function normalizeApiKey(raw: string | undefined): string | null {
  if (!raw) return null;
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key || null;
}

/**
 * Auth for Vercel AI Gateway (OpenAI-compatible). Prefers AI_GATEWAY_API_KEY;
 * on Vercel deployments falls back to the auto-injected OIDC token.
 */
export function gatewayAuthToken(): string | null {
  return (
    normalizeApiKey(process.env.AI_GATEWAY_API_KEY) ||
    normalizeApiKey(process.env.VERCEL_OIDC_TOKEN)
  );
}

export function hasOpenAIKey(): boolean {
  return Boolean(normalizeApiKey(process.env.OPENAI_API_KEY));
}

export function hasXaiKey(): boolean {
  return Boolean(normalizeApiKey(process.env.XAI_API_KEY));
}

export function hasGeminiKey(): boolean {
  return Boolean(
    normalizeApiKey(process.env.GEMINI_API_KEY) ||
      normalizeApiKey(process.env.GOOGLE_API_KEY),
  );
}

/** Moonshot / Kimi Open Platform key (`KIMI_API_KEY` or `MOONSHOT_API_KEY`). */
export function hasKimiKey(): boolean {
  return Boolean(
    normalizeApiKey(process.env.KIMI_API_KEY) ||
      normalizeApiKey(process.env.MOONSHOT_API_KEY),
  );
}

/** Groq Cloud OpenAI-compatible key (`GROQ_API_KEY`). */
export function hasGroqKey(): boolean {
  return Boolean(normalizeApiKey(process.env.GROQ_API_KEY));
}

/** True when Vercel AI Gateway can authenticate (API key or OIDC). */
export function hasGatewayAuth(): boolean {
  return Boolean(gatewayAuthToken());
}

/**
 * Base URL for a local OpenAI-compatible server (vLLM, Ollama `/v1`, llama.cpp).
 * Prefers ANIMA_LOCAL_LLM_BASE_URL, then VLLM_BASE_URL, then Ollama's OpenAI path.
 *
 * Product default is custom/local. Cloud-only modes (auto/gemini/…) never get a
 * localhost Ollama URL. On Vercel, localhost is never invented — set
 * ANIMA_LOCAL_LLM_BASE_URL to a public HTTPS host.
 */
export function localLlmBaseUrl(): string | null {
  const explicit =
    process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
    process.env.VLLM_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const raw = (process.env.ANIMA_LLM_PROVIDER || "").trim();
  const mode = raw.toLowerCase();
  const looksLikeKey =
    /^(AQ\.|sk-|xai-|AIza|Bearer\s)/i.test(raw) || raw.length > 32;
  const cloudOnly =
    !looksLikeKey &&
    (mode === "auto" ||
      mode === "gemini" ||
      mode === "groq" ||
      mode === "kimi" ||
      mode === "xai" ||
      mode === "openai" ||
      mode === "gateway" ||
      mode === "ensemble");
  if (cloudOnly) return null;

  const forceOllama =
    process.env.ANIMA_USE_OLLAMA_OPENAI === "1" ||
    process.env.ANIMA_USE_OLLAMA_OPENAI === "true";
  const customLike =
    !raw ||
    looksLikeKey ||
    mode === "local" ||
    mode === "custom" ||
    mode === "anima" ||
    mode === "local-first" ||
    mode === "ollama" ||
    mode === "vllm";
  if (!customLike && !forceOllama) return null;

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
 * Secret-free summary of the configured local LLM base URL for healthz / logs.
 * Returns hostname + whether the path looks OpenAI-compatible (`/v1`).
 */
export function summarizeLocalLlmBaseUrl(): {
  configured: boolean;
  host: string | null;
  hasV1Path: boolean;
  isHttps: boolean;
  isLocalhost: boolean;
} {
  const base = localLlmBaseUrl();
  if (!base) {
    return {
      configured: false,
      host: null,
      hasV1Path: false,
      isHttps: false,
      isLocalhost: false,
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
    };
  } catch {
    return {
      configured: true,
      host: null,
      hasV1Path: /\/v1\/?$/.test(base),
      isHttps: /^https:/i.test(base),
      isLocalhost: /localhost|127\.0\.0\.1/i.test(base),
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
      "[llm] custom/local mode: ANIMA_LOCAL_LLM_BASE_URL unset — set a public HTTPS OpenAI-compatible URL (…/v1) and ANIMA_OLLAMA_MODEL_STANDARD, then redeploy. See docs/custom-llm.md.",
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

/** OpenAI-compatible xAI (Grok) client. Returns null when XAI_API_KEY is unset. */
export function getXaiClient(): OpenAI | null {
  const apiKey = normalizeApiKey(process.env.XAI_API_KEY);
  if (!apiKey) return null;
  if (!xaiClient || xaiClientKey !== apiKey) {
    xaiClient = new OpenAI({
      apiKey,
      baseURL: process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1",
    });
    xaiClientKey = apiKey;
  }
  return xaiClient;
}

/**
 * @deprecated Chat uses the native Generative Language API in `geminiNative.ts`
 * so AQ.* AI Studio auth keys work. Kept only for any legacy callers/tests.
 */
export function getGeminiClient(): OpenAI | null {
  const apiKey =
    normalizeApiKey(process.env.GEMINI_API_KEY) ||
    normalizeApiKey(process.env.GOOGLE_API_KEY);
  if (!apiKey) return null;
  if (!geminiClient || geminiClientKey !== apiKey) {
    geminiClient = new OpenAI({
      apiKey,
      baseURL:
        process.env.GEMINI_BASE_URL?.trim() ||
        "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    geminiClientKey = apiKey;
  }
  return geminiClient;
}

/**
 * OpenAI-compatible Moonshot / Kimi client.
 * Accepts KIMI_API_KEY or MOONSHOT_API_KEY. Returns null when neither is set.
 */
export function getKimiClient(): OpenAI | null {
  const apiKey =
    normalizeApiKey(process.env.KIMI_API_KEY) ||
    normalizeApiKey(process.env.MOONSHOT_API_KEY);
  if (!apiKey) return null;
  if (!kimiClient || kimiClientKey !== apiKey) {
    kimiClient = new OpenAI({
      apiKey,
      baseURL:
        process.env.KIMI_BASE_URL?.trim() ||
        process.env.MOONSHOT_BASE_URL?.trim() ||
        "https://api.moonshot.ai/v1",
      // Moonshot Tier-0 accounts can burn RPM on SDK auto-retries after 429.
      maxRetries: 0,
    });
    kimiClientKey = apiKey;
  }
  return kimiClient;
}

/**
 * OpenAI-compatible Groq Cloud client.
 * Uses GROQ_API_KEY. Returns null when unset.
 */
export function getGroqClient(): OpenAI | null {
  const apiKey = normalizeApiKey(process.env.GROQ_API_KEY);
  if (!apiKey) return null;
  if (!groqClient || groqClientKey !== apiKey) {
    groqClient = new OpenAI({
      apiKey,
      baseURL:
        process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1",
      maxRetries: 0,
    });
    groqClientKey = apiKey;
  }
  return groqClient;
}

/**
 * OpenAI-compatible Vercel AI Gateway client.
 * Uses AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN. Returns null when neither is set.
 */
export function getGatewayClient(): OpenAI | null {
  const apiKey = gatewayAuthToken();
  if (!apiKey) return null;
  if (!gatewayClient || gatewayClientKey !== apiKey) {
    gatewayClient = new OpenAI({
      apiKey,
      baseURL:
        process.env.AI_GATEWAY_BASE_URL?.trim() ||
        "https://ai-gateway.vercel.sh/v1",
      maxRetries: 0,
    });
    gatewayClientKey = apiKey;
  }
  return gatewayClient;
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
      maxRetries: 0,
    });
    localLlmClientKey = cacheKey;
    logLocalLlmClientInitOnce();
  }
  return localLlmClient;
}

/** Test helper — clears cached SDK clients between cases. */
export function resetLlmClientsForTests(): void {
  openaiClient = null;
  openaiClientKey = null;
  xaiClient = null;
  xaiClientKey = null;
  geminiClient = null;
  geminiClientKey = null;
  kimiClient = null;
  kimiClientKey = null;
  groqClient = null;
  groqClientKey = null;
  gatewayClient = null;
  gatewayClientKey = null;
  localLlmClient = null;
  localLlmClientKey = null;
  resetLocalLlmInitLogForTests();
}

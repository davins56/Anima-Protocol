// Chat completion against the self-hosted Anima LLM (vLLM / Ollama /
// llama.cpp, OpenAI-compatible), with an optional OpenRouter fallback for
// free / uncensored open-weight models (Venice Uncensored by default).
//
// Flagship cloud chat APIs (Gemini, Groq, Kimi, Grok, ChatGPT, AI Gateway)
// are intentionally NOT used — OpenRouter is only for open-weight models.
//
// Local endpoint: ANIMA_LOCAL_LLM_BASE_URL (or VLLM_BASE_URL / OLLAMA_BASE_URL).
// OpenRouter: OPENROUTER_API_KEY (free signup at https://openrouter.ai/keys).
// See docs/custom-llm.md and docs/llm-deploy.md.
//
// Intra-provider "model unavailable" fallback (routed tier → standard → light)
// is preserved so a retired/unknown local model tag doesn't hard-fail a turn
// when a smaller sibling model is still loaded.

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  errorCodeLower,
  errorFieldLower,
  isModelUnavailableError,
  type ModelTier,
  type ResolvedModel,
} from "./modelRouter";
import {
  getLocalLlmClient,
  getMinimaxApiKeySource,
  getMinimaxClient,
  getOpenRouterApiKeySource,
  getOpenRouterClient,
  hasMinimaxKey,
  hasLocalLlm,
  hasOpenRouterKey,
  isLoopbackUnreachableRuntime,
  logLocalLlmClientInitOnce,
  OPENROUTER_FREE_MODEL,
  OPENROUTER_FREE_MODEL_CANDIDATES,
  OPENROUTER_VENICE_UNCENSORED,
  MINIMAX_DEFAULT_MODEL,
  openRouterCascadeMaxRetries,
  openRouterKeyFingerprint,
  summarizeLocalLlmBaseUrl,
} from "./openaiClient";
import {
  chooseLocalModel,
  describeModelMismatch,
  forgetModelSubstitution,
  getRememberedModel,
  listLocalModels,
  rememberModelSubstitution,
} from "./localModelCatalog";
import { getOpenWeightChatModel, resolveModelSpec } from "@workspace/llm";

const CLOUD_FLAGSHIP_SETUP_HINT =
  "ANIMA_LOCAL_LLM_BASE_URL points at a cloud chat API (e.g. api.openai.com), not a self-hosted Anima LLM. " +
  "Deploy Ollama/vLLM with the anima-chat model (see docs/llm-deploy.md), set " +
  "ANIMA_LOCAL_LLM_BASE_URL=https://<your-ollama-or-vllm-host>/v1 and ANIMA_OLLAMA_MODEL_STANDARD=anima-chat, then redeploy. " +
  "Or set MINIMAX_API_KEY for MiniMax chat, or OPENROUTER_API_KEY for OpenRouter.";

/** Self-hosted Anima LLM, or OpenRouter open-weight models (not flagship BYOK). */
export type LlmProviderId = "local" | "minimax" | "openrouter";

/** Brand for chat replies. */
export type LlmBrand = "anima" | "minimax" | "openrouter";

/** Public, secret-free snapshot of chat routing (for /api/healthz/llm). */
export interface LlmRoutingStatus {
  status: "ok" | "error";
  preferred: LlmProviderId | null;
  brand: LlmBrand;
  /**
   * Secret-free custom/local endpoint diagnostics. Host only — never the full
   * URL with credentials. Use this to confirm ANIMA_LOCAL_LLM_BASE_URL +
   * model on Vercel without opening the env UI.
   */
  localEndpoint: {
    configured: boolean;
    host: string | null;
    hasV1Path: boolean;
    isHttps: boolean;
    isLocalhost: boolean;
    /** True when base URL is OpenAI/Groq/Gemini/etc. (invalid for Anima chat). */
    isCloudFlagship: boolean;
    /**
     * True when the operator set a localhost/loopback URL on a runtime that
     * cannot reach loopback (Workers / Vercel). `configured` is false.
     */
    isLoopbackMisconfigured: boolean;
    backend: string;
    model: string;
  };
  /** Secret-free OpenRouter diagnostics. */
  openrouter: {
    configured: boolean;
    model: string;
    isFreeTier: boolean;
    /** Env var name that supplied the key (never the secret). */
    env: string | null;
    /** Last 4 chars of the key so operators can confirm which key is loaded. */
    keyTail: string | null;
    /** True when a paid model 402'd and later turns use the free-tier model. */
    creditFallback: boolean;
  };
  minimax: {
    configured: boolean;
    model: string;
    env: string | null;
  };
  /** Ordered provider chain for this process. */
  chain: LlmProviderId[];
  /**
   * True when ANIMA_LLM_PROVIDER is custom/local/anima — OpenRouter must not
   * take over chat even if a key is present.
   */
  customOnly: boolean;
  /**
   * True when OpenRouter may run after the custom LLM (explicit
   * ANIMA_OPENROUTER_FALLBACK=true). Default is false so a configured custom
   * LLM is never skipped for OpenRouter quota.
   */
  openRouterFallback: boolean;
  note: string;
}

/** Secret-free live probe result for a chat provider (for /api/healthz/llm?probe=1). */
export interface LlmProviderProbeResult {
  provider: LlmProviderId;
  configured: boolean;
  ok: boolean;
  status?: number;
  errorKind?: "auth" | "quota" | "connection" | "other";
  message?: string;
  /** Operator-facing fix when errorKind is auth or connection (secret-free). */
  hint?: string;
  /** The model the turn actually ran on (may differ from `configuredModel`). */
  model?: string;
  /** The tag from ANIMA_*_MODEL_* / the registry, before any discovery. */
  configuredModel?: string;
  /** Model ids the endpoint reports via `/v1/models` — empty if unsupported. */
  availableModels?: string[];
  latencyMs?: number;
}

export interface ChatStreamRequest {
  tier: ModelTier;
  model: string;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
  /** Cancel the in-flight stream open (e.g. a caller-side timeout). */
  signal?: AbortSignal;
}

export interface ChatStreamResult {
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  provider: LlmProviderId;
  brand: LlmBrand;
  model: string;
  tier: ModelTier;
  /** True when local failed and OpenRouter answered instead. */
  failedOver: boolean;
}

export interface ChatCompletionRequest {
  tier: ModelTier;
  model?: string;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
  /** Cancel the in-flight request (e.g. a caller-side timeout) instead of leaving it running server-side. */
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  content: string;
  provider: LlmProviderId;
  brand: LlmBrand;
  model: string;
  tier: ModelTier;
  /** True when local failed and OpenRouter answered instead. */
  failedOver: boolean;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null;
}

/** Every user chat turn starts fresh — kept as a no-op for API compatibility. */
export function beginChatProviderTurn(): void {
  // No sticky failover state exists anymore; nothing to reset.
}

/**
 * True when the operator pinned chat to the self-hosted custom LLM.
 * Docs (`docs/custom-llm.md`, `docs/llm-deploy.md`) tell operators to set
 * ANIMA_LLM_PROVIDER=custom so OpenRouter / free-tier quota cannot take over.
 */
export function preferCustomLlmOnly(): boolean {
  const raw = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
  return (
    raw === "custom" ||
    raw === "local" ||
    raw === "anima" ||
    raw === "local-only" ||
    raw === "local-first"
  );
}

/** True when the operator explicitly selected MiniMax instead of local chat. */
export function preferMinimaxOnly(): boolean {
  const raw = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
  return raw === "minimax" || raw === "minimax-only";
}

/**
 * OpenRouter may follow a configured custom LLM only when explicitly enabled.
 * Default is off: a working (or misconfigured) custom LLM must not be skipped
 * so that OpenRouter's free-models-per-day quota is burned instead.
 */
export function allowOpenRouterFallback(): boolean {
  if (preferCustomLlmOnly()) return false;
  const raw = (process.env.ANIMA_OPENROUTER_FALLBACK || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** True when the first usable chat provider is the self-hosted Anima LLM. */
export function isAnimaCustomMode(): boolean {
  const chain = getProviderChain();
  return chain.length === 0 || chain[0] === "local";
}

/** Prefer free OpenRouter models when ANIMA_OPENROUTER_FREE is truthy. */
export function preferOpenRouterFreeTier(): boolean {
  const raw = (process.env.ANIMA_OPENROUTER_FREE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "free";
}

export function isOpenRouterFreeModel(model: string): boolean {
  return model.trim().toLowerCase().endsWith(":free");
}

/**
 * Once OpenRouter confirms an account-level credit/payment failure on a paid
 * model, later turns in this isolate skip straight to the free-tier model so a
 * valid free key is not mistaken for "key not set".
 */
let openRouterCreditFallback = false;

export function isOpenRouterCreditFallback(): boolean {
  return openRouterCreditFallback;
}

/** Test helper — clear the in-process free-tier fallback. */
export function resetOpenRouterCreditFallbackForTests(): void {
  openRouterCreditFallback = false;
}

function resolveOpenRouterFamilyModel(): string | null {
  const family =
    process.env.ANIMA_OPENROUTER_MODEL_FAMILY?.trim() ||
    process.env.ANIMA_OPEN_WEIGHT_MODEL_FAMILY?.trim();
  return getOpenWeightChatModel(family)?.openRouterModel ?? null;
}

/** Resolve OpenRouter model for a tier (Venice Uncensored by default). */
export function resolveOpenRouterModel(tier: ModelTier): ResolvedModel {
  const tierKey = `ANIMA_OPENROUTER_MODEL_${tier.toUpperCase()}` as const;
  const fromTier = process.env[tierKey]?.trim();
  const fromStandard = process.env.ANIMA_OPENROUTER_MODEL_STANDARD?.trim();
  const fromFamily = resolveOpenRouterFamilyModel();
  let model =
    fromTier ||
    fromStandard ||
    fromFamily ||
    (preferOpenRouterFreeTier() ? OPENROUTER_FREE_MODEL : OPENROUTER_VENICE_UNCENSORED);
  if (openRouterCreditFallback && !isOpenRouterFreeModel(model)) {
    model = OPENROUTER_FREE_MODEL;
  }
  const maxTokens = tier === "light" ? 4096 : tier === "heavy" ? 16384 : 8192;
  return { tier, model, maxTokens };
}

/** Resolve MiniMax model for a tier. MiniMax uses one model unless overridden. */
export function resolveMinimaxModel(tier: ModelTier): ResolvedModel {
  const model =
    process.env[`ANIMA_MINIMAX_MODEL_${tier.toUpperCase()}`]?.trim() ||
    process.env.ANIMA_MINIMAX_MODEL?.trim() ||
    process.env.MINIMAX_MODEL?.trim() ||
    MINIMAX_DEFAULT_MODEL;
  const maxTokens = tier === "light" ? 4096 : tier === "heavy" ? 16384 : 8192;
  return { tier, model, maxTokens };
}

/** Resolve model for local vLLM / Ollama OpenAI-compatible serving. */
export function resolveLocalModel(tier: ModelTier): ResolvedModel {
  // Default to ollama (bootstrap anima-chat). Set ANIMA_LOCAL_LLM_BACKEND=vllm
  // for GPU Ministral / OpenAI-compatible vLLM serve.
  const backend = (process.env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase();
  const registryProvider = backend === "vllm" ? "vllm" : "ollama";
  const spec = resolveModelSpec(tier, registryProvider);
  return {
    tier,
    model: spec.model,
    maxTokens: spec.maxTokens,
  };
}

function localUsable(): boolean {
  return hasLocalLlm() && !cloudFlagshipMisconfigured();
}

/**
 * Ordered chat providers: self-hosted Anima first when configured.
 * OpenRouter is used when no custom LLM is configured (and a key is present),
 * or after local only when ANIMA_OPENROUTER_FALLBACK=true. Custom mode
 * (`ANIMA_LLM_PROVIDER=custom`) never includes OpenRouter.
 *
 * MiniMax Global sits after OpenRouter so exhausted :free hops (provider
 * 400/429/5xx) can fall through to the direct MiniMax API when a key is set.
 * `ANIMA_LLM_PROVIDER=minimax` keeps MiniMax-only.
 */
export function getProviderChain(): LlmProviderId[] {
  const chain: LlmProviderId[] = [];
  if (!preferMinimaxOnly() && localUsable()) chain.push("local");
  if (preferMinimaxOnly() && hasMinimaxKey()) {
    chain.push("minimax");
    return chain;
  }
  const openRouterAllowed =
    hasOpenRouterKey() &&
    !preferCustomLlmOnly() &&
    (chain.length === 0 || allowOpenRouterFallback());
  if (openRouterAllowed) chain.push("openrouter");
  if (hasMinimaxKey() && !preferCustomLlmOnly()) {
    chain.push("minimax");
  }
  return chain;
}

/**
 * OpenRouter may cover a down custom-LLM host, but auth / model / app errors
 * from that host must surface. Silently skipping them burns OpenRouter quota
 * and looks like the custom LLM was never tried.
 *
 * OpenRouter → MiniMax on hoppable provider blips (400/429/5xx) and on
 * OpenRouter ZDR / data-policy / guardrail exclusion (those bind only the
 * OpenRouter account; MiniMax Global is not affected). Daily/minute free
 * caps still stop the chain — another provider cannot raise that quota.
 */
function shouldTryNextProvider(
  provider: LlmProviderId,
  err: unknown,
  hasNext: boolean,
): boolean {
  if (!hasNext) return false;
  if (provider === "local" && !isProviderConnectionError(err)) return false;
  if (provider === "openrouter") {
    if (isOpenRouterZdrOrDataPolicyError(err)) return true;
    if (isOpenRouterAccountPolicyError(err)) return false;
    const model = attemptedOpenRouterModel(err) || OPENROUTER_FREE_MODEL;
    return shouldTryNextOpenRouterFreeModel(err, model);
  }
  return true;
}

function brandFor(provider: LlmProviderId): LlmBrand {
  return provider === "openrouter" ? "openrouter" : provider === "minimax" ? "minimax" : "anima";
}

/** Collect message / code / cause fragments without secrets (max ~200 chars). */
function summarizeError(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err.slice(0, 200);

  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  // Walk Error.cause so "Connection error." + SSL_ERROR_SYSCALL both show up.
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current.slice(0, 120));
      break;
    }
    if (typeof current !== "object") {
      parts.push(String(current).slice(0, 120));
      break;
    }
    const e = current as {
      name?: string;
      status?: number;
      code?: string;
      type?: string;
      message?: unknown;
      cause?: unknown;
    };
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (e.code) parts.push(String(e.code));
    else if (e.type) parts.push(String(e.type));
    if (e.message) parts.push(String(e.message).slice(0, 120));
    else if (e.name && e.name !== "Error") parts.push(e.name);
    current = e.cause;
  }

  if (!parts.length) return String(err).slice(0, 200);
  // Deduplicate near-identical fragments ("Connection error." twice).
  const uniq: string[] = [];
  for (const p of parts) {
    const norm = p.trim().toLowerCase();
    if (!norm) continue;
    if (uniq.some((u) => u.toLowerCase() === norm)) continue;
    uniq.push(p.trim());
  }
  return uniq.join(" — ").slice(0, 200);
}

/**
 * Shared operator hint when the self-hosted LLM rejects the bearer token.
 * Fly's Caddy proxy (`deploy/ollama-fly`) returns 401; some edges/proxies
 * surface the same failure as 403 with an empty body.
 */
export const LOCAL_LLM_AUTH_FIX_HINT =
  "ANIMA_LOCAL_LLM_API_KEY on the Cloudflare Worker (Secrets Store binding in wrangler.jsonc) " +
  "or Vercel must exactly match PROXY_AUTH_TOKEN on the LLM host " +
  "(for Fly: `fly secrets set PROXY_AUTH_TOKEN=… -a anima-chat-llm`, then set the same value " +
  "as ANIMA_LOCAL_LLM_API_KEY and redeploy). See deploy/ollama-fly/README.md.";

/**
 * Shared operator hint when the Worker / Vercel cannot open a TCP/TLS session
 * to the LLM host. Distinct from auth (401/403): the machine is down, sleeping,
 * or TLS is broken. A localhost URL on Workers is CF error 1003, not this hint.
 */
export const LOCAL_LLM_CONNECTION_FIX_HINT =
  "The self-hosted Anima LLM host did not accept a connection. " +
  "Check `fly status -a anima-chat-llm` / `fly logs -a anima-chat-llm`, then " +
  "`fly apps restart anima-chat-llm` or `fly deploy -a anima-chat-llm` " +
  "(see deploy/ollama-fly/README.md). Or set OPENROUTER_API_KEY for Venice Uncensored via OpenRouter.";

const OPENROUTER_SETUP_HINT =
  "Set OPENROUTER_API_KEY (free at https://openrouter.ai/keys). " +
  `Default model is Venice Uncensored (${OPENROUTER_VENICE_UNCENSORED}). ` +
  `A free key with no credits automatically falls back to ${OPENROUTER_FREE_MODEL}. ` +
  `To skip Venice entirely set ANIMA_OPENROUTER_FREE=true. ` +
  "Gemini/Groq/Kimi/Grok/ChatGPT are intentionally not used.";

const OPENROUTER_CREDITS_HINT =
  `Your OPENROUTER_API_KEY is configured, but this OpenRouter account has no credits ` +
  `for Venice Uncensored (${OPENROUTER_VENICE_UNCENSORED}). ` +
  `Add credits at https://openrouter.ai/settings/credits, or set ANIMA_OPENROUTER_FREE=true ` +
  `to use ${OPENROUTER_FREE_MODEL}.`;

const OPENROUTER_FREE_DAILY_HINT =
  "Today's free OpenRouter messages are used up. " +
  "Add $10 at https://openrouter.ai/settings/credits to unlock 1000 requests/day and paid models. " +
  "The free daily limit resets at midnight UTC.";

const OPENROUTER_FREE_MINUTE_HINT =
  "OpenRouter's free model per-minute limit is temporarily throttling chat. " +
  "Wait a minute and retry, or add credits at https://openrouter.ai/settings/credits for higher limits.";

/**
 * Used when chat is already on a :free model (ANIMA_OPENROUTER_FREE or an
 * explicit :free override). Never mentions Venice credits or setting
 * ANIMA_OPENROUTER_FREE — that advice is wrong and was the production toast.
 * Exported so SSE / tests can remap the raw OpenRouter wrapper.
 */
export const OPENROUTER_FREE_PROVIDER_HINT =
  `The OpenRouter free-tier model is temporarily unavailable ` +
  `(provider rejection, rate limit, or gateway error on ${OPENROUTER_FREE_MODEL} or a :free fallback). ` +
  `Retry shortly, or add credits at https://openrouter.ai/settings/credits for paid models.`;

export const MINIMAX_DIRECT_FAIL_HINT =
  "MiniMax Global (api.minimax.io) also failed after OpenRouter free-tier hops. " +
  "Check MINIMAX_API_KEY / ANIMA_MINIMAX_API_KEY and ANIMA_MINIMAX_MODEL, then retry, " +
  "or add OpenRouter credits at https://openrouter.ai/settings/credits.";

/**
 * User-facing copy when OpenRouter excludes every endpoint for ZDR / data
 * policy / guardrails and no later provider (MiniMax, local) answered.
 * Never include the raw multi-line OpenRouter dump ("0 endpoints out of…").
 */
export const OPENROUTER_ZDR_PRIVACY_HINT =
  "OpenRouter blocked this model because of your account's Zero Data Retention (ZDR) settings. " +
  "Allow the model (or turn off ZDR) at https://openrouter.ai/settings/privacy. " +
  "OpenRouter ZDR does not apply to MiniMax Global — set MINIMAX_API_KEY to keep chatting without changing OpenRouter privacy.";

const CONNECTION_CODE_RE =
  /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT)$/i;

/** True when the OpenAI SDK / undici could not reach the LLM host at all. */
export function isProviderConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // Auth failures are HTTP responses — never classify them as connection.
  if (isProviderAuthError(err)) return false;

  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current !== "object") break;
    const e = current as {
      name?: unknown;
      status?: number;
      code?: unknown;
      type?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    // A real HTTP status means we reached something — not a connect failure.
    if (typeof e.status === "number" && e.status > 0) return false;

    const name = errorFieldLower(e.name);
    const code = errorCodeLower(e);
    const msg = errorFieldLower(e.message);
    if (
      name.includes("apiconnectionerror") ||
      name.includes("connectionerror") ||
      CONNECTION_CODE_RE.test(code) ||
      msg.includes("connection error") ||
      msg.includes("fetch failed") ||
      msg.includes("socket hang up") ||
      msg.includes("network is unreachable") ||
      msg.includes("ssl_error_syscall") ||
      msg.includes("client network socket disconnected")
    ) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

/** True when the local server rejected auth (wrong/missing bearer token). */
export function isProviderAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: unknown; type?: unknown; message?: unknown };
  const code = errorCodeLower(e);
  const msg = errorFieldLower(e.message);
  if (code.includes("invalid_api_key") || code.includes("authentication_error") || code.includes("invalid_auth")) {
    return true;
  }
  if (
    msg.includes("incorrect api key") ||
    msg.includes("invalid api key") ||
    msg.includes("authentication") ||
    msg.includes("status code (no body)") ||
    msg.includes("401 status code") ||
    msg.includes("403 status code")
  ) {
    return true;
  }
  // 401 = standard unauthorized. 403 = some reverse proxies / edges reject a
  // bad bearer the same way (production probe against anima-chat-llm.fly.dev).
  return e.status === 401 || e.status === 403;
}

/** True when a provider reported quota / rate / billing exhaustion. */
export function isProviderQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: unknown; type?: unknown; message?: unknown };
  // 402 = OpenRouter "Insufficient credits" / payment required.
  if (e.status === 402 || e.status === 429) return true;
  const code = errorCodeLower(e);
  const msg = errorFieldLower(e.message);
  return (
    code.includes("rate_limit") ||
    code.includes("insufficient_quota") ||
    code.includes("payment_required") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("credits") ||
    msg.includes("payment required")
  );
}

/** True when OpenRouter specifically says the account needs credits/payment. */
function isOpenRouterCreditFallbackError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: unknown; type?: unknown; message?: unknown };
  const code = errorCodeLower(e);
  const msg = errorFieldLower(e.message);
  return (
    e.status === 402 ||
    code.includes("payment_required") ||
    msg.includes("insufficient credits") ||
    msg.includes("never purchased credits") ||
    msg.includes("add credits") ||
    msg.includes("payment required")
  );
}

/**
 * OpenRouter's account-wide cap on `:free` models (50/day without a $10
 * lifetime purchase, 1000/day after). Retrying another free model cannot
 * bypass this — it is the same quota.
 */
export function isOpenRouterFreeDailyLimitError(err: unknown): boolean {
  const hay = summarizeError(err).toLowerCase();
  return (
    hay.includes("free-models-per-day") ||
    hay.includes("free model requests per day")
  );
}

/** True when OpenRouter's free tier is throttling requests per minute. */
export function isOpenRouterFreeMinuteLimitError(err: unknown): boolean {
  const hay = summarizeError(err).toLowerCase();
  return (
    hay.includes("free-models-per-min") ||
    hay.includes("free model requests per minute")
  );
}

function httpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

/**
 * Transient OpenRouter gateway / transport failures that are worth retrying
 * on the same model before hopping to another :free candidate.
 */
export function isOpenRouterTransientGatewayError(err: unknown): boolean {
  if (isProviderConnectionError(err)) return true;
  const status = httpStatus(err);
  return status === 502 || status === 503 || status === 504;
}

/** True when chat is already routed to a :free OpenRouter model. */
export function isOpenRouterAlreadyFreeTier(model?: string): boolean {
  if (preferOpenRouterFreeTier() || openRouterCreditFallback) return true;
  if (model && isOpenRouterFreeModel(model)) return true;
  return isOpenRouterFreeModel(resolveOpenRouterModel("standard").model);
}

/**
 * Full error text (no 120-char summarizeError slice) so late phrases like
 * "ZDR violation" still match the production OpenRouter toast.
 */
function errorTextHaystack(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if (typeof current === "string") {
      parts.push(current);
      break;
    }
    if (typeof current !== "object") {
      parts.push(String(current));
      break;
    }
    const e = current as { message?: unknown; code?: unknown; type?: unknown; cause?: unknown };
    if (e.message != null) parts.push(String(e.message));
    if (e.code != null) parts.push(String(e.code));
    if (e.type != null) parts.push(String(e.type));
    current = e.cause;
  }
  return parts.join(" ").toLowerCase();
}

/**
 * OpenRouter account privacy / guardrail exclusion. Hopping other :free
 * slugs cannot fix this; MiniMax Global is not bound by it.
 * Detects the production toast: "ZDR violation", "guardrail restrictions",
 * "0 endpoints out of", "data policy".
 */
export function isOpenRouterZdrOrDataPolicyError(err: unknown): boolean {
  const hay = errorTextHaystack(err);
  return (
    hay.includes("zdr") ||
    hay.includes("zero data retention") ||
    hay.includes("data policy") ||
    hay.includes("data-policy") ||
    hay.includes("guardrail restrictions") ||
    hay.includes("guardrail restriction") ||
    hay.includes("0 endpoints out of") ||
    hay.includes("free model publication")
  );
}

/**
 * Account / privacy constraints that apply to every :free slug — hopping
 * cannot fix them (ZDR, data-policy mismatches, daily/minute free caps).
 */
export function isOpenRouterAccountPolicyError(err: unknown): boolean {
  return (
    isOpenRouterZdrOrDataPolicyError(err) ||
    isOpenRouterFreeDailyLimitError(err) ||
    isOpenRouterFreeMinuteLimitError(err)
  );
}

/**
 * OpenRouter's opaque wrapper ("400 Provider returned error") — never show
 * this raw string in the chat UI after hops are exhausted.
 */
export function isOpenRouterGenericProviderError(err: unknown): boolean {
  return summarizeError(err).toLowerCase().includes("provider returned error");
}

/**
 * Model-specific client / provider rejection (HTTP 400/404/422 or the
 * generic "Provider returned error" wrapper). Another live :free slug
 * may still complete. Account/policy errors are excluded.
 */
export function isOpenRouterModelSpecificClientError(err: unknown): boolean {
  if (isOpenRouterAccountPolicyError(err)) return false;
  const status = httpStatus(err);
  if (status === 400 || status === 404 || status === 422) return true;
  const hay = summarizeError(err).toLowerCase();
  if (!hay.includes("provider returned error")) return false;
  return status === 400 || status === 401 || status === 403 || status === undefined;
}

/**
 * Provider 400/429/5xx on a :free slug that is NOT an account-wide policy
 * or daily/minute cap. Another free model may still succeed.
 */
export function shouldTryNextOpenRouterFreeModel(err: unknown, candidateModel: string): boolean {
  if (isOpenRouterAccountPolicyError(err)) {
    return false;
  }
  if (!isOpenRouterFreeModel(candidateModel)) {
    return isProviderQuotaError(err);
  }
  if (isProviderQuotaError(err)) return true;
  if (isOpenRouterModelSpecificClientError(err)) return true;
  return isOpenRouterTransientGatewayError(err) || isOpenRouterProviderServerError(err);
}

function isOpenRouterProviderServerError(err: unknown): boolean {
  const status = httpStatus(err);
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/** True when the local server said the requested model isn't loaded / known. */
function isLocalModelUnavailable(err: unknown): boolean {
  return isModelUnavailableError(err);
}

/**
 * Model tags to try before asking the endpoint what it serves: a stand-in
 * learned on an earlier turn first (the endpoint already told us the
 * configured tag isn't there — re-asking just burns a round trip on every
 * message), then the configured tag, then the other tiers.
 */
function configuredCandidates(preferred: ResolvedModel): ResolvedModel[] {
  const seen = new Set<string>();
  const out: ResolvedModel[] = [];
  const push = (model: string | null | undefined) => {
    const id = (model || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ ...preferred, model: id });
  };
  push(getRememberedModel(preferred.model));
  push(preferred.model);
  push(resolveLocalModel("standard").model);
  push(resolveLocalModel("light").model);
  return out;
}

/**
 * Run a chat call against the first model tag the endpoint will accept.
 *
 * The single-model Ollama lineup collapses all three tiers onto one tag, so
 * the tier chain alone rescues nothing: if `anima-chat` isn't on the host,
 * every candidate is `anima-chat` and every turn 404s identically. When the
 * configured tags are exhausted this asks `/v1/models` and uses whatever the
 * host really serves, so a mis-tagged or freshly-provisioned box still holds
 * a conversation instead of failing every message.
 */
async function withModelFallback<T>(
  client: OpenAI,
  preferred: ResolvedModel,
  run: (resolved: ResolvedModel) => Promise<T>,
): Promise<{ value: T; resolved: ResolvedModel }> {
  const attempted = new Set<string>();
  let lastErr: unknown;

  const attempt = async (
    candidate: ResolvedModel,
  ): Promise<{ value: T; resolved: ResolvedModel } | null> => {
    if (attempted.has(candidate.model)) return null;
    attempted.add(candidate.model);
    try {
      const value = await run(candidate);
      if (candidate.model !== preferred.model) {
        rememberModelSubstitution(preferred.model, candidate.model);
      }
      return { value, resolved: candidate };
    } catch (err) {
      lastErr = err;
      // Anything other than "unknown model" (quota, auth, network, bad
      // request) is not fixed by trying a different tag — surface it as is.
      if (!isLocalModelUnavailable(err)) throw err;
      return null;
    }
  };

  for (const candidate of configuredCandidates(preferred)) {
    const hit = await attempt(candidate);
    if (hit) return hit;
  }

  // Every configured tag came back "unknown model" — including any stand-in
  // we had remembered, so drop that and re-read the host's real lineup.
  forgetModelSubstitution(preferred.model);
  const catalog = await listLocalModels(client, { force: true });
  const discovered = chooseLocalModel(preferred.model, catalog.models);
  if (discovered && !attempted.has(discovered)) {
    const hit = await attempt({ ...preferred, model: discovered });
    if (hit) {
      console.info(
        `[llm] "${preferred.model}" is not served by this endpoint — using "${discovered}" instead (found via /v1/models). Set ANIMA_OLLAMA_MODEL_STANDARD to silence this.`,
      );
      return hit;
    }
  }

  // Nothing on the host can hold a conversation. Fail with the fix, not just
  // the symptom: name the host, what it does serve, and the command to run.
  const explained = new Error(describeModelMismatch(preferred.model, catalog.models));
  (explained as Error & { cause?: unknown }).cause = lastErr;
  throw explained;
}

function cloudFlagshipMisconfigured(): boolean {
  return summarizeLocalLlmBaseUrl().isCloudFlagship;
}

function noProviderConfiguredError(): Error {
  if (preferCustomLlmOnly()) {
    return new Error(
      "ANIMA_LLM_PROVIDER=custom requires a self-hosted Anima LLM. " +
        "Set ANIMA_LOCAL_LLM_BASE_URL=https://<your-ollama-or-vllm-host>/v1 and " +
        "ANIMA_OLLAMA_MODEL_STANDARD=anima-chat, then redeploy. " +
        "OpenRouter is intentionally not used in custom mode. See docs/custom-llm.md.",
    );
  }
  return new Error(
    "No chat LLM configured. Host Ollama/vLLM with a public HTTPS OpenAI-compatible URL " +
      "(ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1, ANIMA_OLLAMA_MODEL_STANDARD=anima-chat), " +
      "or set MINIMAX_API_KEY for MiniMax chat (or OPENROUTER_API_KEY for OpenRouter). " +
      "Gemini/Groq/Kimi/Grok/ChatGPT are intentionally not used. " +
      "See docs/custom-llm.md.",
  );
}

function requireLocalClient(): OpenAI {
  if (cloudFlagshipMisconfigured()) {
    throw new Error(CLOUD_FLAGSHIP_SETUP_HINT);
  }
  const client = getLocalLlmClient();
  if (client) return client;
  throw new Error(
    "Anima custom LLM is not configured: ANIMA_LOCAL_LLM_BASE_URL is unset (or the endpoint is unreachable). " +
      "Host Ollama/vLLM with a public HTTPS OpenAI-compatible URL, set ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1 " +
      "and ANIMA_OLLAMA_MODEL_STANDARD=anima-chat (or your vLLM model id), then redeploy. " +
      "Or set MINIMAX_API_KEY for MiniMax chat, or OPENROUTER_API_KEY for OpenRouter. See docs/custom-llm.md and docs/llm-deploy.md.",
  );
}

function configuredLocalModelLabel(): string {
  return (
    process.env.ANIMA_OLLAMA_MODEL_STANDARD?.trim() ||
    process.env.ANIMA_VLLM_MODEL?.trim() ||
    resolveLocalModel("standard").model
  );
}

function localHostDownSuffix(include: boolean): string {
  if (!include) return "";
  const host = summarizeLocalLlmBaseUrl().host ?? "the self-hosted Anima LLM";
  if (host === "anima-chat-llm.fly.dev") {
    return ` The primary LLM host (${host}) is also unreachable — run \`fly apps restart anima-chat-llm\`.`;
  }
  return ` The primary LLM host (${host}) is also unreachable — check that the host is running and reachable from the Cloudflare Worker.`;
}

/** Operator hint when OpenRouter ran because the custom LLM was never wired. */
function customLlmSkippedSuffix(): string {
  if (localUsable()) return "";
  return (
    " The self-hosted custom Anima LLM is not configured on this deployment " +
    "(ANIMA_LOCAL_LLM_BASE_URL is unset), so chat used OpenRouter instead of your custom LLM. " +
    "Set ANIMA_LOCAL_LLM_BASE_URL=https://<your-ollama-or-vllm-host>/v1 and redeploy."
  );
}

function attemptedOpenRouterModel(err: unknown, opts: { attemptedModel?: string } = {}): string | undefined {
  if (opts.attemptedModel) return opts.attemptedModel;
  if (err && typeof err === "object" && "openRouterModel" in err) {
    const model = (err as { openRouterModel?: unknown }).openRouterModel;
    if (typeof model === "string" && model.trim()) return model;
  }
  return undefined;
}

function openRouterErrorDetail(err: unknown): string {
  if (isOpenRouterGenericProviderError(err)) return "";
  const summary = summarizeError(err).trim();
  return summary ? `${summary}. ` : "";
}

function openRouterFailureMessage(
  prefix: string,
  err: unknown,
  hint: string,
  opts: { localConnectionFailed?: boolean } = {},
): Error {
  const detail = openRouterErrorDetail(err);
  const head = detail ? `${prefix}: ${detail}${hint}` : `${prefix}. ${hint}`;
  return new Error(
    head +
      localHostDownSuffix(Boolean(opts.localConnectionFailed)) +
      customLlmSkippedSuffix(),
  );
}

function enrichError(
  err: unknown,
  provider: LlmProviderId = "local",
  opts: {
    localConnectionFailed?: boolean;
    attemptedModel?: string;
    openRouterHopsExhausted?: boolean;
    openRouterZdrBlocked?: boolean;
  } = {},
): Error {
  if (provider === "local" && cloudFlagshipMisconfigured()) {
    return new Error(CLOUD_FLAGSHIP_SETUP_HINT);
  }
  // ZDR / data-policy / guardrail exclusion: never surface OpenRouter's
  // multi-line "0 endpoints out of…" dump. MiniMax is not bound by this.
  if (
    opts.openRouterZdrBlocked ||
    (provider === "openrouter" && isOpenRouterZdrOrDataPolicyError(err))
  ) {
    return new Error(
      OPENROUTER_ZDR_PRIVACY_HINT +
        localHostDownSuffix(Boolean(opts.localConnectionFailed)) +
        customLlmSkippedSuffix(),
    );
  }
  // Remap the opaque wrapper before auth/quota so "401 Provider returned
  // error" is never mistaken for a bad OpenRouter key in the chat toast.
  if (
    provider === "openrouter" &&
    isOpenRouterGenericProviderError(err) &&
    !isOpenRouterAccountPolicyError(err)
  ) {
    return openRouterFailureMessage(
      "OpenRouter free-tier provider error",
      err,
      OPENROUTER_FREE_PROVIDER_HINT,
      opts,
    );
  }
  if (isProviderAuthError(err)) {
    if (provider === "openrouter") {
      return new Error(
        `OpenRouter authentication failed: ${summarizeError(err)}. Check OPENROUTER_API_KEY on the Cloudflare Worker Secrets Store (https://openrouter.ai/keys), then redeploy.`,
      );
    }
    if (provider === "minimax") {
      return new Error(
        `MiniMax authentication failed. Check MINIMAX_API_KEY / ANIMA_MINIMAX_API_KEY, then redeploy.`,
      );
    }
    return new Error(
      `Anima LLM authentication failed: ${summarizeError(err)}. ${LOCAL_LLM_AUTH_FIX_HINT}`,
    );
  }
  if (isProviderQuotaError(err)) {
    if (provider === "openrouter") {
      const alreadyFree = isOpenRouterAlreadyFreeTier(attemptedOpenRouterModel(err, opts));
      const hint = isOpenRouterFreeDailyLimitError(err)
        ? OPENROUTER_FREE_DAILY_HINT
        : isOpenRouterFreeMinuteLimitError(err)
          ? OPENROUTER_FREE_MINUTE_HINT
          : alreadyFree
            ? OPENROUTER_FREE_PROVIDER_HINT
            : hasOpenRouterKey()
              ? OPENROUTER_CREDITS_HINT
              : OPENROUTER_SETUP_HINT;
      const prefix = alreadyFree && !isOpenRouterFreeDailyLimitError(err)
        ? "OpenRouter free-tier provider error"
        : "OpenRouter credits/rate limit exhausted";
      return openRouterFailureMessage(prefix, err, hint, opts);
    }
  }
  if (provider === "openrouter" && isOpenRouterProviderServerError(err)) {
    const hint = isOpenRouterAlreadyFreeTier(attemptedOpenRouterModel(err, opts))
      ? OPENROUTER_FREE_PROVIDER_HINT
      : "Retry shortly. If this persists, try another OpenRouter model or add credits at https://openrouter.ai/settings/credits.";
    return openRouterFailureMessage("OpenRouter provider failed", err, hint, opts);
  }
  if (isProviderConnectionError(err)) {
    if (provider === "openrouter") {
      const hint = isOpenRouterAlreadyFreeTier(attemptedOpenRouterModel(err, opts))
        ? OPENROUTER_FREE_PROVIDER_HINT
        : "Check network egress to openrouter.ai, then retry.";
      return openRouterFailureMessage("OpenRouter connection failed", err, hint, opts);
    }
    const model = configuredLocalModelLabel();
    const host = summarizeLocalLlmBaseUrl().host ?? "?";
    return new Error(
      `Anima LLM connection failed for host=${host} model=${model}: ${summarizeError(err)}. ` +
        LOCAL_LLM_CONNECTION_FIX_HINT,
    );
  }
  if (provider === "local" && isLocalModelUnavailable(err)) {
    const model = configuredLocalModelLabel();
    const host = summarizeLocalLlmBaseUrl().host ?? "?";
    return new Error(
      `Anima LLM model "${model}" is not available on host=${host}: ${summarizeError(err)}. ` +
        `Create the model on that host (e.g. \`ollama create anima-chat\`) or set ANIMA_OLLAMA_MODEL_STANDARD to a model id the server actually serves. See docs/llm-deploy.md.`,
    );
  }
  if (
    provider === "openrouter" &&
    isOpenRouterModelSpecificClientError(err) &&
    !isOpenRouterAccountPolicyError(err)
  ) {
    return openRouterFailureMessage(
      "OpenRouter free-tier provider error",
      err,
      OPENROUTER_FREE_PROVIDER_HINT,
      opts,
    );
  }
  if (provider === "minimax") {
    if (opts.openRouterHopsExhausted) {
      return new Error(MINIMAX_DIRECT_FAIL_HINT);
    }
    return new Error(
      `MiniMax chat failed. Check MINIMAX_API_KEY / ANIMA_MINIMAX_API_KEY and ANIMA_MINIMAX_MODEL, then retry.`,
    );
  }
  const base = err instanceof Error ? err : new Error(String(err));
  return remapGenericProviderError(base);
}

/** Last-line remap so the raw OpenRouter wrapper cannot leave this module. */
export function remapGenericProviderError(err: Error): Error {
  if (isOpenRouterZdrOrDataPolicyError(err)) {
    return new Error(OPENROUTER_ZDR_PRIVACY_HINT);
  }
  if (!isOpenRouterGenericProviderError(err)) return err;
  return new Error(OPENROUTER_FREE_PROVIDER_HINT);
}

/** Secret-free routing diagnostic for operators and the chat UI. */
export function getLlmRoutingStatus(tier: ModelTier = "standard"): LlmRoutingStatus {
  const localSummary = summarizeLocalLlmBaseUrl();
  const backend = (process.env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase() || "ollama";
  const localModel =
    process.env.ANIMA_OLLAMA_MODEL_STANDARD?.trim() ||
    process.env.ANIMA_VLLM_MODEL?.trim() ||
    resolveLocalModel(tier).model;
  const openRouterModel = resolveOpenRouterModel(tier);
  const minimaxModel = resolveMinimaxModel(tier);
  const chain = getProviderChain();
  const isFreeTier = preferOpenRouterFreeTier() || openRouterModel.model.endsWith(":free");

  // Emit a one-time init line so Vercel logs show host/model without secrets.
  logLocalLlmClientInitOnce();

  const customOnly = preferCustomLlmOnly();
  const openRouterFallback = allowOpenRouterFallback();
  const noLoopback = isLoopbackUnreachableRuntime();
  const noteParts: string[] = [];
  if (localSummary.isLoopbackMisconfigured) {
    noteParts.push(
      "ANIMA_LOCAL_LLM_BASE_URL points at localhost/loopback, which this serverless runtime cannot reach " +
        "(Cloudflare Workers reject isolate fetch to localhost with error 1003). " +
        "Set ANIMA_LOCAL_LLM_BASE_URL to a public HTTPS OpenAI-compatible URL (…/v1), " +
        "e.g. https://anima-chat-llm.fly.dev/v1. See deploy/ollama-fly/README.md.",
    );
  }
  if (chain.length === 0) {
    if (localSummary.isCloudFlagship) {
      noteParts.push(CLOUD_FLAGSHIP_SETUP_HINT);
    } else if (customOnly) {
      noteParts.push(
        "ANIMA_LLM_PROVIDER=custom but ANIMA_LOCAL_LLM_BASE_URL is unset or unusable. " +
          "OpenRouter will not be used. Set a public HTTPS OpenAI-compatible URL and redeploy. " +
          "See deploy/ollama-fly/README.md.",
      );
    } else if (!localSummary.isLoopbackMisconfigured) {
      noteParts.push(
        noLoopback
          ? "ANIMA_LOCAL_LLM_BASE_URL is unset. This serverless runtime cannot invent or reach localhost. " +
            "Set ANIMA_LOCAL_LLM_BASE_URL to a public HTTPS OpenAI-compatible URL (…/v1), " +
            "or set MINIMAX_API_KEY for MiniMax chat (or OPENROUTER_API_KEY for OpenRouter). " +
            "See deploy/ollama-fly/README.md."
          : "No chat LLM configured. Set ANIMA_LOCAL_LLM_BASE_URL for self-hosted Anima LLM, " +
            "or MINIMAX_API_KEY for MiniMax chat (or OPENROUTER_API_KEY for OpenRouter). " +
            "Gemini/Groq/Kimi/Grok/ChatGPT are intentionally not used. See docs/custom-llm.md.",
      );
    }
  } else {
    if (chain.includes("local")) {
      noteParts.push(
        `Self-hosted Anima LLM at host=${localSummary.host ?? "?"} model=${localModel}.`,
      );
      if (localSummary.isLocalhost && noLoopback) {
        noteParts.push(
          "WARNING: local endpoint is localhost on a serverless runtime — it cannot be reached. Use a public HTTPS URL.",
        );
      } else if (!localSummary.isHttps && noLoopback) {
        noteParts.push("WARNING: local endpoint is not HTTPS — Worker/Vercel egress often requires https://…/v1.");
      } else if (!localSummary.hasV1Path) {
        noteParts.push("WARNING: base URL should end with /v1 for OpenAI-compatible chat/completions.");
      }
      if (hasOpenRouterKey() && !chain.includes("openrouter")) {
        noteParts.push(
          "OpenRouter key is present but unused — custom LLM is primary. " +
            "Set ANIMA_OPENROUTER_FALLBACK=true only if you want OpenRouter after a connection failure.",
        );
      }
    }
    if (chain.includes("minimax")) {
      const minimaxRole =
        chain[0] === "minimax"
          ? "primary cloud provider"
          : "fallback after OpenRouter free-tier hops";
      noteParts.push(`MiniMax model=${minimaxModel.model} (${minimaxRole}).`);
    }
    if (chain.includes("openrouter")) {
      noteParts.push(
        `OpenRouter ${isFreeTier ? "free-tier" : "uncensored"} model=${openRouterModel.model}` +
          (chain[0] === "local"
            ? " (fallback after local connection failure)."
            : " (primary — custom LLM not configured: ANIMA_LOCAL_LLM_BASE_URL is unset or unusable).") +
          (openRouterCreditFallback ? " Paid model needed credits; using free-tier." : ""),
      );
    }
  }

  const preferred = chain[0] ?? null;
  return {
    status: chain.length > 0 ? "ok" : "error",
    preferred,
    brand: preferred ? brandFor(preferred) : "anima",
    localEndpoint: {
      configured: localSummary.configured,
      host: localSummary.host,
      hasV1Path: localSummary.hasV1Path,
      isHttps: localSummary.isHttps,
      isLocalhost: localSummary.isLocalhost,
      isCloudFlagship: localSummary.isCloudFlagship,
      isLoopbackMisconfigured: localSummary.isLoopbackMisconfigured,
      backend,
      model: localModel,
    },
    openrouter: {
      configured: hasOpenRouterKey(),
      model: openRouterModel.model,
      isFreeTier,
      env: getOpenRouterApiKeySource(),
      keyTail: openRouterKeyFingerprint(),
      creditFallback: openRouterCreditFallback,
    },
    minimax: {
      configured: hasMinimaxKey(),
      model: minimaxModel.model,
      env: getMinimaxApiKeySource(),
    },
    chain,
    customOnly,
    openRouterFallback,
    note: noteParts.join(" "),
  };
}

async function probeOneProvider(
  provider: LlmProviderId,
  tier: ModelTier,
): Promise<LlmProviderProbeResult> {
  if (provider === "minimax") {
    if (!hasMinimaxKey()) {
      return { provider: "minimax", configured: false, ok: false };
    }
    const resolved = resolveMinimaxModel(tier);
    const started = Date.now();
    try {
      const client = getMinimaxClient();
      if (!client) return { provider: "minimax", configured: false, ok: false };
      await client.chat.completions.create({
        model: resolved.model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        temperature: 0,
      });
      return {
        provider: "minimax",
        configured: true,
        ok: true,
        model: resolved.model,
        configuredModel: resolved.model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      const status = err && typeof err === "object" && "status" in err
        ? Number((err as { status?: unknown }).status)
        : undefined;
      const auth = isProviderAuthError(err);
      const connection = !auth && isProviderConnectionError(err);
      const quota = !auth && !connection && isProviderQuotaError(err);
      return {
        provider: "minimax",
        configured: true,
        ok: false,
        status: Number.isFinite(status) ? status : undefined,
        errorKind: auth ? "auth" : connection ? "connection" : quota ? "quota" : "other",
        message: summarizeError(err),
        model: resolved.model,
        configuredModel: resolved.model,
        latencyMs: Date.now() - started,
      };
    }
  }

  if (provider === "openrouter") {
    if (!hasOpenRouterKey()) {
      return { provider: "openrouter", configured: false, ok: false };
    }
    const resolved = resolveOpenRouterModel(tier);
    const started = Date.now();
    try {
      const client = getOpenRouterClient();
      if (!client) {
        return { provider: "openrouter", configured: false, ok: false };
      }
      const { resolved: used } = await withOpenRouterCreditFallback(resolved, (m, remaining) =>
        client.chat.completions.create(
          {
            model: m.model,
            max_tokens: 16,
            messages: [{ role: "user", content: "Reply with the single word: ok" }],
            temperature: 0,
          },
          { maxRetries: openRouterCascadeMaxRetries(remaining) },
        ),
      );
      return {
        provider: "openrouter",
        configured: true,
        ok: true,
        model: used.model,
        configuredModel: resolved.model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status?: unknown }).status)
          : undefined;
      const auth = isProviderAuthError(err);
      const connection = !auth && isProviderConnectionError(err);
      const quota = !auth && !connection && isProviderQuotaError(err);
      const enriched = enrichError(err, "openrouter");
      return {
        provider: "openrouter",
        configured: true,
        ok: false,
        status: Number.isFinite(status) ? status : undefined,
        errorKind: auth ? "auth" : connection ? "connection" : quota ? "quota" : "other",
        message: enriched.message,
        model: resolved.model,
        configuredModel: resolved.model,
        latencyMs: Date.now() - started,
      };
    }
  }

  if (!hasLocalLlm()) {
    return { provider: "local", configured: false, ok: false };
  }

  if (cloudFlagshipMisconfigured()) {
    const resolved = resolveLocalModel(tier);
    return {
      provider: "local",
      configured: true,
      ok: false,
      status: 400,
      errorKind: "other",
      message: CLOUD_FLAGSHIP_SETUP_HINT.slice(0, 160),
      model: resolved.model,
    };
  }

  const resolved = resolveLocalModel(tier);
  const started = Date.now();
  try {
    const client = requireLocalClient();
    const { resolved: used } = await withModelFallback(
      client,
      { ...resolved, maxTokens: Math.min(resolved.maxTokens, 16) },
      (m) =>
        client.chat.completions.create({
          model: m.model,
          max_tokens: m.maxTokens,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          temperature: 0,
        }),
    );
    const catalog = await listLocalModels(client);
    return {
      provider: "local",
      configured: true,
      ok: true,
      model: used.model,
      configuredModel: resolved.model,
      availableModels: catalog.models,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: unknown }).status)
        : undefined;
    const probeClient = getLocalLlmClient();
    const catalog = probeClient ? await listLocalModels(probeClient) : null;
    const auth = isProviderAuthError(err);
    const connection = !auth && isProviderConnectionError(err);
    const errorKind = auth ? "auth" : connection ? "connection" : "other";
    const enriched = enrichError(err, "local");
    return {
      provider: "local",
      configured: true,
      ok: false,
      status: Number.isFinite(status) ? status : undefined,
      errorKind,
      message: enriched.message,
      ...(auth
        ? { hint: LOCAL_LLM_AUTH_FIX_HINT }
        : connection
          ? { hint: LOCAL_LLM_CONNECTION_FIX_HINT }
          : {}),
      model: resolved.model,
      configuredModel: resolved.model,
      availableModels: catalog?.models ?? [],
      latencyMs: Date.now() - started,
    };
  }
}

/** Live-probe configured chat providers with a tiny completion. Secret-free. */
export async function probeLlmProviders(tier: ModelTier = "standard"): Promise<LlmProviderProbeResult[]> {
  const chain = getProviderChain();
  if (chain.length === 0) {
    return [
      { provider: "local", configured: hasLocalLlm(), ok: false },
      {
        provider: "minimax",
        configured: hasMinimaxKey(),
        ok: false,
        message: hasMinimaxKey() ? undefined : "Set MINIMAX_API_KEY for MiniMax chat.",
      },
      {
        provider: "openrouter",
        configured: hasOpenRouterKey(),
        ok: false,
        message: hasOpenRouterKey() ? undefined : OPENROUTER_SETUP_HINT.slice(0, 200),
      },
    ];
  }
  const out: LlmProviderProbeResult[] = [];
  for (const provider of chain) {
    out.push(await probeOneProvider(provider, tier));
  }
  return out;
}

function openRouterModelCandidates(preferred: ResolvedModel): ResolvedModel[] {
  const out: ResolvedModel[] = [preferred];
  for (const model of OPENROUTER_FREE_MODEL_CANDIDATES) {
    if (!out.some((m) => m.model === model)) {
      out.push({ ...preferred, model });
    }
  }
  return out;
}

/**
 * Try the preferred OpenRouter model, then other :free candidates when the
 * account has no credits (HTTP 402) or a free provider returns 400/429/5xx
 * that is not ZDR / data-policy / the account-wide daily/minute cap.
 * Intermediate hops pass remainingCandidates > 0 so the SDK skips retries
 * (`openRouterCascadeMaxRetries`); the last candidate keeps maxRetries.
 */
async function withOpenRouterCreditFallback<T>(
  preferred: ResolvedModel,
  run: (resolved: ResolvedModel, remainingCandidates: number) => Promise<T>,
): Promise<{ value: T; resolved: ResolvedModel }> {
  let lastErr: unknown;
  const candidates = openRouterModelCandidates(preferred);
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const remainingCandidates = candidates.length - i - 1;
    try {
      const value = await run(candidate, remainingCandidates);
      return { value, resolved: candidate };
    } catch (err) {
      lastErr = err;
      if (err && typeof err === "object") {
        (err as { openRouterModel?: string }).openRouterModel = candidate.model;
      }
      const next = candidates[i + 1];
      if (next && shouldTryNextOpenRouterFreeModel(err, candidate.model)) {
        const creditFallback =
          isOpenRouterCreditFallbackError(err) && !isOpenRouterFreeModel(candidate.model);
        if (creditFallback) {
          openRouterCreditFallback = true;
        }
        console.warn(
          `[llm] OpenRouter ${candidate.model} ${
            creditFallback
              ? "needs credits"
              : isOpenRouterModelSpecificClientError(err)
                ? "rejected the request"
                : isOpenRouterTransientGatewayError(err)
                  ? "hit a gateway error"
                  : "is quota/rate limited"
          } (${summarizeError(err)}); retrying ${next.model}.`,
        );
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error(
    isOpenRouterAlreadyFreeTier(preferred.model)
      ? OPENROUTER_FREE_PROVIDER_HINT
      : OPENROUTER_CREDITS_HINT,
  );
}

async function runOpenRouterStream(
  req: ChatStreamRequest,
  failedOver: boolean,
): Promise<ChatStreamResult> {
  const client = getOpenRouterClient();
  if (!client) throw new Error(OPENROUTER_SETUP_HINT);
  const preferred = resolveOpenRouterModel(req.tier);
  const { value: stream, resolved } = await withOpenRouterCreditFallback(
    preferred,
    (m, remaining) =>
      client.chat.completions.create(
        {
          model: m.model,
          max_tokens: Math.min(req.maxTokens, m.maxTokens),
          messages: req.messages,
          stream: true,
        },
        {
          ...(req.signal ? { signal: req.signal } : {}),
          maxRetries: openRouterCascadeMaxRetries(remaining),
        },
      ),
  );
  return {
    stream,
    provider: "openrouter",
    brand: "openrouter",
    model: resolved.model,
    tier: resolved.tier,
    failedOver,
  };
}

async function runMinimaxStream(
  req: ChatStreamRequest,
  failedOver: boolean,
): Promise<ChatStreamResult> {
  const client = getMinimaxClient();
  if (!client) throw new Error("Set MINIMAX_API_KEY for MiniMax chat.");
  const resolved = resolveMinimaxModel(req.tier);
  const stream = await client.chat.completions.create(
    {
      model: resolved.model,
      max_tokens: Math.min(req.maxTokens, resolved.maxTokens),
      messages: req.messages,
      stream: true,
    },
    ...(req.signal ? [{ signal: req.signal }] : []),
  );
  return {
    stream,
    provider: "minimax",
    brand: "minimax",
    model: resolved.model,
    tier: resolved.tier,
    failedOver,
  };
}

async function runOpenRouterCompletion(
  req: ChatCompletionRequest,
  failedOver: boolean,
): Promise<ChatCompletionResult> {
  const client = getOpenRouterClient();
  if (!client) throw new Error(OPENROUTER_SETUP_HINT);
  const preferred = resolveOpenRouterModel(req.tier);
  const { value: completion, resolved } = await withOpenRouterCreditFallback(
    preferred,
    (m, remaining) =>
      client.chat.completions.create(
        {
          model: m.model,
          max_tokens: Math.min(req.maxTokens, m.maxTokens),
          messages: req.messages,
          ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
          ...(req.tools && req.tools.length
            ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" }
            : {}),
        },
        {
          ...(req.signal ? { signal: req.signal } : {}),
          maxRetries: openRouterCascadeMaxRetries(remaining),
        },
      ),
  );
  const content = completion.choices?.[0]?.message?.content ?? "";
  return {
    content: typeof content === "string" ? content : "",
    provider: "openrouter",
    brand: "openrouter",
    model: resolved.model,
    tier: resolved.tier,
    failedOver,
    toolCalls: completion.choices?.[0]?.message?.tool_calls ?? null,
  };
}

async function runMinimaxCompletion(
  req: ChatCompletionRequest,
  failedOver: boolean,
): Promise<ChatCompletionResult> {
  const client = getMinimaxClient();
  if (!client) throw new Error("Set MINIMAX_API_KEY for MiniMax chat.");
  const resolved = resolveMinimaxModel(req.tier);
  const completion = await client.chat.completions.create(
    {
      model: resolved.model,
      max_tokens: Math.min(req.maxTokens, resolved.maxTokens),
      messages: req.messages,
      ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
      ...(req.tools && req.tools.length
        ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" }
        : {}),
    },
    req.signal ? { signal: req.signal } : undefined,
  );
  const content = completion.choices?.[0]?.message?.content ?? "";
  return {
    content: typeof content === "string" ? content : "",
    provider: "minimax",
    brand: "minimax",
    model: resolved.model,
    tier: resolved.tier,
    failedOver,
    toolCalls: completion.choices?.[0]?.message?.tool_calls ?? null,
  };
}

/** Open a streaming chat completion (local Anima LLM, then OpenRouter). */
export async function createChatStreamWithFailover(req: ChatStreamRequest): Promise<ChatStreamResult> {
  beginChatProviderTurn();
  if (cloudFlagshipMisconfigured() && (!hasOpenRouterKey() && !hasMinimaxKey() || preferCustomLlmOnly())) {
    throw new Error(CLOUD_FLAGSHIP_SETUP_HINT);
  }
  const chain = getProviderChain();
  if (!chain.length) throw noProviderConfiguredError();

  let lastErr: unknown;
  let triedLocal = false;
  let triedOpenRouter = false;
  let localConnectionFailed = false;
  let openRouterZdrBlocked = false;

  for (const provider of chain) {
    try {
      if (provider === "local") {
        triedLocal = true;
        const client = requireLocalClient();
        const preferred = resolveLocalModel(req.tier);
        const { value: stream, resolved } = await withModelFallback(client, preferred, (m) =>
          client.chat.completions.create(
            {
              model: m.model,
              max_tokens: m.maxTokens,
              messages: req.messages,
              stream: true,
            },
            ...(req.signal ? [{ signal: req.signal }] : []),
          ),
        );
        return {
          stream,
          provider: "local",
          brand: "anima",
          model: resolved.model,
          tier: resolved.tier,
          failedOver: false,
        };
      }

      if (provider === "minimax") {
        return await runMinimaxStream(req, triedLocal || triedOpenRouter);
      }

      triedOpenRouter = true;
      return await runOpenRouterStream(req, triedLocal);
    } catch (err) {
      lastErr = err;
      if (provider === "local" && isProviderConnectionError(err)) {
        localConnectionFailed = true;
      }
      if (provider === "openrouter" && isOpenRouterZdrOrDataPolicyError(err)) {
        openRouterZdrBlocked = true;
      }
      const hasNext = chain.indexOf(provider) < chain.length - 1;
      if (shouldTryNextProvider(provider, err, hasNext)) {
        console.warn(
          `[llm] ${provider} failed (${summarizeError(err)}); trying next provider in chain=[${chain.join(",")}]`,
        );
        continue;
      }
      throw enrichError(err, provider, {
        localConnectionFailed: localConnectionFailed && provider === "openrouter",
        openRouterHopsExhausted: provider === "minimax" && triedOpenRouter,
        openRouterZdrBlocked,
      });
    }
  }

  throw enrichError(lastErr ?? noProviderConfiguredError(), chain[chain.length - 1] ?? "local", {
    localConnectionFailed: localConnectionFailed && chain[chain.length - 1] === "openrouter",
    openRouterHopsExhausted: chain[chain.length - 1] === "minimax" && triedOpenRouter,
    openRouterZdrBlocked,
  });
}

/**
 * Non-streaming chat completion (local Anima LLM, then OpenRouter).
 * Used by companion generation, evolution, and other one-shot LLM helpers.
 */
export async function createChatCompletionWithFailover(
  req: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  beginChatProviderTurn();
  if (cloudFlagshipMisconfigured() && (!hasOpenRouterKey() && !hasMinimaxKey() || preferCustomLlmOnly())) {
    throw new Error(CLOUD_FLAGSHIP_SETUP_HINT);
  }
  const chain = getProviderChain();
  if (!chain.length) throw noProviderConfiguredError();

  let lastErr: unknown;
  let triedLocal = false;
  let triedOpenRouter = false;
  let localConnectionFailed = false;
  let openRouterZdrBlocked = false;

  for (const provider of chain) {
    try {
      if (provider === "local") {
        triedLocal = true;
        const client = requireLocalClient();
        const preferred = resolveLocalModel(req.tier);
        const { value: completion, resolved } = await withModelFallback(client, preferred, (m) =>
          client.chat.completions.create(
            {
              model: m.model,
              max_tokens: m.maxTokens,
              messages: req.messages,
              ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
              ...(req.tools && req.tools.length
                ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" }
                : {}),
            },
            req.signal ? { signal: req.signal } : undefined,
          ),
        );
        const content = completion.choices?.[0]?.message?.content ?? "";
        return {
          content: typeof content === "string" ? content : "",
          provider: "local",
          brand: "anima",
          model: resolved.model,
          tier: resolved.tier,
          failedOver: false,
          toolCalls: completion.choices?.[0]?.message?.tool_calls ?? null,
        };
      }

      if (provider === "minimax") {
        return await runMinimaxCompletion(req, triedLocal || triedOpenRouter);
      }

      triedOpenRouter = true;
      return await runOpenRouterCompletion(req, triedLocal);
    } catch (err) {
      lastErr = err;
      if (provider === "local" && isProviderConnectionError(err)) {
        localConnectionFailed = true;
      }
      if (provider === "openrouter" && isOpenRouterZdrOrDataPolicyError(err)) {
        openRouterZdrBlocked = true;
      }
      const hasNext = chain.indexOf(provider) < chain.length - 1;
      if (shouldTryNextProvider(provider, err, hasNext)) {
        console.warn(
          `[llm] ${provider} failed (${summarizeError(err)}); trying next provider in chain=[${chain.join(",")}]`,
        );
        continue;
      }
      throw enrichError(err, provider, {
        localConnectionFailed: localConnectionFailed && provider === "openrouter",
        openRouterHopsExhausted: provider === "minimax" && triedOpenRouter,
        openRouterZdrBlocked,
      });
    }
  }

  throw enrichError(lastErr ?? noProviderConfiguredError(), chain[chain.length - 1] ?? "local", {
    localConnectionFailed: localConnectionFailed && chain[chain.length - 1] === "openrouter",
    openRouterHopsExhausted: chain[chain.length - 1] === "minimax" && triedOpenRouter,
    openRouterZdrBlocked,
  });
}

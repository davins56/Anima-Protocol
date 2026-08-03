// Cross-provider chat completion with automatic failover.
//
// Provider selection is controlled by ANIMA_LLM_PROVIDER:
//   - auto   (default) — OpenAI first, then Grok, then Gemini on billing/quota errors
//   - xai / grok       — Grok primary; never call OpenAI (Gemini as optional backup)
//   - gemini           — Gemini primary; never call OpenAI (Grok as optional backup)
//   - openai           — OpenAI primary with Grok/Gemini failover
//
// ANIMA_DISABLE_OPENAI=true also blocks OpenAI under `auto` (useful when the
// OpenAI account is out of credits and every cold start would otherwise retry it).
//
// Intra-provider "model unavailable" fallback (routed → standard) is preserved
// and still gated by isModelUnavailableError — that path must NOT fire on 429.
//
// Once OpenAI reports a billing/credits failure, subsequent turns in this
// process prefer non-OpenAI providers first so we stop hammering a depleted account.

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  isModelUnavailableError,
  resolveModel,
  type ModelTier,
  type ResolvedModel,
} from "./modelRouter";
import {
  getGeminiClient,
  getOpenAIClient,
  getXaiClient,
  hasGeminiKey,
  hasOpenAIKey,
  hasXaiKey,
} from "./openaiClient";

export type LlmProviderId = "openai" | "xai" | "gemini";

export type LlmProviderMode = "auto" | "openai" | "xai" | "gemini";

export interface ChatStreamRequest {
  tier: ModelTier;
  model: string;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
}

export interface ChatStreamResult {
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  provider: LlmProviderId;
  model: string;
  tier: ModelTier;
  failedOver: boolean;
  previousProvider?: LlmProviderId;
}

export interface ChatCompletionRequest {
  tier: ModelTier;
  model?: string;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
}

export interface ChatCompletionResult {
  content: string;
  provider: LlmProviderId;
  model: string;
  tier: ModelTier;
  failedOver: boolean;
  previousProvider?: LlmProviderId;
}

// Sticky preference after OpenAI billing/credits failure in this process.
let preferNonOpenAI = false;

/** Test helper — clears sticky failover preference. */
export function resetLlmFailoverStateForTests(): void {
  preferNonOpenAI = false;
}

export function getConfiguredProviderMode(): LlmProviderMode {
  const raw = (process.env.ANIMA_LLM_PROVIDER || "auto").trim().toLowerCase();
  if (raw === "grok") return "xai";
  if (raw === "xai" || raw === "openai" || raw === "gemini" || raw === "auto") {
    return raw;
  }
  return "auto";
}

export function isOpenAIBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "xai" || mode === "gemini") return true;
  const disabled = (process.env.ANIMA_DISABLE_OPENAI || "").trim().toLowerCase();
  return (
    disabled === "1" ||
    disabled === "true" ||
    disabled === "yes" ||
    disabled === "on"
  );
}

function providerAvailable(id: LlmProviderId): boolean {
  if (id === "openai") return !isOpenAIBlocked() && hasOpenAIKey();
  if (id === "xai") return hasXaiKey();
  return hasGeminiKey();
}

/** Ordered list of providers to try for the current env / sticky state. */
export function getProviderChain(): LlmProviderId[] {
  const mode = getConfiguredProviderMode();
  const chain: LlmProviderId[] = [];

  const push = (id: LlmProviderId) => {
    if (providerAvailable(id) && !chain.includes(id)) chain.push(id);
  };

  if (mode === "openai") {
    push("openai");
    push("xai");
    push("gemini");
    return chain;
  }

  if (mode === "xai") {
    push("xai");
    push("gemini");
    return chain;
  }

  if (mode === "gemini") {
    push("gemini");
    push("xai");
    return chain;
  }

  // auto
  if (preferNonOpenAI || isOpenAIBlocked()) {
    push("xai");
    push("gemini");
    push("openai");
  } else {
    push("openai");
    push("xai");
    push("gemini");
  }
  return chain;
}

export function getPreferredProvider(): LlmProviderId {
  const chain = getProviderChain();
  if (chain[0]) return chain[0];
  // Last resort label for error messages when nothing is configured.
  if (hasXaiKey()) return "xai";
  if (hasGeminiKey()) return "gemini";
  return "openai";
}

/** True when the provider rejected the API key / auth (worth trying another vendor). */
export function isProviderAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; type?: string; message?: string };
  const code = (e.code || e.type || "").toLowerCase();
  const msg = (e.message || "").toLowerCase();

  if (
    code.includes("invalid_api_key") ||
    code.includes("authentication_error") ||
    code.includes("invalid_auth")
  ) {
    return true;
  }

  if (
    msg.includes("incorrect api key") ||
    msg.includes("invalid api key") ||
    msg.includes("api key provided") ||
    msg.includes("authentication") ||
    // OpenAI SDK surfaces empty 401 bodies as: "401 status code (no body)"
    msg.includes("status code (no body)") ||
    msg.includes("401 status code")
  ) {
    return true;
  }

  if (e.status === 401) return true;
  return false;
}

// True when the provider account cannot serve more requests due to billing,
// exhausted credits/quota, hard rate limit, or bad API key — worth trying
// another vendor.
export function isProviderUnusableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if (isProviderAuthError(err)) return true;

  const e = err as { status?: number; code?: string; type?: string; message?: string };
  const code = (e.code || e.type || "").toLowerCase();
  const msg = (e.message || "").toLowerCase();

  if (
    code.includes("insufficient_quota") ||
    code.includes("billing_not_active") ||
    code.includes("billing_hard_limit") ||
    code.includes("account_deactivated")
  ) {
    return true;
  }

  if (
    msg.includes("no credits remaining") ||
    msg.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    (msg.includes("billing") && msg.includes("limit")) ||
    msg.includes("add credits") ||
    msg.includes("payment required")
  ) {
    return true;
  }

  // 429 covers both rate-limit and quota exhaustion from OpenAI; either way the
  // account is not usable for this turn and a different provider may be.
  if (e.status === 429) return true;
  if (e.status === 402) return true;

  return false;
}

const DEFAULT_XAI_MODELS: Record<ModelTier, string> = {
  light: "grok-3-mini",
  standard: "grok-3",
  heavy: "grok-4",
};

const XAI_ENV_KEYS: Record<ModelTier, string> = {
  light: "ANIMA_XAI_MODEL_LIGHT",
  standard: "ANIMA_XAI_MODEL_STANDARD",
  heavy: "ANIMA_XAI_MODEL_HEAVY",
};

const DEFAULT_GEMINI_MODELS: Record<ModelTier, string> = {
  light: "gemini-2.5-flash-lite",
  standard: "gemini-2.5-flash",
  heavy: "gemini-2.5-pro",
};

const GEMINI_ENV_KEYS: Record<ModelTier, string> = {
  light: "ANIMA_GEMINI_MODEL_LIGHT",
  standard: "ANIMA_GEMINI_MODEL_STANDARD",
  heavy: "ANIMA_GEMINI_MODEL_HEAVY",
};

export function resolveXaiModel(tier: ModelTier): ResolvedModel {
  const override =
    process.env[XAI_ENV_KEYS[tier]]?.trim() ||
    process.env.ANIMA_XAI_MODEL?.trim();
  const openaiResolved = resolveModel(tier);
  return {
    tier,
    model: override || DEFAULT_XAI_MODELS[tier],
    maxTokens: openaiResolved.maxTokens,
  };
}

export function resolveGeminiModel(tier: ModelTier): ResolvedModel {
  const override =
    process.env[GEMINI_ENV_KEYS[tier]]?.trim() ||
    process.env.ANIMA_GEMINI_MODEL?.trim();
  const openaiResolved = resolveModel(tier);
  return {
    tier,
    model: override || DEFAULT_GEMINI_MODELS[tier],
    maxTokens: openaiResolved.maxTokens,
  };
}

function providerLabel(id: LlmProviderId): string {
  if (id === "xai") return "Grok (xAI)";
  if (id === "gemini") return "Gemini";
  return "OpenAI";
}

function clientFor(provider: LlmProviderId): OpenAI {
  if (provider === "xai") {
    const client = getXaiClient();
    if (!client) {
      throw new Error("XAI_API_KEY must be set to use the Grok provider.");
    }
    return client;
  }
  if (provider === "gemini") {
    const client = getGeminiClient();
    if (!client) {
      throw new Error(
        "GEMINI_API_KEY (or GOOGLE_API_KEY) must be set to use the Gemini provider.",
      );
    }
    return client;
  }
  return getOpenAIClient();
}

function resolveForProvider(provider: LlmProviderId, tier: ModelTier): ResolvedModel {
  if (provider === "xai") return resolveXaiModel(tier);
  if (provider === "gemini") return resolveGeminiModel(tier);
  return resolveModel(tier);
}

function markOpenAIUnusable(err: unknown): void {
  if (isProviderUnusableError(err) && (hasXaiKey() || hasGeminiKey())) {
    preferNonOpenAI = true;
  }
}

function enrichError(err: unknown, attempted: LlmProviderId[]): Error {
  const names = attempted.map(providerLabel).join(" → ");
  if (isProviderAuthError(err)) {
    const keyHints = attempted.map((id) => {
      if (id === "xai") return "XAI_API_KEY";
      if (id === "gemini") return "GEMINI_API_KEY";
      return "OPENAI_API_KEY";
    });
    const uniqueKeys = [...new Set(keyHints)].join(" / ");
    return new Error(
      `LLM authentication failed (tried ${names}). Check ${uniqueKeys} on Vercel` +
        " — paste the key without quotes, then redeploy. " +
        "To skip OpenAI, set ANIMA_LLM_PROVIDER=xai (with XAI_API_KEY) or gemini (with GEMINI_API_KEY).",
    );
  }
  if (isProviderUnusableError(err)) {
    const hints: string[] = [];
    if (!hasXaiKey()) hints.push("Set XAI_API_KEY for Grok");
    if (!hasGeminiKey()) hints.push("Set GEMINI_API_KEY for Gemini");
    if (!isOpenAIBlocked() && !hasOpenAIKey()) hints.push("Set OPENAI_API_KEY");
    const hint =
      hints.length > 0
        ? ` ${hints.join("; ")}. Or set ANIMA_LLM_PROVIDER=xai|gemini to skip OpenAI.`
        : " All configured providers failed. Set ANIMA_LLM_PROVIDER=xai|gemini to skip OpenAI.";
    return new Error(
      `LLM credits/quota exhausted (tried ${names}).${hint}`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function createStream(
  provider: LlmProviderId,
  resolved: ResolvedModel,
  messages: ChatCompletionMessageParam[],
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  return clientFor(provider).chat.completions.create({
    model: resolved.model,
    max_tokens: resolved.maxTokens,
    messages,
    stream: true,
  });
}

async function createCompletion(
  provider: LlmProviderId,
  resolved: ResolvedModel,
  messages: ChatCompletionMessageParam[],
  temperature?: number,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return clientFor(provider).chat.completions.create({
    model: resolved.model,
    max_tokens: resolved.maxTokens,
    messages,
    ...(typeof temperature === "number" ? { temperature } : {}),
  });
}

async function withModelFallback<T>(
  provider: LlmProviderId,
  preferred: ResolvedModel,
  run: (resolved: ResolvedModel) => Promise<T>,
): Promise<{ value: T; resolved: ResolvedModel }> {
  try {
    return { value: await run(preferred), resolved: preferred };
  } catch (modelErr) {
    const standard = resolveForProvider(provider, "standard");
    if (
      preferred.model !== standard.model &&
      isModelUnavailableError(modelErr)
    ) {
      return { value: await run(standard), resolved: standard };
    }
    throw modelErr;
  }
}

/**
 * Open a streaming chat completion, falling back across models/providers:
 *  1. Preferred provider at the routed tier
 *  2. Same provider at `standard` if the model itself is unavailable
 *  3. Next providers in the chain on billing/quota/rate-limit errors
 */
export async function createChatStreamWithFailover(
  req: ChatStreamRequest,
): Promise<ChatStreamResult> {
  const chain = getProviderChain();
  if (chain.length === 0) {
    throw new Error(
      "No LLM provider configured. Set XAI_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY" +
        (isOpenAIBlocked()
          ? " (OpenAI is blocked via ANIMA_LLM_PROVIDER / ANIMA_DISABLE_OPENAI)."
          : "."),
    );
  }

  const attempted: LlmProviderId[] = [];
  let lastErr: unknown;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    attempted.push(provider);
    const routed = resolveForProvider(provider, req.tier);
    // On OpenAI, honor the concrete model the router already chose (env overrides).
    const preferredModel =
      provider === "openai"
        ? { tier: req.tier, model: req.model, maxTokens: req.maxTokens }
        : routed;

    try {
      const { value: stream, resolved } = await withModelFallback(
        provider,
        preferredModel,
        (m) => createStream(provider, m, req.messages),
      );
      return {
        stream,
        provider,
        model: resolved.model,
        tier: resolved.tier,
        failedOver: i > 0,
        previousProvider: i > 0 ? chain[0] : undefined,
      };
    } catch (err) {
      lastErr = err;
      if (provider === "openai") markOpenAIUnusable(err);
      if (!isProviderUnusableError(err)) {
        throw enrichError(err, attempted);
      }
      // Try next provider in chain.
    }
  }

  throw enrichError(lastErr, attempted);
}

/**
 * Non-streaming chat completion with the same provider chain as streaming chat.
 * Used by companion generation, evolution, and other one-shot LLM helpers.
 */
export async function createChatCompletionWithFailover(
  req: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  const chain = getProviderChain();
  if (chain.length === 0) {
    throw new Error(
      "No LLM provider configured. Set XAI_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY" +
        (isOpenAIBlocked()
          ? " (OpenAI is blocked via ANIMA_LLM_PROVIDER / ANIMA_DISABLE_OPENAI)."
          : "."),
    );
  }

  const attempted: LlmProviderId[] = [];
  let lastErr: unknown;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    attempted.push(provider);
    const routed = resolveForProvider(provider, req.tier);
    const preferredModel =
      provider === "openai" && req.model
        ? { tier: req.tier, model: req.model, maxTokens: req.maxTokens }
        : routed;

    try {
      const { value: completion, resolved } = await withModelFallback(
        provider,
        preferredModel,
        (m) => createCompletion(provider, m, req.messages, req.temperature),
      );
      return {
        content: completion.choices[0]?.message?.content ?? "",
        provider,
        model: resolved.model,
        tier: resolved.tier,
        failedOver: i > 0,
        previousProvider: i > 0 ? chain[0] : undefined,
      };
    } catch (err) {
      lastErr = err;
      if (provider === "openai") markOpenAIUnusable(err);
      if (!isProviderUnusableError(err)) {
        throw enrichError(err, attempted);
      }
    }
  }

  throw enrichError(lastErr, attempted);
}

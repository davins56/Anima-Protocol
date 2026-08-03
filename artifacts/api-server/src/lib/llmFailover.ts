// Cross-provider chat completion with automatic failover.
//
// Provider selection is controlled by ANIMA_LLM_PROVIDER:
//   - kimi / moonshot  — Kimi only (Moonshot Open Platform)
//   - gemini           — Gemini only; never call OpenAI or Grok
//   - auto             — Gemini → Kimi → Grok → OpenAI when those keys exist
//   - xai / grok       — Grok primary; never call OpenAI (Gemini/Kimi backup)
//   - openai           — OpenAI primary with Kimi/Grok/Gemini failover
//
// When ANIMA_LLM_PROVIDER is unset:
//   - GEMINI_API_KEY → gemini-only
//   - else KIMI_API_KEY / MOONSHOT_API_KEY → kimi-only
//   - else auto
//
// ANIMA_DISABLE_OPENAI=true also blocks OpenAI under `auto` (useful when the
// OpenAI account is out of credits).
// ANIMA_DISABLE_XAI=true blocks Grok under `auto` / `openai` (useful when the
// xAI team has no credits/licenses).
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
  createGeminiChatCompletion,
  createGeminiChatStream,
} from "./geminiNative";
import {
  getKimiClient,
  getOpenAIClient,
  getXaiClient,
  hasGeminiKey,
  hasKimiKey,
  hasOpenAIKey,
  hasXaiKey,
} from "./openaiClient";

export type LlmProviderId = "openai" | "xai" | "gemini" | "kimi";

export type LlmProviderMode = "auto" | "openai" | "xai" | "gemini" | "kimi";

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

// Sticky skip after xAI reports no team credits/licenses in this process.
// Prevents every chat turn from re-hitting a depleted Grok account once we
// already know it cannot serve (and keeps error copy focused on Gemini).
let preferNonXai = false;

/** Test helper — clears sticky failover preference. */
export function resetLlmFailoverStateForTests(): void {
  preferNonOpenAI = false;
  preferNonXai = false;
}

function defaultProviderMode(): LlmProviderMode {
  // Prefer Gemini when present; otherwise Kimi so a Moonshot key alone can
  // power chat without paid OpenAI / xAI balance.
  if (hasGeminiKey()) return "gemini";
  if (hasKimiKey()) return "kimi";
  return "auto";
}

export function getConfiguredProviderMode(): LlmProviderMode {
  const raw = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
  if (!raw) return defaultProviderMode();
  if (raw === "grok") return "xai";
  if (raw === "moonshot") return "kimi";
  if (
    raw === "xai" ||
    raw === "openai" ||
    raw === "gemini" ||
    raw === "kimi" ||
    raw === "auto"
  ) {
    return raw;
  }
  return defaultProviderMode();
}

function envFlagEnabled(name: string): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isOpenAIBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "xai" || mode === "gemini" || mode === "kimi") return true;
  return envFlagEnabled("ANIMA_DISABLE_OPENAI");
}

export function isXaiBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "gemini" || mode === "kimi") return true;
  if (preferNonXai) return true;
  return envFlagEnabled("ANIMA_DISABLE_XAI");
}

function providerAvailable(id: LlmProviderId): boolean {
  if (id === "openai") return !isOpenAIBlocked() && hasOpenAIKey();
  if (id === "xai") return !isXaiBlocked() && hasXaiKey();
  if (id === "kimi") return hasKimiKey();
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
    push("kimi");
    push("xai");
    push("gemini");
    return chain;
  }

  if (mode === "xai") {
    push("xai");
    push("kimi");
    push("gemini");
    return chain;
  }

  if (mode === "gemini") {
    // Gemini-only: a depleted XAI_API_KEY in the environment must not turn every
    // Gemini outage into a confusing "buy Grok credits" error.
    push("gemini");
    return chain;
  }

  if (mode === "kimi") {
    push("kimi");
    return chain;
  }

  // auto — prefer Gemini, then Kimi, then Grok, whenever they are configured
  // so a dead OpenAI key (401) or empty credits (429) cannot break every turn.
  // Set ANIMA_LLM_PROVIDER=openai to force OpenAI-first.
  const preferAlt =
    preferNonOpenAI ||
    isOpenAIBlocked() ||
    hasXaiKey() ||
    hasGeminiKey() ||
    hasKimiKey();
  if (preferAlt) {
    push("gemini");
    push("kimi");
    push("xai");
    push("openai");
  } else {
    push("openai");
  }
  return chain;
}

export function getPreferredProvider(): LlmProviderId {
  const chain = getProviderChain();
  if (chain[0]) return chain[0];
  // Last resort label for error messages when nothing is configured.
  if (hasGeminiKey()) return "gemini";
  if (hasKimiKey()) return "kimi";
  if (hasXaiKey()) return "xai";
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
    msg.includes("doesn't have any credits") ||
    msg.includes("does not have any credits") ||
    msg.includes("no credits or licenses") ||
    msg.includes("credits or licenses") ||
    msg.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    (msg.includes("billing") && msg.includes("limit")) ||
    msg.includes("add credits") ||
    msg.includes("purchase those") ||
    msg.includes("payment required") ||
    msg.includes("console.x.ai")
  ) {
    return true;
  }

  // 429 covers both rate-limit and quota exhaustion from OpenAI; either way the
  // account is not usable for this turn and a different provider may be.
  // xAI returns 403 when a newly created team has no credits/licenses yet.
  if (e.status === 429) return true;
  if (e.status === 402) return true;
  if (e.status === 403 && (msg.includes("credit") || msg.includes("license"))) {
    return true;
  }

  return false;
}

/** Pull a console.x.ai billing URL out of a provider error, if present. */
export function extractXaiBillingUrl(err: unknown): string | null {
  const text =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err && "message" in err
        ? String((err as { message?: unknown }).message || "")
        : String(err || "");
  const match = text.match(/https:\/\/console\.x\.ai\/[^\s"']+/i);
  if (!match?.[0]) return null;
  // Provider copy often ends the sentence with a period inside the quotes.
  return match[0].replace(/[.,;:]+$/g, "");
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

// Prefer cheaper K2 models for routine chat; K3 for high-stakes turns.
const DEFAULT_KIMI_MODELS: Record<ModelTier, string> = {
  light: "kimi-k2.5",
  standard: "kimi-k2.6",
  heavy: "kimi-k3",
};

const KIMI_ENV_KEYS: Record<ModelTier, string> = {
  light: "ANIMA_KIMI_MODEL_LIGHT",
  standard: "ANIMA_KIMI_MODEL_STANDARD",
  heavy: "ANIMA_KIMI_MODEL_HEAVY",
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

export function resolveKimiModel(tier: ModelTier): ResolvedModel {
  const override =
    process.env[KIMI_ENV_KEYS[tier]]?.trim() ||
    process.env.ANIMA_KIMI_MODEL?.trim();
  const openaiResolved = resolveModel(tier);
  return {
    tier,
    model: override || DEFAULT_KIMI_MODELS[tier],
    maxTokens: openaiResolved.maxTokens,
  };
}

function providerLabel(id: LlmProviderId): string {
  if (id === "xai") return "Grok (xAI)";
  if (id === "gemini") return "Gemini";
  if (id === "kimi") return "Kimi (Moonshot)";
  return "OpenAI";
}

function clientFor(provider: Exclude<LlmProviderId, "gemini">): OpenAI {
  if (provider === "xai") {
    const client = getXaiClient();
    if (!client) {
      throw new Error("XAI_API_KEY must be set to use the Grok provider.");
    }
    return client;
  }
  if (provider === "kimi") {
    const client = getKimiClient();
    if (!client) {
      throw new Error(
        "KIMI_API_KEY (or MOONSHOT_API_KEY) must be set to use the Kimi provider.",
      );
    }
    return client;
  }
  return getOpenAIClient();
}

function resolveForProvider(provider: LlmProviderId, tier: ModelTier): ResolvedModel {
  if (provider === "xai") return resolveXaiModel(tier);
  if (provider === "gemini") return resolveGeminiModel(tier);
  if (provider === "kimi") return resolveKimiModel(tier);
  return resolveModel(tier);
}

function markOpenAIUnusable(err: unknown): void {
  if (
    isProviderUnusableError(err) &&
    (hasXaiKey() || hasGeminiKey() || hasKimiKey())
  ) {
    preferNonOpenAI = true;
  }
}

function isXaiCreditsError(err: unknown): boolean {
  if (!isProviderUnusableError(err)) return false;
  if (extractXaiBillingUrl(err)) return true;
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === "object" && err && "message" in err
        ? String((err as { message?: unknown }).message || "").toLowerCase()
        : String(err || "").toLowerCase();
  return (
    msg.includes("credits or licenses") ||
    msg.includes("no credits or licenses") ||
    (msg.includes("console.x.ai") && msg.includes("credit"))
  );
}

function markXaiUnusable(err: unknown): void {
  // Only sticky-skip xAI on the specific no-credits/licenses failure — not on
  // every 429 — so a temporary rate limit can still be retried later.
  if (isXaiCreditsError(err) && hasGeminiKey()) {
    preferNonXai = true;
  }
}

function enrichError(err: unknown, attempted: LlmProviderId[]): Error {
  const names = attempted.map(providerLabel).join(" → ");
  if (isProviderAuthError(err)) {
    const keyHints = attempted.map((id) => {
      if (id === "xai") return "XAI_API_KEY";
      if (id === "gemini") return "GEMINI_API_KEY";
      if (id === "kimi") return "KIMI_API_KEY";
      return "OPENAI_API_KEY";
    });
    const uniqueKeys = [...new Set(keyHints)].join(" / ");
    return new Error(
      `LLM authentication failed (tried ${names}). Check ${uniqueKeys} on Vercel` +
        " — paste the key without quotes, then redeploy. " +
        (attempted.includes("gemini")
          ? "Gemini uses Google AI Studio keys (including AQ.* auth keys) via the native API. "
          : "") +
        (attempted.includes("kimi")
          ? "Kimi uses Moonshot keys from https://platform.kimi.ai (KIMI_API_KEY or MOONSHOT_API_KEY). "
          : "") +
        "To force a provider, set ANIMA_LLM_PROVIDER=kimi|gemini|xai|openai.",
    );
  }
  if (isProviderUnusableError(err)) {
    const xaiBilling = extractXaiBillingUrl(err);
    if (xaiBilling && attempted.includes("xai")) {
      const geminiAlreadyTried = attempted.includes("gemini");
      if (geminiAlreadyTried) {
        return new Error(
          `Chat providers failed (tried ${names}). Gemini was unavailable, and ` +
            `Grok (xAI) has no team credits/licenses. Check GEMINI_API_KEY / Google AI Studio ` +
            `quota on Vercel, set KIMI_API_KEY + ANIMA_LLM_PROVIDER=kimi, or buy Grok credits at ${xaiBilling}.`,
        );
      }
      return new Error(
        `Grok (xAI) has no team credits/licenses yet (tried ${names}). ` +
          `Buy credits at ${xaiBilling}` +
          (hasKimiKey()
            ? ", or set ANIMA_LLM_PROVIDER=kimi to use Kimi instead."
            : hasGeminiKey()
              ? ", or set ANIMA_LLM_PROVIDER=gemini to use Gemini instead (and optionally ANIMA_DISABLE_XAI=true)."
              : ". Optionally set KIMI_API_KEY or GEMINI_API_KEY for a non-OpenAI backup."),
      );
    }
    if (attempted.length === 1 && attempted[0] === "kimi") {
      return new Error(
        `Kimi (Moonshot) credits/quota exhausted (or the key was rejected). ` +
          `Check KIMI_API_KEY / MOONSHOT_API_KEY on Vercel and your balance at https://platform.kimi.ai, then redeploy.`,
      );
    }
    if (attempted.length === 1 && attempted[0] === "gemini") {
      return new Error(
        `Gemini credits/quota exhausted (or the key was rejected). Check GEMINI_API_KEY / Google AI Studio quota on Vercel, then redeploy.` +
          (hasKimiKey()
            ? " Or set ANIMA_LLM_PROVIDER=kimi to use Kimi instead."
            : hasXaiKey() && !isXaiBlocked()
              ? " Or set ANIMA_LLM_PROVIDER=auto to allow Grok/OpenAI failover."
              : hasOpenAIKey() && !isOpenAIBlocked()
                ? " Or set ANIMA_LLM_PROVIDER=auto to allow OpenAI failover."
                : ""),
      );
    }
    const hints: string[] = [];
    if (!hasKimiKey()) hints.push("Set KIMI_API_KEY for Kimi");
    if (!hasXaiKey()) hints.push("Set XAI_API_KEY for Grok");
    if (!hasGeminiKey()) hints.push("Set GEMINI_API_KEY for Gemini");
    if (!isOpenAIBlocked() && !hasOpenAIKey()) hints.push("Set OPENAI_API_KEY");
    const hint =
      hints.length > 0
        ? ` ${hints.join("; ")}. Or set ANIMA_LLM_PROVIDER=kimi|gemini|xai to skip OpenAI.`
        : " All configured providers failed. Check KIMI_API_KEY / GEMINI_API_KEY / Google AI Studio quota, or fund XAI_API_KEY / OPENAI_API_KEY.";
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
  // Use the native Generative Language API for Gemini so AQ.* AI Studio
  // auth keys work (OpenAI-compatible /v1beta/openai rejects many of them).
  if (provider === "gemini") {
    return createGeminiChatStream({
      model: resolved.model,
      maxTokens: resolved.maxTokens,
      messages,
    });
  }
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
  if (provider === "gemini") {
    return createGeminiChatCompletion({
      model: resolved.model,
      maxTokens: resolved.maxTokens,
      messages,
      temperature,
    });
  }
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
      "No LLM provider configured. Set KIMI_API_KEY, GEMINI_API_KEY, XAI_API_KEY, or OPENAI_API_KEY" +
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
      if (provider === "xai") markXaiUnusable(err);
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
      "No LLM provider configured. Set KIMI_API_KEY, GEMINI_API_KEY, XAI_API_KEY, or OPENAI_API_KEY" +
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
      if (provider === "xai") markXaiUnusable(err);
      if (!isProviderUnusableError(err)) {
        throw enrichError(err, attempted);
      }
    }
  }

  throw enrichError(lastErr, attempted);
}

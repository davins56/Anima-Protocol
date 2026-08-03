// Cross-provider chat completion with automatic failover.
//
// Primary path is OpenAI (existing modelRouter tiers). When OpenAI returns a
// billing / quota / credits error (or a hard rate-limit), and XAI_API_KEY is
// configured, the request is retried on xAI's OpenAI-compatible Grok API.
//
// Intra-OpenAI "model unavailable" fallback (routed → standard) is preserved
// and still gated by isModelUnavailableError — that path must NOT fire on 429.
//
// Once OpenAI reports a billing/credits failure, subsequent turns in this
// process prefer xAI first so we stop hammering a depleted OpenAI account.

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  isModelUnavailableError,
  resolveModel,
  type ModelTier,
  type ResolvedModel,
} from "./modelRouter";
import {
  getOpenAIClient,
  getXaiClient,
  hasOpenAIKey,
  hasXaiKey,
} from "./openaiClient";

export type LlmProviderId = "openai" | "xai";

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

// Sticky preference after OpenAI billing/credits failure in this process.
let preferXai = false;

/** Test helper — clears sticky failover preference. */
export function resetLlmFailoverStateForTests(): void {
  preferXai = false;
}

export function getPreferredProvider(): LlmProviderId {
  if (preferXai && hasXaiKey()) return "xai";
  if (hasOpenAIKey()) return "openai";
  if (hasXaiKey()) return "xai";
  return "openai";
}

// True when the provider account cannot serve more requests due to billing,
// exhausted credits/quota, or a hard rate limit — worth trying another vendor.
export function isProviderUnusableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
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

function providerLabel(id: LlmProviderId): string {
  return id === "xai" ? "Grok (xAI)" : "OpenAI";
}

function clientFor(provider: LlmProviderId): OpenAI {
  if (provider === "xai") {
    const client = getXaiClient();
    if (!client) {
      throw new Error("XAI_API_KEY must be set to use the Grok fallback.");
    }
    return client;
  }
  return getOpenAIClient();
}

function resolveForProvider(provider: LlmProviderId, tier: ModelTier): ResolvedModel {
  return provider === "xai" ? resolveXaiModel(tier) : resolveModel(tier);
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

function markOpenAIUnusable(err: unknown): void {
  if (isProviderUnusableError(err) && hasXaiKey()) {
    preferXai = true;
  }
}

function enrichError(err: unknown, attempted: LlmProviderId[]): Error {
  const base = err instanceof Error ? err.message : String(err);
  const names = attempted.map(providerLabel).join(" → ");
  if (isProviderUnusableError(err)) {
    return new Error(
      `${base} (tried ${names}). OpenAI credits/quota are exhausted` +
        (hasXaiKey()
          ? "; Grok fallback also failed."
          : ". Set XAI_API_KEY to enable automatic Grok failover."),
    );
  }
  return err instanceof Error ? err : new Error(base);
}

/**
 * Open a streaming chat completion, falling back across models/providers:
 *  1. Preferred provider at the routed tier
 *  2. Same provider at `standard` if the model itself is unavailable
 *  3. Alternate provider (xAI ↔ OpenAI) on billing/quota/rate-limit errors
 */
export async function createChatStreamWithFailover(
  req: ChatStreamRequest,
): Promise<ChatStreamResult> {
  const primary = getPreferredProvider();
  const secondary: LlmProviderId | null =
    primary === "openai"
      ? hasXaiKey()
        ? "xai"
        : null
      : hasOpenAIKey()
        ? "openai"
        : null;

  const attempted: LlmProviderId[] = [];

  // --- Attempt 1: preferred provider at routed tier (+ intra-provider model fallback)
  try {
    attempted.push(primary);
    const routed = resolveForProvider(primary, req.tier);
    // When sticky-preferring xAI, still honor the caller's tier; model id comes
    // from xAI mapping. When on OpenAI, prefer the concrete model the router
    // already chose (env overrides included).
    const preferredModel =
      primary === "openai"
        ? { tier: req.tier, model: req.model, maxTokens: req.maxTokens }
        : routed;

    try {
      const stream = await createStream(primary, preferredModel, req.messages);
      return {
        stream,
        provider: primary,
        model: preferredModel.model,
        tier: preferredModel.tier,
        // Only true when *this request* switched providers mid-flight.
        failedOver: false,
      };
    } catch (modelErr) {
      const standard = resolveForProvider(primary, "standard");
      if (
        preferredModel.model !== standard.model &&
        isModelUnavailableError(modelErr)
      ) {
        const stream = await createStream(primary, standard, req.messages);
        return {
          stream,
          provider: primary,
          model: standard.model,
          tier: standard.tier,
          failedOver: false,
        };
      }
      throw modelErr;
    }
  } catch (err) {
    if (primary === "openai") markOpenAIUnusable(err);
    if (!secondary || !isProviderUnusableError(err)) {
      throw enrichError(err, attempted);
    }
  }

  // --- Attempt 2: alternate provider (secondary is non-null after the guard above)
  const fallback = secondary as LlmProviderId;
  try {
    attempted.push(fallback);
    const resolved = resolveForProvider(fallback, req.tier);
    try {
      const stream = await createStream(fallback, resolved, req.messages);
      return {
        stream,
        provider: fallback,
        model: resolved.model,
        tier: resolved.tier,
        failedOver: true,
        previousProvider: primary,
      };
    } catch (modelErr) {
      const standard = resolveForProvider(fallback, "standard");
      if (
        resolved.model !== standard.model &&
        isModelUnavailableError(modelErr)
      ) {
        const stream = await createStream(fallback, standard, req.messages);
        return {
          stream,
          provider: fallback,
          model: standard.model,
          tier: standard.tier,
          failedOver: true,
          previousProvider: primary,
        };
      }
      throw modelErr;
    }
  } catch (err) {
    throw enrichError(err, attempted);
  }
}

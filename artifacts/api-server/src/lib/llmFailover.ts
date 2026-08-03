// Cross-provider chat completion with automatic failover.
//
// Chat LLM policy (2026-08): Gemini is removed from chat selection. When
// KIMI_API_KEY / MOONSHOT_API_KEY is set, chat is Kimi-only — leftover
// ANIMA_LLM_PROVIDER=gemini / anima / auto values cannot route to Gemini.
//
// Provider selection is controlled by ANIMA_LLM_PROVIDER:
//   - kimi / moonshot / (unset with Kimi key) — Kimi only
//   - xai / grok       — Grok primary (Kimi backup); never Gemini
//   - openai           — OpenAI primary (Kimi / Grok backup); never Gemini
//   - auto             — Kimi → Grok → OpenAI (no Gemini)
//   - anima / custom / ensemble — treated as Kimi-only when Kimi is configured
//   - gemini           — ignored when Kimi is configured (becomes Kimi-only)
//
// ANIMA_DISABLE_OPENAI=true blocks OpenAI under `auto`.
// ANIMA_DISABLE_XAI=true blocks Grok under `auto` / `openai`.
//
// Intra-provider "model unavailable" fallback (routed → standard) is preserved
// and still gated by isModelUnavailableError — that path must NOT fire on 429.

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  isModelUnavailableError,
  resolveModel,
  type ModelTier,
  type ResolvedModel,
} from "./modelRouter";
import {
  getKimiClient,
  getOpenAIClient,
  getXaiClient,
  hasGeminiKey,
  hasKimiKey,
  hasOpenAIKey,
  hasXaiKey,
} from "./openaiClient";

/** Chat providers. `gemini` remains only as a legacy label — never selected. */
export type LlmProviderId = "openai" | "xai" | "gemini" | "kimi";

export type LlmProviderMode =
  | "auto"
  | "openai"
  | "xai"
  | "gemini"
  | "kimi"
  | "anima";

/** Brand for the custom multi-model stack (when ANIMA_LLM_PROVIDER=anima|custom). */
export type LlmBrand = "anima";

/** Public, secret-free snapshot of how chat will route (for /api/healthz/llm). */
export interface LlmRoutingStatus {
  status: "ok" | "error";
  mode: LlmProviderMode;
  preferred: LlmProviderId | null;
  chain: LlmProviderId[];
  brand: LlmBrand | null;
  keys: {
    kimi: boolean;
    openai: boolean;
    xai: boolean;
    /** Present but ignored for chat. */
    gemini: boolean;
  };
  geminiRetiredForChat: true;
  rawProviderEnv: string | null;
  note: string;
}

export interface ChatStreamRequest {
  tier: ModelTier;
  model: string;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
}

export interface ChatStreamResult {
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  provider: LlmProviderId;
  /** Present when the custom Anima multi-model mode selected the backend. */
  brand?: LlmBrand;
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
  /** Present when the custom Anima multi-model mode selected the backend. */
  brand?: LlmBrand;
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

function envFlagEnabled(name: string): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function defaultProviderMode(): LlmProviderMode {
  // Chat is Kimi-only whenever a Moonshot key is present. Gemini is not a
  // chat option anymore (leftover GEMINI_API_KEY must not steal turns).
  if (hasKimiKey()) return "kimi";
  return "auto";
}

export function getConfiguredProviderMode(): LlmProviderMode {
  // Hard rule: with KIMI_API_KEY set, chat never selects Gemini — regardless of
  // ANIMA_LLM_PROVIDER=gemini / anima / auto left over on Vercel.
  if (hasKimiKey()) return "kimi";

  const raw = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
  if (!raw) return defaultProviderMode();
  if (raw === "grok") return "xai";
  if (raw === "moonshot" || raw === "custom" || raw === "ensemble" || raw === "anima") {
    return "kimi";
  }
  // Gemini mode is retired for chat.
  if (raw === "gemini") return "auto";
  if (raw === "xai" || raw === "openai" || raw === "kimi" || raw === "auto") {
    return raw;
  }
  return defaultProviderMode();
}

export function isAnimaCustomMode(): boolean {
  // Anima brand chip can still show when explicitly requested, but routing is
  // Kimi-only when the Kimi key is present.
  const raw = (process.env.ANIMA_LLM_PROVIDER || "").trim().toLowerCase();
  return raw === "anima" || raw === "custom" || raw === "ensemble";
}

export function isOpenAIBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "xai" || mode === "kimi") return true;
  return envFlagEnabled("ANIMA_DISABLE_OPENAI");
}

export function isXaiBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "kimi") return true;
  if (preferNonXai) return true;
  return envFlagEnabled("ANIMA_DISABLE_XAI");
}

/** Gemini is removed from chat provider selection. */
export function isGeminiBlocked(): boolean {
  return true;
}

function providerAvailable(id: LlmProviderId): boolean {
  if (id === "gemini") return false;
  if (id === "openai") return !isOpenAIBlocked() && hasOpenAIKey();
  if (id === "xai") return !isXaiBlocked() && hasXaiKey();
  if (id === "kimi") return hasKimiKey();
  return false;
}

/**
 * Legacy helper — anima tier lists no longer include Gemini.
 * Kept for callers/tests; with Kimi configured, chat uses Kimi-only anyway.
 */
export function getAnimaTierProviderOrder(tier: ModelTier): LlmProviderId[] {
  if (tier === "heavy") {
    return ["kimi", "xai", "openai"];
  }
  return ["kimi", "xai", "openai"];
}

/** Ordered list of providers to try for the current env / sticky state. */
export function getProviderChain(_tier: ModelTier = "standard"): LlmProviderId[] {
  const mode = getConfiguredProviderMode();
  const chain: LlmProviderId[] = [];

  const push = (id: LlmProviderId) => {
    if (providerAvailable(id) && !chain.includes(id)) chain.push(id);
  };

  // Kimi-only is the product default whenever the key exists.
  if (mode === "kimi") {
    push("kimi");
    return chain;
  }

  if (mode === "openai") {
    push("openai");
    push("kimi");
    push("xai");
    return chain;
  }

  if (mode === "xai") {
    push("xai");
    push("kimi");
    return chain;
  }

  // auto — Kimi → Grok → OpenAI. Gemini is never in the chain.
  const preferAlt =
    preferNonOpenAI || isOpenAIBlocked() || hasXaiKey() || hasKimiKey();
  if (preferAlt) {
    push("kimi");
    push("xai");
    push("openai");
  } else {
    push("openai");
  }
  return chain;
}

export function getPreferredProvider(tier: ModelTier = "standard"): LlmProviderId {
  const chain = getProviderChain(tier);
  if (chain[0]) return chain[0];
  // Last resort label for error messages when nothing is configured.
  if (hasKimiKey()) return "kimi";
  if (hasXaiKey()) return "xai";
  return "openai";
}

/** Secret-free routing diagnostic for operators and the chat UI. */
export function getLlmRoutingStatus(tier: ModelTier = "standard"): LlmRoutingStatus {
  const raw = (process.env.ANIMA_LLM_PROVIDER || "").trim() || null;
  const mode = getConfiguredProviderMode();
  const chain = getProviderChain(tier);
  const preferred = chain[0] ?? null;
  const kimi = hasKimiKey();
  return {
    status: preferred ? "ok" : "error",
    mode,
    preferred,
    chain,
    brand: isAnimaCustomMode() ? "anima" : null,
    keys: {
      kimi,
      openai: hasOpenAIKey(),
      xai: hasXaiKey(),
      gemini: hasGeminiKey(),
    },
    geminiRetiredForChat: true,
    rawProviderEnv: raw,
    note: kimi
      ? "Chat is Kimi-only. Gemini/Grok/OpenAI are not used for chat while KIMI_API_KEY is set."
      : preferred
        ? "KIMI_API_KEY is missing — chat falls back to Grok/OpenAI. Gemini is never used for chat."
        : "No chat LLM key configured. Set KIMI_API_KEY on Vercel and redeploy.",
  };
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

// Prefer K2.6 for routine chat (k2.5 is sunsetting for new accounts); K3 for
// high-stakes turns. Override with ANIMA_KIMI_MODEL_* env vars.
const DEFAULT_KIMI_MODELS: Record<ModelTier, string> = {
  light: "kimi-k2.6",
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

/** @deprecated Gemini is retired for chat — kept only so older tests compile. */
export function resolveGeminiModel(tier: ModelTier): ResolvedModel {
  const openaiResolved = resolveModel(tier);
  return {
    tier,
    model: "gemini-retired",
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
  if (id === "gemini") return "Gemini (retired)";
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
  if (provider === "gemini") {
    throw new Error("Gemini is retired for chat. Set KIMI_API_KEY and redeploy.");
  }
  if (provider === "xai") return resolveXaiModel(tier);
  if (provider === "kimi") return resolveKimiModel(tier);
  return resolveModel(tier);
}

function markOpenAIUnusable(err: unknown): void {
  if (isProviderUnusableError(err) && (hasXaiKey() || hasKimiKey())) {
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
  if (isXaiCreditsError(err) && hasKimiKey()) {
    preferNonXai = true;
  }
}

function enrichError(err: unknown, attempted: LlmProviderId[]): Error {
  const names = attempted.map(providerLabel).join(" → ");
  if (isProviderAuthError(err)) {
    const keyHints = attempted.map((id) => {
      if (id === "xai") return "XAI_API_KEY";
      if (id === "kimi") return "KIMI_API_KEY";
      return "OPENAI_API_KEY";
    });
    const uniqueKeys = [...new Set(keyHints)].join(" / ");
    return new Error(
      `LLM authentication failed (tried ${names}). Check ${uniqueKeys} on Vercel` +
        " — paste the key without quotes, then redeploy. " +
        (attempted.includes("kimi")
          ? "Kimi uses Moonshot keys from https://platform.kimi.ai (KIMI_API_KEY or MOONSHOT_API_KEY). "
          : "") +
        "Chat uses Kimi when KIMI_API_KEY is set (Gemini is not used for chat).",
    );
  }
  if (isProviderUnusableError(err)) {
    const xaiBilling = extractXaiBillingUrl(err);
    if (xaiBilling && attempted.includes("xai")) {
      return new Error(
        `Grok (xAI) has no team credits/licenses yet (tried ${names}). ` +
          `Buy credits at ${xaiBilling}` +
          (hasKimiKey()
            ? ", or set ANIMA_LLM_PROVIDER=kimi to use Kimi instead."
            : ". Set KIMI_API_KEY for Kimi chat."),
      );
    }
    if (attempted.length === 1 && attempted[0] === "kimi") {
      return new Error(
        `Kimi (Moonshot) credits/quota exhausted (or the key was rejected). ` +
          `Check KIMI_API_KEY / MOONSHOT_API_KEY on Vercel and your balance at https://platform.kimi.ai, then redeploy.`,
      );
    }
    const hints: string[] = [];
    if (!hasKimiKey()) hints.push("Set KIMI_API_KEY for Kimi");
    if (!hasXaiKey()) hints.push("Set XAI_API_KEY for Grok");
    if (!isOpenAIBlocked() && !hasOpenAIKey()) hints.push("Set OPENAI_API_KEY");
    const hint =
      hints.length > 0
        ? ` ${hints.join("; ")}. Or set ANIMA_LLM_PROVIDER=kimi|xai to skip OpenAI.`
        : " All configured providers failed. Check KIMI_API_KEY at https://platform.kimi.ai, or fund XAI_API_KEY / OPENAI_API_KEY.";
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
  if (provider === "gemini") {
    throw new Error("Gemini is retired for chat. Set KIMI_API_KEY and redeploy.");
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
    throw new Error("Gemini is retired for chat. Set KIMI_API_KEY and redeploy.");
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
  // Chat is Kimi-only. Gemini / Grok / OpenAI are never used for chat turns.
  if (!hasKimiKey()) {
    throw new Error(
      "Chat requires KIMI_API_KEY (or MOONSHOT_API_KEY) on Vercel. " +
        "Gemini is retired for chat — remove ANIMA_LLM_PROVIDER=gemini if set, " +
        "add your Moonshot key from https://platform.kimi.ai, then redeploy.",
    );
  }

  const brand: LlmBrand | undefined = isAnimaCustomMode() ? "anima" : undefined;
  const preferredModel = resolveKimiModel(req.tier);
  try {
    const { value: stream, resolved } = await withModelFallback(
      "kimi",
      preferredModel,
      (m) => createStream("kimi", m, req.messages),
    );
    return {
      stream,
      provider: "kimi",
      brand,
      model: resolved.model,
      tier: resolved.tier,
      failedOver: false,
    };
  } catch (err) {
    throw enrichError(err, ["kimi"]);
  }
}

/**
 * Non-streaming chat completion with the same provider chain as streaming chat.
 * Used by companion generation, evolution, and other one-shot LLM helpers.
 */
export async function createChatCompletionWithFailover(
  req: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  if (!hasKimiKey()) {
    throw new Error(
      "Chat requires KIMI_API_KEY (or MOONSHOT_API_KEY) on Vercel. " +
        "Gemini is retired for chat — remove ANIMA_LLM_PROVIDER=gemini if set, " +
        "add your Moonshot key from https://platform.kimi.ai, then redeploy.",
    );
  }

  const brand: LlmBrand | undefined = isAnimaCustomMode() ? "anima" : undefined;
  const preferredModel = resolveKimiModel(req.tier);
  try {
    const { value: completion, resolved } = await withModelFallback(
      "kimi",
      preferredModel,
      (m) => createCompletion("kimi", m, req.messages, req.temperature),
    );
    const content = completion.choices?.[0]?.message?.content ?? "";
    return {
      content: typeof content === "string" ? content : "",
      provider: "kimi",
      brand,
      model: resolved.model,
      tier: resolved.tier,
      failedOver: false,
    };
  } catch (err) {
    throw enrichError(err, ["kimi"]);
  }
}

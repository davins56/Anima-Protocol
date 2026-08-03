// Cross-provider chat completion with automatic failover.
//
// Chat LLM policy (2026-08): Gemini is removed from chat selection. Kimi is
// preferred when KIMI_API_KEY / MOONSHOT_API_KEY is set, but depleted / rejected
// Kimi keys automatically fall through to Grok → OpenAI so chat stays up.
//
// Provider selection is controlled by ANIMA_LLM_PROVIDER:
//   - (unset) / auto    — Kimi → Grok → OpenAI (no Gemini)
//   - kimi / moonshot   — Kimi only (no backup)
//   - xai / grok        — Grok primary (Kimi backup); never Gemini
//   - openai            — OpenAI primary (Kimi / Grok backup); never Gemini
//   - anima / custom / ensemble — sequential path uses auto chain; ensemble
//                                 path fans out via llmEnsemble.ts
//   - gemini            — ignored (becomes auto)
//
// Values that look like API keys pasted into ANIMA_LLM_PROVIDER are ignored
// (common Vercel misconfig: AQ.* Gemini key in the wrong field).
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
let preferNonXai = false;

// Sticky skip after Kimi / Moonshot reports quota exhaustion or rejects the key.
let preferNonKimi = false;

/** Test helper — clears sticky failover preference. */
export function resetLlmFailoverStateForTests(): void {
  preferNonOpenAI = false;
  preferNonXai = false;
  preferNonKimi = false;
}

function envFlagEnabled(name: string): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Normalize ANIMA_LLM_PROVIDER. Rejects values that look like API keys pasted
 * into the wrong Vercel field (e.g. Gemini AQ.* keys).
 */
export function sanitizeProviderEnv(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Common API key prefixes / over-long secrets must never be treated as modes.
  if (
    /^(AQ\.|sk-|xai-|AIza|Bearer\s)/i.test(trimmed) ||
    trimmed.length > 32
  ) {
    return null;
  }
  return trimmed.toLowerCase();
}

function defaultProviderMode(): LlmProviderMode {
  // Prefer Kimi when configured, but keep the multi-provider auto chain so a
  // depleted Moonshot balance can fall through to Grok / OpenAI.
  return "auto";
}

export function getConfiguredProviderMode(): LlmProviderMode {
  const raw = sanitizeProviderEnv(process.env.ANIMA_LLM_PROVIDER);
  if (!raw) return defaultProviderMode();
  if (raw === "grok") return "xai";
  if (raw === "moonshot") return "kimi";
  if (raw === "custom" || raw === "ensemble" || raw === "anima") {
    // Sequential chat uses the auto chain; ensemble is handled separately.
    return "auto";
  }
  // Gemini mode is retired for chat.
  if (raw === "gemini") return "auto";
  if (raw === "xai" || raw === "openai" || raw === "kimi" || raw === "auto") {
    return raw;
  }
  return defaultProviderMode();
}

export function isAnimaCustomMode(): boolean {
  const raw = sanitizeProviderEnv(process.env.ANIMA_LLM_PROVIDER);
  return raw === "anima" || raw === "custom" || raw === "ensemble";
}

/** True when OpenAI is blocked by config (mode / ANIMA_DISABLE_OPENAI), not sticky. */
export function isOpenAIBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "xai" || mode === "kimi") return true;
  return envFlagEnabled("ANIMA_DISABLE_OPENAI");
}

/** True when Grok is blocked by config (mode / ANIMA_DISABLE_XAI), not sticky. */
export function isXaiBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "kimi") return true;
  return envFlagEnabled("ANIMA_DISABLE_XAI");
}

export function isKimiBlocked(): boolean {
  return preferNonKimi;
}

/** Sticky skip after a prior xAI unusable failure (independent of provider mode). */
export function isXaiStickySkipped(): boolean {
  return preferNonXai;
}

/** Sticky skip after a prior OpenAI unusable failure (independent of provider mode). */
export function isOpenAIStickySkipped(): boolean {
  return preferNonOpenAI;
}

/** Sticky skip after a prior Kimi unusable failure (independent of provider mode). */
export function isKimiStickySkipped(): boolean {
  return preferNonKimi;
}

function hasAnyStickySkip(): boolean {
  return preferNonKimi || preferNonXai || preferNonOpenAI;
}

/**
 * If prior quota/auth failures sticky-skipped every key, clear stickies so the
 * next turn can retry. Otherwise a warm Vercel isolate shows a false
 * "No LLM provider configured" even when KIMI_API_KEY is set.
 */
export function reviveStickySkippedProvidersIfNeeded(): boolean {
  if (!hasAnyStickySkip()) return false;
  const anyKey = hasKimiKey() || hasXaiKey() || hasOpenAIKey();
  if (!anyKey) return false;

  // Would the chain be empty with stickies applied?
  const kimiOk = hasKimiKey() && !preferNonKimi;
  const xaiOk = hasXaiKey() && !isXaiBlocked() && !preferNonXai;
  const openaiOk = hasOpenAIKey() && !isOpenAIBlocked() && !preferNonOpenAI;
  if (kimiOk || xaiOk || openaiOk) return false;

  preferNonKimi = false;
  preferNonXai = false;
  preferNonOpenAI = false;
  return true;
}

/** Gemini is removed from chat provider selection. */
export function isGeminiBlocked(): boolean {
  return true;
}

function providerAvailable(id: LlmProviderId): boolean {
  if (id === "gemini") return false;
  if (id === "openai") {
    return hasOpenAIKey() && !isOpenAIBlocked() && !preferNonOpenAI;
  }
  if (id === "xai") {
    return hasXaiKey() && !isXaiBlocked() && !preferNonXai;
  }
  if (id === "kimi") return hasKimiKey() && !preferNonKimi;
  return false;
}

/**
 * Legacy helper — anima tier lists no longer include Gemini.
 * Kept for callers/tests; sequential chat uses getProviderChain.
 */
export function getAnimaTierProviderOrder(tier: ModelTier): LlmProviderId[] {
  if (tier === "heavy") {
    return ["kimi", "xai", "openai"];
  }
  return ["kimi", "xai", "openai"];
}

/** Ordered list of providers to try for the current env / sticky state. */
export function getProviderChain(_tier: ModelTier = "standard"): LlmProviderId[] {
  reviveStickySkippedProvidersIfNeeded();

  const mode = getConfiguredProviderMode();
  const chain: LlmProviderId[] = [];

  const push = (id: LlmProviderId) => {
    if (providerAvailable(id) && !chain.includes(id)) chain.push(id);
  };

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
  push("kimi");
  push("xai");
  push("openai");
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
  const rawInput = (process.env.ANIMA_LLM_PROVIDER || "").trim() || null;
  const sanitized = sanitizeProviderEnv(rawInput);
  const mode = getConfiguredProviderMode();
  const chain = getProviderChain(tier);
  const preferred = chain[0] ?? null;
  const kimi = hasKimiKey();
  const noteParts: string[] = [];
  if (rawInput && !sanitized) {
    noteParts.push(
      "ANIMA_LLM_PROVIDER looks like an API key and was ignored — set it to auto|kimi|xai|openai.",
    );
  }
  if (preferNonKimi) {
    noteParts.push("Kimi sticky-skipped after a prior quota/auth failure this process.");
  }
  if (kimi && mode === "auto") {
    noteParts.push(
      "Chat prefers Kimi, then fails over to Grok / OpenAI on quota or auth errors. Gemini is never used.",
    );
  } else if (mode === "kimi") {
    noteParts.push(
      "Chat is Kimi-only (ANIMA_LLM_PROVIDER=kimi). Set ANIMA_LLM_PROVIDER=auto to enable Grok/OpenAI backup.",
    );
  } else if (preferred) {
    noteParts.push(
      "Chat uses the configured provider chain. Gemini is never used for chat.",
    );
  } else {
    noteParts.push(
      "No chat LLM key configured. Set KIMI_API_KEY, XAI_API_KEY, or OPENAI_API_KEY on Vercel and redeploy.",
    );
  }

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
    // Never echo API-key-like values that were pasted into the wrong field.
    rawProviderEnv: sanitized,
    note: noteParts.join(" "),
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
    msg.includes("console.x.ai") ||
    msg.includes("platform.kimi.ai") ||
    msg.includes("quota exhausted") ||
    msg.includes("quota exceeded")
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

function markKimiUnusable(err: unknown): void {
  // Sticky-skip Kimi on quota/auth so the next turn goes straight to Grok/OpenAI
  // instead of re-hitting a depleted Moonshot balance every message.
  if (isProviderUnusableError(err) && (hasXaiKey() || hasOpenAIKey())) {
    preferNonKimi = true;
  }
}

/**
 * Record a provider failure so subsequent turns (including ensemble mind
 * selection) skip known-broken backends. Used by both sequential failover and
 * the parallel-minds ensemble path.
 */
export function recordProviderFailure(
  provider: LlmProviderId,
  err: unknown,
): void {
  if (provider === "openai") {
    markOpenAIUnusable(err);
    return;
  }
  if (provider === "kimi") {
    markKimiUnusable(err);
    return;
  }
  if (provider === "xai") {
    // Ensemble drafts swallow errors via Promise.allSettled — sticky-skip xAI
    // on any unusable failure when another mind can cover.
    if (isProviderUnusableError(err) && (hasKimiKey() || hasOpenAIKey())) {
      preferNonXai = true;
      return;
    }
    markXaiUnusable(err);
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
  if (isXaiCreditsError(err) && (hasKimiKey() || hasOpenAIKey())) {
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
        "Set ANIMA_LLM_PROVIDER=auto to allow Grok/OpenAI backup when Kimi fails.",
    );
  }
  if (isProviderUnusableError(err)) {
    const xaiBilling = extractXaiBillingUrl(err);
    if (xaiBilling && attempted.includes("xai") && attempted.length === 1) {
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
          `Check KIMI_API_KEY / MOONSHOT_API_KEY on Vercel and your balance at https://platform.kimi.ai, ` +
          `or set ANIMA_LLM_PROVIDER=auto with XAI_API_KEY / OPENAI_API_KEY for backup, then redeploy.`,
      );
    }
    const hints: string[] = [];
    if (!hasKimiKey()) hints.push("Set KIMI_API_KEY for Kimi");
    if (!hasXaiKey()) hints.push("Set XAI_API_KEY for Grok");
    if (!isOpenAIBlocked() && !hasOpenAIKey()) hints.push("Set OPENAI_API_KEY");
    const hint =
      hints.length > 0
        ? ` ${hints.join("; ")}. Or set ANIMA_LLM_PROVIDER=auto|kimi|xai.`
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

function requireProviderChain(): LlmProviderId[] {
  const chain = getProviderChain();
  if (chain.length === 0) {
    const missing: string[] = [];
    if (!hasKimiKey()) missing.push("KIMI_API_KEY");
    if (!hasXaiKey()) missing.push("XAI_API_KEY");
    if (!hasOpenAIKey()) missing.push("OPENAI_API_KEY");
    const configNote = isOpenAIBlocked()
      ? " OpenAI is blocked via ANIMA_LLM_PROVIDER / ANIMA_DISABLE_OPENAI."
      : "";
    const modeNote =
      getConfiguredProviderMode() === "kimi"
        ? " ANIMA_LLM_PROVIDER=kimi requires a working KIMI_API_KEY."
        : "";
    throw new Error(
      missing.length > 0
        ? `No LLM provider configured. Set ${missing.join(" / ")} on Vercel Production, then redeploy.${configNote}${modeNote}`
        : `No usable LLM provider right now.${configNote}${modeNote} Check key values on Vercel Production and redeploy.`,
    );
  }
  return chain;
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
  const chain = requireProviderChain();
  const brand: LlmBrand | undefined = isAnimaCustomMode() ? "anima" : undefined;
  const attempted: LlmProviderId[] = [];
  let lastErr: unknown;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i]!;
    attempted.push(provider);
    const routed = resolveForProvider(provider, req.tier);
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
        brand,
        model: resolved.model,
        tier: resolved.tier,
        failedOver: i > 0,
        previousProvider: i > 0 ? chain[0] : undefined,
      };
    } catch (err) {
      lastErr = err;
      recordProviderFailure(provider, err);
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
  const chain = requireProviderChain();
  const brand: LlmBrand | undefined = isAnimaCustomMode() ? "anima" : undefined;
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
      const content = completion.choices?.[0]?.message?.content ?? "";
      return {
        content: typeof content === "string" ? content : "",
        provider,
        brand,
        model: resolved.model,
        tier: resolved.tier,
        failedOver: i > 0,
        previousProvider: i > 0 ? chain[0] : undefined,
      };
    } catch (err) {
      lastErr = err;
      recordProviderFailure(provider, err);
      if (!isProviderUnusableError(err)) {
        throw enrichError(err, attempted);
      }
    }
  }

  throw enrichError(lastErr, attempted);
}

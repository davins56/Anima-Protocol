// Cross-provider chat completion with automatic failover.
//
// Chat LLM policy (2026-08): Gemini-first BYOK chain, with Vercel AI Gateway as
// a last-resort unpaid path when every direct key is out of credits. Depleted
// keys sticky-skip within a turn and fall through.
//
// Provider selection is controlled by ANIMA_LLM_PROVIDER:
//   - (unset) / auto    — Gemini → Kimi → Grok → OpenAI → AI Gateway
//   - gemini            — Gemini only
//   - kimi / moonshot   — Kimi only (no backup)
//   - xai / grok        — Grok primary (Gemini / Kimi backup)
//   - openai            — OpenAI primary (Gemini / Kimi / Grok backup)
//   - gateway           — Vercel AI Gateway only (OIDC or AI_GATEWAY_API_KEY)
//   - anima / custom / ensemble — sequential path uses auto chain; ensemble
//                                 path fans out via llmEnsemble.ts
//
// Values that look like API keys pasted into ANIMA_LLM_PROVIDER are ignored
// (common Vercel misconfig: AQ.* Gemini key in the wrong field). Use
// GEMINI_API_KEY for the actual key and set ANIMA_LLM_PROVIDER=auto|gemini.
//
// ANIMA_DISABLE_OPENAI=true blocks OpenAI under `auto`.
// ANIMA_DISABLE_XAI=true blocks Grok under `auto` / `openai`.
// ANIMA_DISABLE_GATEWAY=true blocks AI Gateway under `auto`.
//
// Intra-provider "model unavailable" fallback (routed → standard) is preserved
// and still gated by isModelUnavailableError — that path must NOT fire on 429.

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  createGeminiChatCompletion,
  createGeminiChatStream,
} from "./geminiNative";
import {
  isModelUnavailableError,
  resolveModel,
  type ModelTier,
  type ResolvedModel,
} from "./modelRouter";
import {
  getGatewayClient,
  getKimiClient,
  getOpenAIClient,
  getXaiClient,
  hasGatewayAuth,
  hasGeminiKey,
  hasKimiKey,
  hasOpenAIKey,
  hasXaiKey,
} from "./openaiClient";

/** Chat providers selected by failover / ensemble. */
export type LlmProviderId = "openai" | "xai" | "gemini" | "kimi" | "gateway";

export type LlmProviderMode =
  | "auto"
  | "openai"
  | "xai"
  | "gemini"
  | "kimi"
  | "gateway"
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
    gemini: boolean;
    gateway: boolean;
  };
  /** Always false — Gemini is selectable again when GEMINI_API_KEY is set. */
  geminiRetiredForChat: false;
  rawProviderEnv: string | null;
  note: string;
}

/** Secret-free per-provider live probe result (for /api/healthz/llm?probe=1). */
export interface LlmProviderProbeResult {
  provider: LlmProviderId;
  configured: boolean;
  ok: boolean;
  status?: number;
  errorKind?: "auth" | "quota" | "other";
  message?: string;
  model?: string;
  latencyMs?: number;
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

// Sticky skip after Gemini quota/auth failure in this process.
let preferNonGemini = false;

// Sticky skip after Vercel AI Gateway quota/auth failure in this process.
let preferNonGateway = false;

function clearAllStickySkips(): void {
  preferNonOpenAI = false;
  preferNonXai = false;
  preferNonKimi = false;
  preferNonGemini = false;
  preferNonGateway = false;
}

/** Test helper — clears sticky failover preference. */
export function resetLlmFailoverStateForTests(): void {
  clearAllStickySkips();
}

/**
 * Every user chat turn starts fresh. Sticky skips only help within a single
 * failover walk; carrying them across warm-isolate turns caused "tried OpenAI"
 * alone while GEMINI_API_KEY / KIMI_API_KEY were still configured.
 */
export function beginChatProviderTurn(): void {
  clearAllStickySkips();
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
  return "auto";
}

export function getConfiguredProviderMode(): LlmProviderMode {
  const raw = sanitizeProviderEnv(process.env.ANIMA_LLM_PROVIDER);
  if (!raw) return defaultProviderMode();
  if (raw === "grok") return "xai";
  if (raw === "moonshot") return "kimi";
  if (raw === "ai-gateway" || raw === "vercel-gateway") return "gateway";
  if (raw === "custom" || raw === "ensemble" || raw === "anima") {
    // Sequential chat uses the auto chain; ensemble is handled separately.
    return "auto";
  }
  if (
    raw === "xai" ||
    raw === "openai" ||
    raw === "kimi" ||
    raw === "auto" ||
    raw === "gemini" ||
    raw === "gateway"
  ) {
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
  if (mode === "xai" || mode === "kimi" || mode === "gemini" || mode === "gateway") {
    return true;
  }
  return envFlagEnabled("ANIMA_DISABLE_OPENAI");
}

/** True when Grok is blocked by config (mode / ANIMA_DISABLE_XAI), not sticky. */
export function isXaiBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (mode === "kimi" || mode === "gemini" || mode === "gateway") return true;
  return envFlagEnabled("ANIMA_DISABLE_XAI");
}

/** True when AI Gateway is blocked by config / ANIMA_DISABLE_GATEWAY. */
export function isGatewayBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (
    mode === "kimi" ||
    mode === "gemini" ||
    mode === "xai" ||
    mode === "openai"
  ) {
    return true;
  }
  return envFlagEnabled("ANIMA_DISABLE_GATEWAY");
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

/** Sticky skip after a prior Gemini unusable failure. */
export function isGeminiStickySkipped(): boolean {
  return preferNonGemini;
}

/** Sticky skip after a prior AI Gateway unusable failure. */
export function isGatewayStickySkipped(): boolean {
  return preferNonGateway;
}

function hasAnyStickySkip(): boolean {
  return (
    preferNonKimi ||
    preferNonXai ||
    preferNonOpenAI ||
    preferNonGemini ||
    preferNonGateway
  );
}

function hasAnyChatKey(): boolean {
  return (
    hasGeminiKey() ||
    hasKimiKey() ||
    hasXaiKey() ||
    hasOpenAIKey() ||
    hasGatewayAuth()
  );
}

/**
 * If sticky skips would hide Gemini/Kimi or empty the chain while keys exist,
 * clear them. Prevents warm isolates from falling through to "tried OpenAI"
 * alone after earlier Gemini/Kimi quota failures.
 */
export function reviveStickySkippedProvidersIfNeeded(): boolean {
  if (!hasAnyStickySkip()) return false;
  if (!hasAnyChatKey()) return false;

  const geminiOk = hasGeminiKey() && !preferNonGemini && !isGeminiConfigBlocked();
  const kimiOk = hasKimiKey() && !preferNonKimi && !isKimiConfigBlocked();
  const xaiOk = hasXaiKey() && !isXaiBlocked() && !preferNonXai;
  const openaiOk = hasOpenAIKey() && !isOpenAIBlocked() && !preferNonOpenAI;
  const gatewayOk =
    hasGatewayAuth() && !isGatewayBlocked() && !preferNonGateway;
  const nothingLeft =
    !geminiOk && !kimiOk && !xaiOk && !openaiOk && !gatewayOk;
  const hidingPreferred =
    (preferNonGemini && hasGeminiKey() && !isGeminiConfigBlocked()) ||
    (preferNonKimi && hasKimiKey() && !isKimiConfigBlocked());

  if (!nothingLeft && !hidingPreferred) return false;

  clearAllStickySkips();
  return true;
}

/** Config-only Gemini block (mode=kimi|xai|openai|gateway can leave Gemini out). */
function isGeminiConfigBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  return mode === "kimi" || mode === "xai" || mode === "openai" || mode === "gateway";
}

function isKimiConfigBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  return mode === "gemini" || mode === "gateway";
}

/** Gemini is selectable when a key is present (no longer retired). */
export function isGeminiBlocked(): boolean {
  return isGeminiConfigBlocked() || preferNonGemini;
}

function providerAvailable(id: LlmProviderId): boolean {
  if (id === "gemini") {
    return hasGeminiKey() && !isGeminiConfigBlocked() && !preferNonGemini;
  }
  if (id === "openai") {
    return hasOpenAIKey() && !isOpenAIBlocked() && !preferNonOpenAI;
  }
  if (id === "xai") {
    return hasXaiKey() && !isXaiBlocked() && !preferNonXai;
  }
  if (id === "kimi") {
    return hasKimiKey() && !isKimiConfigBlocked() && !preferNonKimi;
  }
  if (id === "gateway") {
    return hasGatewayAuth() && !isGatewayBlocked() && !preferNonGateway;
  }
  return false;
}

/** Provider order for Anima custom / ensemble drafts. */
export function getAnimaTierProviderOrder(_tier: ModelTier): LlmProviderId[] {
  return ["gemini", "kimi", "xai", "openai"];
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

  if (mode === "gemini") {
    push("gemini");
    return chain;
  }

  if (mode === "gateway") {
    push("gateway");
    return chain;
  }

  if (mode === "openai") {
    push("openai");
    push("gemini");
    push("kimi");
    push("xai");
    push("gateway");
    return chain;
  }

  if (mode === "xai") {
    push("xai");
    push("gemini");
    push("kimi");
    push("gateway");
    return chain;
  }

  // auto — Gemini first, then Kimi → Grok → OpenAI, then AI Gateway as unpaid last resort.
  push("gemini");
  push("kimi");
  push("xai");
  push("openai");
  push("gateway");
  return chain;
}

export function getPreferredProvider(tier: ModelTier = "standard"): LlmProviderId {
  const chain = getProviderChain(tier);
  if (chain[0]) return chain[0];
  if (hasGeminiKey()) return "gemini";
  if (hasKimiKey()) return "kimi";
  if (hasXaiKey()) return "xai";
  if (hasOpenAIKey()) return "openai";
  return "gateway";
}

/** Secret-free routing diagnostic for operators and the chat UI. */
export function getLlmRoutingStatus(tier: ModelTier = "standard"): LlmRoutingStatus {
  const rawInput = (process.env.ANIMA_LLM_PROVIDER || "").trim() || null;
  const sanitized = sanitizeProviderEnv(rawInput);
  const mode = getConfiguredProviderMode();
  const chain = getProviderChain(tier);
  const preferred = chain[0] ?? null;
  const noteParts: string[] = [];
  if (rawInput && !sanitized) {
    noteParts.push(
      "ANIMA_LLM_PROVIDER looks like an API key and was ignored — set it to auto|gemini|kimi|xai|openai|gateway (put the Gemini key in GEMINI_API_KEY).",
    );
  }
  if (preferNonGemini) {
    noteParts.push("Gemini sticky-skipped after a prior quota/auth failure this process.");
  }
  if (preferNonKimi) {
    noteParts.push("Kimi sticky-skipped after a prior quota/auth failure this process.");
  }
  if (preferNonGateway) {
    noteParts.push(
      "AI Gateway sticky-skipped after a prior quota/auth failure this process.",
    );
  }
  if (mode === "auto") {
    noteParts.push(
      "Chat prefers Gemini, then fails over to Kimi → Grok → OpenAI → AI Gateway on quota or auth errors.",
    );
  } else if (mode === "gemini") {
    noteParts.push("Chat is Gemini-only (ANIMA_LLM_PROVIDER=gemini).");
  } else if (mode === "kimi") {
    noteParts.push(
      "Chat is Kimi-only (ANIMA_LLM_PROVIDER=kimi). Set ANIMA_LLM_PROVIDER=auto for Gemini/Grok/OpenAI/Gateway backup.",
    );
  } else if (mode === "gateway") {
    noteParts.push(
      "Chat is AI Gateway-only (ANIMA_LLM_PROVIDER=gateway). Uses AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
    );
  } else if (preferred) {
    noteParts.push("Chat uses the configured provider chain.");
  } else {
    noteParts.push(
      "No chat LLM key configured. Set GEMINI_API_KEY, KIMI_API_KEY, XAI_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY on Vercel and redeploy.",
    );
  }

  return {
    status: preferred ? "ok" : "error",
    mode,
    preferred,
    chain,
    brand: isAnimaCustomMode() ? "anima" : null,
    keys: {
      kimi: hasKimiKey(),
      openai: hasOpenAIKey(),
      xai: hasXaiKey(),
      gemini: hasGeminiKey(),
      gateway: hasGatewayAuth(),
    },
    geminiRetiredForChat: false,
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
    code.includes("account_deactivated") ||
    code.includes("resource_exhausted")
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
    msg.includes("resource_exhausted") ||
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

  // 429 covers both rate-limit and quota exhaustion; either way the account is
  // not usable for this turn and a different provider may be.
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

// Vercel AI Gateway model slugs (provider/model). Cheap Gemini path by default.
const DEFAULT_GATEWAY_MODELS: Record<ModelTier, string> = {
  light: "google/gemini-2.5-flash-lite",
  standard: "google/gemini-2.5-flash",
  heavy: "google/gemini-2.5-pro",
};

const GATEWAY_ENV_KEYS: Record<ModelTier, string> = {
  light: "ANIMA_GATEWAY_MODEL_LIGHT",
  standard: "ANIMA_GATEWAY_MODEL_STANDARD",
  heavy: "ANIMA_GATEWAY_MODEL_HEAVY",
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

export function resolveGatewayModel(tier: ModelTier): ResolvedModel {
  const override =
    process.env[GATEWAY_ENV_KEYS[tier]]?.trim() ||
    process.env.ANIMA_GATEWAY_MODEL?.trim();
  const openaiResolved = resolveModel(tier);
  return {
    tier,
    model: override || DEFAULT_GATEWAY_MODELS[tier],
    maxTokens: openaiResolved.maxTokens,
  };
}

function providerLabel(id: LlmProviderId): string {
  if (id === "xai") return "Grok (xAI)";
  if (id === "gemini") return "Gemini";
  if (id === "kimi") return "Kimi (Moonshot)";
  if (id === "gateway") return "AI Gateway";
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
  if (provider === "gateway") {
    const client = getGatewayClient();
    if (!client) {
      throw new Error(
        "AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) must be set to use AI Gateway.",
      );
    }
    return client;
  }
  return getOpenAIClient();
}

function resolveForProvider(provider: LlmProviderId, tier: ModelTier): ResolvedModel {
  if (provider === "gemini") return resolveGeminiModel(tier);
  if (provider === "xai") return resolveXaiModel(tier);
  if (provider === "kimi") return resolveKimiModel(tier);
  if (provider === "gateway") return resolveGatewayModel(tier);
  return resolveModel(tier);
}

function otherVendorAvailable(excluding: LlmProviderId): boolean {
  if (excluding !== "gemini" && hasGeminiKey()) return true;
  if (excluding !== "kimi" && hasKimiKey()) return true;
  if (excluding !== "xai" && hasXaiKey()) return true;
  if (excluding !== "openai" && hasOpenAIKey()) return true;
  if (excluding !== "gateway" && hasGatewayAuth()) return true;
  return false;
}

function markOpenAIUnusable(err: unknown): void {
  if (isProviderUnusableError(err) && otherVendorAvailable("openai")) {
    preferNonOpenAI = true;
  }
}

function markKimiUnusable(err: unknown): void {
  if (isProviderUnusableError(err) && otherVendorAvailable("kimi")) {
    preferNonKimi = true;
  }
}

function markGeminiUnusable(err: unknown): void {
  if (isProviderUnusableError(err) && otherVendorAvailable("gemini")) {
    preferNonGemini = true;
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
  if (provider === "gemini") {
    markGeminiUnusable(err);
    return;
  }
  if (provider === "gateway") {
    markGatewayUnusable(err);
    return;
  }
  if (provider === "xai") {
    if (isProviderUnusableError(err) && otherVendorAvailable("xai")) {
      preferNonXai = true;
      return;
    }
    markXaiUnusable(err);
  }
}

function summarizeProviderError(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "string") return err.slice(0, 160);
  if (err instanceof Error) return err.message.slice(0, 160);
  if (typeof err === "object") {
    const e = err as { status?: number; code?: string; message?: unknown };
    const parts: string[] = [];
    if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
    if (e.code) parts.push(String(e.code));
    if (e.message) parts.push(String(e.message).slice(0, 120));
    if (parts.length) return parts.join(": ");
  }
  return String(err).slice(0, 160);
}

function formatFailureTrail(
  failures: Array<{ provider: LlmProviderId; err: unknown }>,
): string {
  if (failures.length === 0) return "";
  return failures
    .map((f) => `${providerLabel(f.provider)}: ${summarizeProviderError(f.err)}`)
    .join(" | ");
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
  if (isXaiCreditsError(err) && otherVendorAvailable("xai")) {
    preferNonXai = true;
  }
}

function markGatewayUnusable(err: unknown): void {
  if (isProviderUnusableError(err) && otherVendorAvailable("gateway")) {
    preferNonGateway = true;
  }
}

function enrichError(
  err: unknown,
  attempted: LlmProviderId[],
  failures: Array<{ provider: LlmProviderId; err: unknown }> = [],
): Error {
  const names = attempted.map(providerLabel).join(" → ");
  const trail = formatFailureTrail(failures);
  const trailSuffix = trail ? ` Details: ${trail}` : "";
  if (isProviderAuthError(err)) {
    const keyHints = attempted.map((id) => {
      if (id === "xai") return "XAI_API_KEY";
      if (id === "kimi") return "KIMI_API_KEY";
      if (id === "gemini") return "GEMINI_API_KEY";
      if (id === "gateway") return "AI_GATEWAY_API_KEY";
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
          ? "Kimi uses Moonshot keys from https://platform.kimi.ai. "
          : "") +
        (attempted.includes("gateway")
          ? "AI Gateway uses AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN (https://vercel.com/docs/ai-gateway). "
          : "") +
        "Set ANIMA_LLM_PROVIDER=auto to allow multi-provider failover." +
        trailSuffix,
    );
  }
  if (isProviderUnusableError(err)) {
    const xaiBilling = extractXaiBillingUrl(err);
    if (xaiBilling && attempted.includes("xai") && attempted.length === 1) {
      return new Error(
        `Grok (xAI) has no team credits/licenses yet (tried ${names}). ` +
          `Buy credits at ${xaiBilling}` +
          (hasGeminiKey()
            ? ", or set ANIMA_LLM_PROVIDER=gemini / auto to use Gemini."
            : hasKimiKey()
              ? ", or set ANIMA_LLM_PROVIDER=kimi to use Kimi instead."
              : hasGatewayAuth()
                ? ", or set ANIMA_LLM_PROVIDER=gateway / auto to use AI Gateway."
                : ". Set GEMINI_API_KEY, KIMI_API_KEY, or AI_GATEWAY_API_KEY for backup chat.") +
          trailSuffix,
      );
    }
    if (attempted.length === 1 && attempted[0] === "gemini") {
      return new Error(
        `Gemini credits/quota exhausted (or the key was rejected). Check GEMINI_API_KEY / Google AI Studio quota on Vercel, then redeploy.` +
          (hasKimiKey() || hasXaiKey() || hasOpenAIKey() || hasGatewayAuth()
            ? " Or set ANIMA_LLM_PROVIDER=auto to allow Kimi/Grok/OpenAI/Gateway failover."
            : "") +
          trailSuffix,
      );
    }
    if (attempted.length === 1 && attempted[0] === "kimi") {
      return new Error(
        `Kimi (Moonshot) credits/quota exhausted (or the key was rejected). ` +
          `Check KIMI_API_KEY / MOONSHOT_API_KEY on Vercel and your balance at https://platform.kimi.ai, ` +
          `or set ANIMA_LLM_PROVIDER=auto so Gemini/Grok/OpenAI/Gateway can cover, then redeploy.` +
          trailSuffix,
      );
    }
    if (attempted.length === 1 && attempted[0] === "gateway") {
      return new Error(
        `AI Gateway credits/quota exhausted (or auth failed). Check AI_GATEWAY_API_KEY / Vercel AI Gateway credits at https://vercel.com/docs/ai-gateway, then redeploy.` +
          trailSuffix,
      );
    }
    const hints: string[] = [];
    if (!hasGeminiKey()) hints.push("Set GEMINI_API_KEY for Gemini");
    if (!hasKimiKey()) hints.push("Set KIMI_API_KEY for Kimi");
    if (!hasXaiKey()) hints.push("Set XAI_API_KEY for Grok");
    if (!isOpenAIBlocked() && !hasOpenAIKey()) hints.push("Set OPENAI_API_KEY");
    if (!hasGatewayAuth()) {
      hints.push("Set AI_GATEWAY_API_KEY (or deploy on Vercel with OIDC)");
    }
    // When every BYOK/gateway slot is already configured, the env values can look
    // "correct" in Vercel while every upstream still rejects (quota / billing /
    // revoked key). Do not tell operators to re-check missing vars in that case.
    const hint =
      hints.length > 0
        ? ` ${hints.join("; ")}. Or set ANIMA_LLM_PROVIDER=auto|gemini|kimi|xai|gateway.`
        : " Keys are present on the server, but every provider rejected the request (quota, billing, or revoked key) — re-checking env values will not fix this. Add credits in Google AI Studio / Moonshot / xAI / OpenAI, or top up AI Gateway. Live-check: /api/healthz/llm?probe=1.";
    return new Error(
      `LLM credits/quota exhausted (tried ${names}).${hint}${trailSuffix}`,
    );
  }
  const base = err instanceof Error ? err : new Error(String(err));
  if (trail && !base.message.includes("Details:")) {
    return new Error(`${base.message}${trailSuffix}`);
  }
  return base;
}

async function createStream(
  provider: LlmProviderId,
  resolved: ResolvedModel,
  messages: ChatCompletionMessageParam[],
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  // Native Generative Language API so AQ.* AI Studio auth keys work.
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

function requireProviderChain(): LlmProviderId[] {
  const chain = getProviderChain();
  if (chain.length === 0) {
    const missing: string[] = [];
    if (!hasGeminiKey()) missing.push("GEMINI_API_KEY");
    if (!hasKimiKey()) missing.push("KIMI_API_KEY");
    if (!hasXaiKey()) missing.push("XAI_API_KEY");
    if (!hasOpenAIKey()) missing.push("OPENAI_API_KEY");
    if (!hasGatewayAuth()) missing.push("AI_GATEWAY_API_KEY");
    const configNote = isOpenAIBlocked()
      ? " OpenAI is blocked via ANIMA_LLM_PROVIDER / ANIMA_DISABLE_OPENAI."
      : "";
    const mode = getConfiguredProviderMode();
    const modeNote =
      mode === "kimi"
        ? " ANIMA_LLM_PROVIDER=kimi requires a working KIMI_API_KEY."
        : mode === "gemini"
          ? " ANIMA_LLM_PROVIDER=gemini requires a working GEMINI_API_KEY."
          : mode === "gateway"
            ? " ANIMA_LLM_PROVIDER=gateway requires AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN."
            : "";
    throw new Error(
      missing.length >= 4
        ? `No LLM provider configured. Set GEMINI_API_KEY (preferred), KIMI_API_KEY, XAI_API_KEY, OPENAI_API_KEY, or AI_GATEWAY_API_KEY on Vercel Production, then redeploy.${configNote}${modeNote}`
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
  // Always walk the full configured chain for each user message.
  beginChatProviderTurn();
  const chain = requireProviderChain();
  const brand: LlmBrand | undefined = isAnimaCustomMode() ? "anima" : undefined;
  const attempted: LlmProviderId[] = [];
  const failures: Array<{ provider: LlmProviderId; err: unknown }> = [];
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
      failures.push({ provider, err });
      recordProviderFailure(provider, err);
      if (!isProviderUnusableError(err)) {
        throw enrichError(err, attempted, failures);
      }
      // Try next provider in chain.
    }
  }

  throw enrichError(lastErr, attempted, failures);
}

/**
 * Non-streaming chat completion with the same provider chain as streaming chat.
 * Used by companion generation, evolution, and other one-shot LLM helpers.
 */
export async function createChatCompletionWithFailover(
  req: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  beginChatProviderTurn();
  const chain = requireProviderChain();
  const brand: LlmBrand | undefined = isAnimaCustomMode() ? "anima" : undefined;
  const attempted: LlmProviderId[] = [];
  const failures: Array<{ provider: LlmProviderId; err: unknown }> = [];
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
      failures.push({ provider, err });
      recordProviderFailure(provider, err);
      if (!isProviderUnusableError(err)) {
        throw enrichError(err, attempted, failures);
      }
    }
  }

  throw enrichError(lastErr, attempted, failures);
}

/**
 * Live-probe every configured chat provider with a tiny completion.
 * Secret-free — only returns status / short error kind for operators.
 */
export async function probeLlmProviders(
  tier: ModelTier = "standard",
): Promise<LlmProviderProbeResult[]> {
  const candidates: LlmProviderId[] = [
    "gemini",
    "kimi",
    "xai",
    "openai",
    "gateway",
  ];
  const results: LlmProviderProbeResult[] = [];

  for (const provider of candidates) {
    const configured =
      (provider === "gemini" && hasGeminiKey()) ||
      (provider === "kimi" && hasKimiKey()) ||
      (provider === "xai" && hasXaiKey()) ||
      (provider === "openai" && hasOpenAIKey()) ||
      (provider === "gateway" && hasGatewayAuth());

    if (!configured) {
      results.push({ provider, configured: false, ok: false });
      continue;
    }

    const resolved = resolveForProvider(provider, tier);
    const started = Date.now();
    try {
      await createCompletion(
        provider,
        { ...resolved, maxTokens: Math.min(resolved.maxTokens, 16) },
        [{ role: "user", content: "Reply with the single word: ok" }],
        0,
      );
      results.push({
        provider,
        configured: true,
        ok: true,
        model: resolved.model,
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status?: unknown }).status)
          : undefined;
      results.push({
        provider,
        configured: true,
        ok: false,
        status: Number.isFinite(status) ? status : undefined,
        errorKind: isProviderAuthError(err)
          ? "auth"
          : isProviderUnusableError(err)
            ? "quota"
            : "other",
        message: summarizeProviderError(err),
        model: resolved.model,
        latencyMs: Date.now() - started,
      });
    }
  }

  return results;
}

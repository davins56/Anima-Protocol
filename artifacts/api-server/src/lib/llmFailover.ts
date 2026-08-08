// Cross-provider chat completion with automatic failover.
//
// Preferred product path: a **custom self-hosted Anima LLM** (vLLM / Ollama /
// llama.cpp) — no Gemini, Groq, Kimi, Grok, or AI Gateway required.
//
// Provider selection is controlled by ANIMA_LLM_PROVIDER:
//   - (unset) / custom / anima / local — self-hosted Anima LLM ONLY (default)
//   - local-first / vllm / ollama — local first, then optional cloud auto chain
//   - auto                   — cloud BYOK: Gemini → Groq → Kimi → Grok → OpenAI → Gateway
//   - gemini / groq / kimi / xai / openai / gateway — single-provider cloud modes
//   - ensemble               — opt-in cloud parallel-minds path (see llmEnsemble.ts)
//
// Local endpoint: ANIMA_LOCAL_LLM_BASE_URL (or VLLM_BASE_URL / OLLAMA_BASE_URL).
// Required for the default custom mode on Vercel (set a public HTTPS URL).
//
// Values that look like API keys pasted into ANIMA_LLM_PROVIDER are ignored
// (common Vercel misconfig: AQ.* Gemini key in the wrong field) and the default
// custom/local mode is used — they do NOT unlock the cloud chain. Put keys in
// GEMINI_API_KEY / GROQ_API_KEY / … and set ANIMA_LLM_PROVIDER=auto only if you
// explicitly want cloud BYOK.
//
// Hard gate: no cloud-capable mode (auto / local-first / openai / xai / gemini /
// groq / kimi / gateway) — and no ensemble parallel-minds path — can activate
// unless ANIMA_ALLOW_CLOUD_LLM=true is also set. Without that second flag,
// ANIMA_LLM_PROVIDER=auto (or any other cloud mode) is silently downgraded to
// `local` so a mistyped/leftover env var can never switch chat onto a flagship
// provider. See isCloudLlmAllowed() / wasCloudModeBlockedByGate().
//
// ANIMA_DISABLE_OPENAI=true blocks OpenAI under `auto`.
// ANIMA_DISABLE_GROQ=true blocks Groq under `auto` / `openai`.
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
  getGroqClient,
  getKimiClient,
  getLocalLlmClient,
  getOpenAIClient,
  getXaiClient,
  hasGatewayAuth,
  hasGeminiKey,
  hasGroqKey,
  hasKimiKey,
  hasLocalLlm,
  hasOpenAIKey,
  hasXaiKey,
  logLocalLlmClientInitOnce,
  summarizeLocalLlmBaseUrl,
} from "./openaiClient";
import { resolveModelSpec } from "@workspace/llm";

/** Chat providers selected by failover / ensemble. */
export type LlmProviderId =
  | "openai"
  | "xai"
  | "gemini"
  | "groq"
  | "kimi"
  | "gateway"
  | "local";

export type LlmProviderMode =
  | "auto"
  | "openai"
  | "xai"
  | "gemini"
  | "groq"
  | "kimi"
  | "gateway"
  | "local"
  | "local-first"
  | "anima";

/** Brand for the self-hosted Anima LLM (when ANIMA_LLM_PROVIDER=anima|custom|local). */
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
    groq: boolean;
    gateway: boolean;
    local: boolean;
  };
  /**
   * Secret-free custom/local endpoint diagnostics. Host only — never the full
   * URL with credentials. Use this to confirm ANIMA_LOCAL_LLM_BASE_URL + model
   * on Vercel without opening the env UI.
   */
  localEndpoint: {
    configured: boolean;
    host: string | null;
    hasV1Path: boolean;
    isHttps: boolean;
    isLocalhost: boolean;
    backend: string;
    model: string;
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
  /**
   * OpenAI-compatible tool schemas. Honored by every provider in the chain
   * except native Gemini (no tool-calling support in geminiNative.ts) — that
   * leg simply ignores tools rather than dropping out of the chain.
   */
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
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
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null;
}

// Sticky preference after OpenAI billing/credits failure in this process.
let preferNonOpenAI = false;

// Sticky skip after xAI reports no team credits/licenses in this process.
let preferNonXai = false;

// Sticky skip after Kimi / Moonshot reports quota exhaustion or rejects the key.
let preferNonKimi = false;

// Sticky skip after Gemini quota/auth failure in this process.
let preferNonGemini = false;

// Sticky skip after Groq quota/auth failure in this process.
let preferNonGroq = false;

// Sticky skip after Vercel AI Gateway quota/auth failure in this process.
let preferNonGateway = false;

// Sticky skip after local vLLM/Ollama failure in this process.
let preferNonLocal = false;

function clearAllStickySkips(): void {
  preferNonOpenAI = false;
  preferNonXai = false;
  preferNonKimi = false;
  preferNonGemini = false;
  preferNonGroq = false;
  preferNonGateway = false;
  preferNonLocal = false;
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
  // Product default: Anima self-hosted LLM only. Cloud BYOK requires an
  // explicit ANIMA_LLM_PROVIDER=auto (or gemini/groq/…).
  return "local";
}

/**
 * Master switch for every cloud/flagship code path (sequential failover chain
 * AND the ensemble parallel-minds path). Anima chat must never silently start
 * calling Gemini/Groq/Kimi/Grok/ChatGPT just because ANIMA_LLM_PROVIDER got
 * fat-fingered to "auto" (or a stray ensemble flag) in an env panel — it takes
 * a second, explicit opt-in to unlock the cloud chain at all.
 */
export function isCloudLlmAllowed(): boolean {
  return envFlagEnabled("ANIMA_ALLOW_CLOUD_LLM");
}

/** Modes that can dial out to a cloud flagship provider (directly or as fallback). */
const CLOUD_CAPABLE_MODES: ReadonlySet<LlmProviderMode> = new Set([
  "auto",
  "openai",
  "xai",
  "gemini",
  "groq",
  "kimi",
  "gateway",
  "local-first",
]);

function resolveRequestedProviderMode(): LlmProviderMode {
  const raw = sanitizeProviderEnv(process.env.ANIMA_LLM_PROVIDER);
  // Unset OR API-key pasted into the wrong field → custom Anima LLM (not auto).
  if (!raw) return defaultProviderMode();
  if (raw === "grok") return "xai";
  if (raw === "moonshot") return "kimi";
  if (raw === "ai-gateway" || raw === "vercel-gateway") return "gateway";
  // custom / anima = self-hosted Anima LLM (not cloud BYOK, not ensemble).
  if (raw === "custom" || raw === "anima" || raw === "local") {
    return "local";
  }
  // Opt-in cloud parallel-minds; sequential fallback uses the auto chain.
  if (raw === "ensemble") {
    return "auto";
  }
  // vllm / ollama → hybrid local-first unless ANIMA_LOCAL_ONLY is set.
  if (raw === "local-first" || raw === "vllm" || raw === "ollama") {
    if (envFlagEnabled("ANIMA_LOCAL_ONLY")) return "local";
    return "local-first";
  }
  if (
    raw === "xai" ||
    raw === "openai" ||
    raw === "kimi" ||
    raw === "auto" ||
    raw === "gemini" ||
    raw === "groq" ||
    raw === "gateway"
  ) {
    return raw;
  }
  return defaultProviderMode();
}

/**
 * True when ANIMA_LLM_PROVIDER asked for a cloud-capable mode but it was
 * downgraded to `local` because ANIMA_ALLOW_CLOUD_LLM is not set.
 */
export function wasCloudModeBlockedByGate(): boolean {
  const requested = resolveRequestedProviderMode();
  return CLOUD_CAPABLE_MODES.has(requested) && !isCloudLlmAllowed();
}

export function getConfiguredProviderMode(): LlmProviderMode {
  const requested = resolveRequestedProviderMode();
  if (CLOUD_CAPABLE_MODES.has(requested) && !isCloudLlmAllowed()) {
    // Cloud chain requested but the explicit gate isn't set — stay on the
    // self-hosted Anima LLM instead of silently dialing out to a flagship
    // provider chain.
    return "local";
  }
  return requested;
}

/** True when using the branded self-hosted Anima LLM (not cloud ensemble). */
export function isAnimaCustomMode(): boolean {
  const mode = getConfiguredProviderMode();
  return mode === "local" || mode === "local-first";
}

/** True when OpenAI is blocked by config (mode / ANIMA_DISABLE_OPENAI), not sticky. */
export function isOpenAIBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (
    mode === "xai" ||
    mode === "kimi" ||
    mode === "gemini" ||
    mode === "groq" ||
    mode === "gateway" ||
    mode === "local"
  ) {
    return true;
  }
  return envFlagEnabled("ANIMA_DISABLE_OPENAI");
}

/** True when Groq is blocked by config (mode / ANIMA_DISABLE_GROQ), not sticky. */
export function isGroqBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (
    mode === "kimi" ||
    mode === "gemini" ||
    mode === "xai" ||
    mode === "gateway" ||
    mode === "local"
  ) {
    return true;
  }
  return envFlagEnabled("ANIMA_DISABLE_GROQ");
}

/** True when Grok is blocked by config (mode / ANIMA_DISABLE_XAI), not sticky. */
export function isXaiBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (
    mode === "kimi" ||
    mode === "gemini" ||
    mode === "groq" ||
    mode === "gateway" ||
    mode === "local"
  ) {
    return true;
  }
  return envFlagEnabled("ANIMA_DISABLE_XAI");
}

/** True when AI Gateway is blocked by config / ANIMA_DISABLE_GATEWAY. */
export function isGatewayBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  if (
    mode === "kimi" ||
    mode === "gemini" ||
    mode === "groq" ||
    mode === "xai" ||
    mode === "openai" ||
    mode === "local"
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

/** Sticky skip after a prior Groq unusable failure. */
export function isGroqStickySkipped(): boolean {
  return preferNonGroq;
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
    preferNonGroq ||
    preferNonGateway ||
    preferNonLocal
  );
}

function hasAnyChatKey(): boolean {
  return (
    hasLocalLlm() ||
    hasGeminiKey() ||
    hasGroqKey() ||
    hasKimiKey() ||
    hasXaiKey() ||
    hasOpenAIKey() ||
    hasGatewayAuth()
  );
}

/** Sticky skip after a prior local LLM failure. */
export function isLocalStickySkipped(): boolean {
  return preferNonLocal;
}

/**
 * If sticky skips would hide Gemini/Kimi or empty the chain while keys exist,
 * clear them. Prevents warm isolates from falling through to "tried OpenAI"
 * alone after earlier Gemini/Kimi quota failures.
 */
export function reviveStickySkippedProvidersIfNeeded(): boolean {
  if (!hasAnyStickySkip()) return false;
  if (!hasAnyChatKey()) return false;

  const localOk = hasLocalLlm() && !preferNonLocal;
  const geminiOk = hasGeminiKey() && !preferNonGemini && !isGeminiConfigBlocked();
  const groqOk = hasGroqKey() && !preferNonGroq && !isGroqBlocked();
  const kimiOk = hasKimiKey() && !preferNonKimi && !isKimiConfigBlocked();
  const xaiOk = hasXaiKey() && !isXaiBlocked() && !preferNonXai;
  const openaiOk = hasOpenAIKey() && !isOpenAIBlocked() && !preferNonOpenAI;
  const gatewayOk =
    hasGatewayAuth() && !isGatewayBlocked() && !preferNonGateway;
  const nothingLeft =
    !localOk &&
    !geminiOk &&
    !groqOk &&
    !kimiOk &&
    !xaiOk &&
    !openaiOk &&
    !gatewayOk;
  // Only revive early preferred slots (local/Gemini/Kimi) when sticky-hidden —
  // Groq/OpenAI/xAI sticky skips stay until the chain would otherwise empty.
  const hidingPreferred =
    (preferNonLocal && hasLocalLlm()) ||
    (preferNonGemini && hasGeminiKey() && !isGeminiConfigBlocked()) ||
    (preferNonKimi && hasKimiKey() && !isKimiConfigBlocked());

  if (!nothingLeft && !hidingPreferred) return false;

  clearAllStickySkips();
  return true;
}

/** Config-only Gemini block (mode=kimi|xai|openai|groq|gateway|local can leave Gemini out). */
function isGeminiConfigBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  return (
    mode === "kimi" ||
    mode === "xai" ||
    mode === "openai" ||
    mode === "groq" ||
    mode === "gateway" ||
    mode === "local"
  );
}

function isKimiConfigBlocked(): boolean {
  const mode = getConfiguredProviderMode();
  return (
    mode === "gemini" ||
    mode === "groq" ||
    mode === "gateway" ||
    mode === "local"
  );
}

/** Gemini is selectable when a key is present (no longer retired). */
export function isGeminiBlocked(): boolean {
  return isGeminiConfigBlocked() || preferNonGemini;
}

function providerAvailable(id: LlmProviderId): boolean {
  if (id === "local") {
    return hasLocalLlm() && !preferNonLocal;
  }
  if (id === "gemini") {
    return hasGeminiKey() && !isGeminiConfigBlocked() && !preferNonGemini;
  }
  if (id === "groq") {
    return hasGroqKey() && !isGroqBlocked() && !preferNonGroq;
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

/**
 * Provider order for Anima custom / ensemble drafts.
 * Core stack: Gemini + Groq + ChatGPT (OpenAI).
 */
export function getAnimaTierProviderOrder(_tier: ModelTier): LlmProviderId[] {
  return ["gemini", "groq", "openai"];
}

/** Ordered list of providers to try for the current env / sticky state. */
export function getProviderChain(_tier: ModelTier = "standard"): LlmProviderId[] {
  reviveStickySkippedProvidersIfNeeded();

  const mode = getConfiguredProviderMode();
  const chain: LlmProviderId[] = [];

  const push = (id: LlmProviderId) => {
    if (providerAvailable(id) && !chain.includes(id)) chain.push(id);
  };

  const pushCloudAuto = () => {
    push("gemini");
    push("groq");
    push("kimi");
    push("xai");
    push("openai");
    push("gateway");
  };

  if (mode === "local") {
    push("local");
    return chain;
  }

  if (mode === "local-first") {
    push("local");
    pushCloudAuto();
    return chain;
  }

  if (mode === "kimi") {
    push("kimi");
    return chain;
  }

  if (mode === "gemini") {
    push("gemini");
    return chain;
  }

  if (mode === "groq") {
    push("groq");
    return chain;
  }

  if (mode === "gateway") {
    push("gateway");
    return chain;
  }

  if (mode === "openai") {
    push("openai");
    push("gemini");
    push("groq");
    push("kimi");
    push("xai");
    push("gateway");
    return chain;
  }

  if (mode === "xai") {
    push("xai");
    push("gemini");
    push("groq");
    push("kimi");
    push("gateway");
    return chain;
  }

  // auto — Gemini → Groq → Kimi → Grok → OpenAI, then AI Gateway last resort.
  pushCloudAuto();
  return chain;
}

export function getPreferredProvider(tier: ModelTier = "standard"): LlmProviderId {
  const chain = getProviderChain(tier);
  if (chain[0]) return chain[0];
  if (hasLocalLlm()) return "local";
  if (hasGeminiKey()) return "gemini";
  if (hasGroqKey()) return "groq";
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
  const localSummary = summarizeLocalLlmBaseUrl();
  const backend =
    (process.env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase() || "ollama";
  const localModel =
    process.env.ANIMA_OLLAMA_MODEL_STANDARD?.trim() ||
    process.env.ANIMA_VLLM_MODEL?.trim() ||
    resolveLocalModel(tier).model;
  // Emit a one-time init line so Vercel logs show host/model without secrets.
  if (mode === "local" || mode === "local-first") {
    logLocalLlmClientInitOnce();
  }
  const noteParts: string[] = [];
  if (rawInput && !sanitized) {
    noteParts.push(
      "ANIMA_LLM_PROVIDER looks like an API key and was ignored — chat stays on custom Anima LLM (not the cloud chain). Put the key in GEMINI_API_KEY / GROQ_API_KEY / … and set ANIMA_LLM_PROVIDER=custom (or delete it). Use auto only if you want cloud BYOK.",
    );
  }
  if (wasCloudModeBlockedByGate()) {
    noteParts.push(
      `ANIMA_LLM_PROVIDER=${sanitized} requested a cloud provider chain, but it was blocked and chat stayed on the self-hosted Anima LLM because ANIMA_ALLOW_CLOUD_LLM is not set to true. Set ANIMA_ALLOW_CLOUD_LLM=true if you really want Gemini/Groq/Kimi/Grok/ChatGPT/Gateway to be reachable.`,
    );
  }
  if (preferNonLocal) {
    noteParts.push("Local LLM sticky-skipped after a prior failure this process.");
  }
  if (preferNonGemini) {
    noteParts.push("Gemini sticky-skipped after a prior quota/auth failure this process.");
  }
  if (preferNonGroq) {
    noteParts.push("Groq sticky-skipped after a prior quota/auth failure this process.");
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
      "Chat uses the cloud BYOK chain (Gemini → Groq → Kimi → Grok → OpenAI → Gateway). Set ANIMA_LLM_PROVIDER=custom to use only the Anima LLM.",
    );
  } else if (mode === "local") {
    if (!localSummary.configured) {
      noteParts.push(
        "Anima custom LLM is selected, but ANIMA_LOCAL_LLM_BASE_URL is not set (or the endpoint is unreachable). Host Ollama/vLLM with a public HTTPS OpenAI-compatible URL, set ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1 and ANIMA_OLLAMA_MODEL_STANDARD=anima-chat (or your vLLM model id), then redeploy. Gemini/Groq/Kimi/Grok/ChatGPT/Gateway are intentionally NOT used in custom mode. Only set ANIMA_LLM_PROVIDER=auto if you want the cloud BYOK chain. See docs/custom-llm.md.",
      );
    } else {
      noteParts.push(
        `Chat uses the custom self-hosted Anima LLM only (vLLM/Ollama/llama.cpp) at host=${localSummary.host ?? "?"} model=${localModel}. No Gemini/Groq/Kimi/Grok/Gateway.`,
      );
      if (localSummary.isLocalhost && (process.env.VERCEL || process.env.VERCEL_ENV)) {
        noteParts.push(
          "WARNING: local endpoint is localhost on Vercel — serverless cannot reach it. Use a public HTTPS tunnel URL.",
        );
      } else if (!localSummary.isHttps && (process.env.VERCEL || process.env.VERCEL_ENV)) {
        noteParts.push(
          "WARNING: local endpoint is not HTTPS — Vercel egress often requires https://…/v1.",
        );
      } else if (!localSummary.hasV1Path) {
        noteParts.push(
          "WARNING: base URL should end with /v1 for OpenAI-compatible chat/completions.",
        );
      }
    }
  } else if (mode === "local-first") {
    noteParts.push(
      "Chat prefers the custom local model, then fails over to the cloud auto chain if the local endpoint fails.",
    );
  } else if (mode === "gemini") {
    noteParts.push("Chat is Gemini-only (ANIMA_LLM_PROVIDER=gemini).");
  } else if (mode === "groq") {
    noteParts.push("Chat is Groq-only (ANIMA_LLM_PROVIDER=groq).");
  } else if (mode === "kimi") {
    noteParts.push(
      "Chat is Kimi-only (ANIMA_LLM_PROVIDER=kimi). Set ANIMA_LLM_PROVIDER=custom for a self-hosted model.",
    );
  } else if (mode === "gateway") {
    noteParts.push(
      "Chat is AI Gateway-only (ANIMA_LLM_PROVIDER=gateway). Uses AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
    );
  } else if (preferred) {
    noteParts.push("Chat uses the configured provider chain.");
  } else {
    noteParts.push(
      "No chat LLM configured. For a custom model set ANIMA_LLM_PROVIDER=custom and ANIMA_LOCAL_LLM_BASE_URL (vLLM/Ollama).",
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
      groq: hasGroqKey(),
      gateway: hasGatewayAuth(),
      local: hasLocalLlm(),
    },
    localEndpoint: {
      configured: localSummary.configured,
      host: localSummary.host,
      hasV1Path: localSummary.hasV1Path,
      isHttps: localSummary.isHttps,
      isLocalhost: localSummary.isLocalhost,
      backend,
      model: localModel,
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

// gemini-2.5-flash-lite is blocked for many new AI Studio keys ("no longer
// available to new users"). Prefer 3.1 Flash-Lite for light turns; keep 2.5
// Flash/Pro for standard/heavy until those lanes retire.
const DEFAULT_GEMINI_MODELS: Record<ModelTier, string> = {
  light: "gemini-3.1-flash-lite",
  standard: "gemini-2.5-flash",
  heavy: "gemini-2.5-pro",
};

/** Extra Gemini model IDs to try after the routed tier fails as unavailable. */
const GEMINI_RESCUE_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-flash-latest",
] as const;

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

// Groq Cloud OpenAI-compatible lineup (fast Llama). Override with ANIMA_GROQ_MODEL_*.
const DEFAULT_GROQ_MODELS: Record<ModelTier, string> = {
  light: "llama-3.1-8b-instant",
  standard: "llama-3.3-70b-versatile",
  heavy: "llama-3.3-70b-versatile",
};

const GROQ_ENV_KEYS: Record<ModelTier, string> = {
  light: "ANIMA_GROQ_MODEL_LIGHT",
  standard: "ANIMA_GROQ_MODEL_STANDARD",
  heavy: "ANIMA_GROQ_MODEL_HEAVY",
};

// Vercel AI Gateway model slugs (provider/model). Avoid retired Flash-Lite 2.5.
const DEFAULT_GATEWAY_MODELS: Record<ModelTier, string> = {
  light: "google/gemini-3.1-flash-lite",
  standard: "google/gemini-2.5-flash",
  heavy: "google/gemini-2.5-pro",
};

const GATEWAY_RESCUE_MODELS = [
  "google/gemini-3.1-flash-lite",
  "google/gemini-2.5-flash",
  "google/gemini-flash-latest",
] as const;

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

export function resolveGroqModel(tier: ModelTier): ResolvedModel {
  const override =
    process.env[GROQ_ENV_KEYS[tier]]?.trim() ||
    process.env.ANIMA_GROQ_MODEL?.trim();
  const openaiResolved = resolveModel(tier);
  return {
    tier,
    model: override || DEFAULT_GROQ_MODELS[tier],
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

function providerLabel(id: LlmProviderId): string {
  if (id === "local") return "Local LLM";
  if (id === "xai") return "Grok (xAI)";
  if (id === "gemini") return "Gemini";
  if (id === "groq") return "Groq";
  if (id === "kimi") return "Kimi (Moonshot)";
  if (id === "gateway") return "AI Gateway";
  return "ChatGPT (OpenAI)";
}

function clientFor(provider: Exclude<LlmProviderId, "gemini">): OpenAI {
  if (provider === "local") {
    const client = getLocalLlmClient();
    if (!client) {
      throw new Error(
        "ANIMA_LOCAL_LLM_BASE_URL (or VLLM_BASE_URL / OLLAMA_BASE_URL) must be set to use the local LLM provider.",
      );
    }
    return client;
  }
  if (provider === "xai") {
    const client = getXaiClient();
    if (!client) {
      throw new Error("XAI_API_KEY must be set to use the Grok provider.");
    }
    return client;
  }
  if (provider === "groq") {
    const client = getGroqClient();
    if (!client) {
      throw new Error("GROQ_API_KEY must be set to use the Groq provider.");
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
  if (provider === "local") return resolveLocalModel(tier);
  if (provider === "gemini") return resolveGeminiModel(tier);
  if (provider === "groq") return resolveGroqModel(tier);
  if (provider === "xai") return resolveXaiModel(tier);
  if (provider === "kimi") return resolveKimiModel(tier);
  if (provider === "gateway") return resolveGatewayModel(tier);
  return resolveModel(tier);
}

function otherVendorAvailable(excluding: LlmProviderId): boolean {
  if (excluding !== "local" && hasLocalLlm()) return true;
  if (excluding !== "gemini" && hasGeminiKey()) return true;
  if (excluding !== "groq" && hasGroqKey()) return true;
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
  // Quota/auth *and* retired-model 404s — otherwise a dead Gemini model ID
  // sticky-blocks the whole chain from reaching Kimi / Gateway.
  if (
    (isProviderUnusableError(err) || isModelUnavailableError(err)) &&
    otherVendorAvailable("gemini")
  ) {
    preferNonGemini = true;
  }
}

/**
 * After intra-provider model fallback fails, continue to the next vendor for
 * quota/auth *and* retired/unknown model IDs. A Gemini 404 used to abort the
 * whole chain before AI Gateway could answer.
 */
function shouldTryNextProvider(err: unknown): boolean {
  if (isProviderUnusableError(err) || isModelUnavailableError(err)) return true;
  if (!err || typeof err !== "object") return false;
  const code = String((err as { code?: unknown }).code || "").toLowerCase();
  return code === "empty_visible_text" || code === "empty_stream";
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
  if (provider === "local") {
    // Connection refused / 5xx / empty model → try cloud hybrid chain.
    if (otherVendorAvailable("local")) {
      preferNonLocal = true;
    }
    return;
  }
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
  if (provider === "groq") {
    if (isProviderUnusableError(err) && otherVendorAvailable("groq")) {
      preferNonGroq = true;
    }
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
  if (
    (isProviderUnusableError(err) || isModelUnavailableError(err)) &&
    otherVendorAvailable("gateway")
  ) {
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
      if (id === "local") return "ANIMA_LOCAL_LLM_BASE_URL";
      if (id === "xai") return "XAI_API_KEY";
      if (id === "kimi") return "KIMI_API_KEY";
      if (id === "gemini") return "GEMINI_API_KEY";
      if (id === "groq") return "GROQ_API_KEY";
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
        (attempted.includes("groq")
          ? "Groq uses keys from https://console.groq.com. "
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
          (hasGroqKey() ||
          hasKimiKey() ||
          hasXaiKey() ||
          hasOpenAIKey() ||
          hasGatewayAuth()
            ? " Or set ANIMA_LLM_PROVIDER=auto to allow Groq/Kimi/Grok/OpenAI/Gateway failover."
            : "") +
          trailSuffix,
      );
    }
    if (attempted.length === 1 && attempted[0] === "groq") {
      return new Error(
        `Groq credits/quota exhausted (or the key was rejected). Check GROQ_API_KEY at https://console.groq.com, then redeploy.` +
          (hasGeminiKey() || hasOpenAIKey() || hasGatewayAuth()
            ? " Or set ANIMA_LLM_PROVIDER=auto so Gemini/ChatGPT/Gateway can cover."
            : "") +
          trailSuffix,
      );
    }
    if (attempted.length === 1 && attempted[0] === "kimi") {
      return new Error(
        `Kimi (Moonshot) credits/quota exhausted (or the key was rejected). ` +
          `Check KIMI_API_KEY / MOONSHOT_API_KEY on Vercel and your balance at https://platform.kimi.ai, ` +
          `or set ANIMA_LLM_PROVIDER=auto so Gemini/Groq/OpenAI/Gateway can cover, then redeploy.` +
          trailSuffix,
      );
    }
    if (attempted.length === 1 && attempted[0] === "gateway") {
      return new Error(
        `AI Gateway credits/quota exhausted (or auth failed). Check AI_GATEWAY_API_KEY / Vercel AI Gateway credits at https://vercel.com/docs/ai-gateway, then redeploy.` +
          trailSuffix,
      );
    }
    // Multi-provider quota death: keys were present and tried — do NOT imply
    // "set GROQ_API_KEY / flip ANIMA_LLM_PROVIDER=auto" as the main fix when the
    // auto chain already burned through funded providers.
    const missingUnused: string[] = [];
    if (!attempted.includes("gemini") && !hasGeminiKey()) {
      missingUnused.push("GEMINI_API_KEY");
    }
    if (!attempted.includes("groq") && !hasGroqKey()) {
      missingUnused.push("GROQ_API_KEY (often has a free tier at console.groq.com)");
    }
    if (!attempted.includes("kimi") && !hasKimiKey()) {
      missingUnused.push("KIMI_API_KEY");
    }
    if (!attempted.includes("xai") && !hasXaiKey()) {
      missingUnused.push("XAI_API_KEY");
    }
    if (!attempted.includes("openai") && !isOpenAIBlocked() && !hasOpenAIKey()) {
      missingUnused.push("OPENAI_API_KEY");
    }
    if (!attempted.includes("gateway") && !hasGatewayAuth()) {
      missingUnused.push("AI_GATEWAY_API_KEY");
    }
    if (!attempted.includes("local") && !hasLocalLlm()) {
      missingUnused.push("ANIMA_LOCAL_LLM_BASE_URL (Anima open LLM via Ollama/vLLM)");
    }

    const parts: string[] = [
      " Every cloud provider that was tried rejected the request (quota, billing, or revoked key) — re-pasting the same keys will not restore chat.",
      " Fix options: (1) Preferred — host Anima LLM and set ANIMA_LLM_PROVIDER=custom plus ANIMA_LOCAL_LLM_BASE_URL (see docs/custom-llm.md), then redeploy.",
      " (2) Top up credits for the providers you already use (Google AI Studio / Moonshot / xAI / OpenAI / AI Gateway).",
    ];
    if (missingUnused.length > 0) {
      parts.push(` (3) Optional unused backup: set ${missingUnused.join("; ")}.`);
    }
    parts.push(
      " Note: ANIMA_LLM_PROVIDER must be a mode name (custom|auto|gemini|groq|…), never an API key. Live-check: /api/healthz/llm?probe=1.",
    );
    return new Error(
      `LLM credits/quota exhausted (tried ${names}).${parts.join("")}${trailSuffix}`,
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
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  if (provider === "gemini") {
    // Native Gemini call has no tool-calling support here — the turn still
    // runs, just without tools, rather than dropping this leg of the chain.
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
    ...(tools && tools.length ? { tools, tool_choice: toolChoice ?? "auto" } : {}),
  });
}

function rescueModelsForProvider(
  provider: LlmProviderId,
  preferred: ResolvedModel,
): ResolvedModel[] {
  const seen = new Set<string>();
  const out: ResolvedModel[] = [];
  const push = (model: string) => {
    const id = model.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ ...preferred, model: id });
  };

  push(preferred.model);
  push(resolveForProvider(provider, "standard").model);
  push(resolveForProvider(provider, "light").model);

  if (provider === "gemini") {
    for (const model of GEMINI_RESCUE_MODELS) push(model);
  } else if (provider === "gateway") {
    for (const model of GATEWAY_RESCUE_MODELS) push(model);
  }

  return out;
}

async function withModelFallback<T>(
  provider: LlmProviderId,
  preferred: ResolvedModel,
  run: (resolved: ResolvedModel) => Promise<T>,
): Promise<{ value: T; resolved: ResolvedModel }> {
  const candidates = rescueModelsForProvider(provider, preferred);
  let lastErr: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    try {
      return { value: await run(candidate), resolved: candidate };
    } catch (modelErr) {
      lastErr = modelErr;
      const hasNext = i < candidates.length - 1;
      if (!hasNext || !isModelUnavailableError(modelErr)) {
        throw modelErr;
      }
      // Retired / unknown model → try the next candidate on this provider.
    }
  }

  throw lastErr;
}

function requireProviderChain(): LlmProviderId[] {
  const chain = getProviderChain();
  if (chain.length === 0) {
    const mode = getConfiguredProviderMode();
    if (mode === "local" || mode === "local-first") {
      throw new Error(
        "Anima custom LLM is selected, but ANIMA_LOCAL_LLM_BASE_URL is not set (or the endpoint is unreachable). " +
          "Host Ollama/vLLM with a public HTTPS OpenAI-compatible URL, set ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1 " +
          "and ANIMA_OLLAMA_MODEL_STANDARD=anima-chat (or your vLLM model id), then redeploy. " +
          "Gemini/Groq/Kimi/Grok/ChatGPT/Gateway are intentionally NOT used in custom mode. " +
          "Only set ANIMA_LLM_PROVIDER=auto if you want the cloud BYOK chain. See docs/custom-llm.md.",
      );
    }
    const missing: string[] = [];
    if (!hasLocalLlm()) missing.push("ANIMA_LOCAL_LLM_BASE_URL");
    if (!hasGeminiKey()) missing.push("GEMINI_API_KEY");
    if (!hasGroqKey()) missing.push("GROQ_API_KEY");
    if (!hasKimiKey()) missing.push("KIMI_API_KEY");
    if (!hasXaiKey()) missing.push("XAI_API_KEY");
    if (!hasOpenAIKey()) missing.push("OPENAI_API_KEY");
    if (!hasGatewayAuth()) missing.push("AI_GATEWAY_API_KEY");
    const configNote = isOpenAIBlocked()
      ? " OpenAI is blocked via ANIMA_LLM_PROVIDER / ANIMA_DISABLE_OPENAI."
      : "";
    const modeNote =
      mode === "kimi"
        ? " ANIMA_LLM_PROVIDER=kimi requires a working KIMI_API_KEY."
        : mode === "gemini"
          ? " ANIMA_LLM_PROVIDER=gemini requires a working GEMINI_API_KEY."
          : mode === "groq"
            ? " ANIMA_LLM_PROVIDER=groq requires a working GROQ_API_KEY."
            : mode === "gateway"
              ? " ANIMA_LLM_PROVIDER=gateway requires AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN."
              : "";
    throw new Error(
      missing.length >= 4
        ? `No LLM provider configured. Set ANIMA_LOCAL_LLM_BASE_URL for the Anima LLM, or GEMINI_API_KEY / GROQ_API_KEY / KIMI_API_KEY / XAI_API_KEY / OPENAI_API_KEY / AI_GATEWAY_API_KEY with ANIMA_LLM_PROVIDER=auto.${configNote}${modeNote}`
        : `No usable LLM provider right now.${configNote}${modeNote} Check local endpoint / API keys and redeploy.`,
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
      // Local endpoint down / wrong model → always try the hybrid cloud chain.
      // Retired Gemini model IDs (404) must also fall through to Gateway.
      if (provider !== "local" && !shouldTryNextProvider(err)) {
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
        (m) =>
          createCompletion(
            provider,
            m,
            req.messages,
            req.temperature,
            req.tools,
            req.toolChoice,
          ),
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
        toolCalls: completion.choices?.[0]?.message?.tool_calls ?? null,
      };
    } catch (err) {
      lastErr = err;
      failures.push({ provider, err });
      recordProviderFailure(provider, err);
      if (provider !== "local" && !shouldTryNextProvider(err)) {
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
    "local",
    "gemini",
    "groq",
    "kimi",
    "xai",
    "openai",
    "gateway",
  ];
  const results: LlmProviderProbeResult[] = [];

  for (const provider of candidates) {
    const configured =
      (provider === "local" && hasLocalLlm()) ||
      (provider === "gemini" && hasGeminiKey()) ||
      (provider === "groq" && hasGroqKey()) ||
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
      // Same intra-provider model rescue chat uses, so a retired light model
      // does not report the whole Gemini/Gateway slot as dead.
      const { resolved: used } = await withModelFallback(
        provider,
        { ...resolved, maxTokens: Math.min(resolved.maxTokens, 16) },
        (m) =>
          createCompletion(
            provider,
            m,
            [{ role: "user", content: "Reply with the single word: ok" }],
            0,
          ),
      );
      results.push({
        provider,
        configured: true,
        ok: true,
        model: used.model,
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

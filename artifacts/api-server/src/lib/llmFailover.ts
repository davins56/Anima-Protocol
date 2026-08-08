// Chat completion against the self-hosted Anima LLM (vLLM / Ollama /
// llama.cpp, OpenAI-compatible). There is no cross-provider cloud chain —
// Anima Protocol chat never switches to Gemini, Groq, Kimi, Grok, ChatGPT, or
// any other flagship provider. One model, one endpoint, every turn.
//
// Local endpoint: ANIMA_LOCAL_LLM_BASE_URL (or VLLM_BASE_URL / OLLAMA_BASE_URL).
// Required on Vercel / any serverless deploy — set a public HTTPS URL. See
// docs/custom-llm.md and docs/llm-deploy.md.
//
// Intra-provider "model unavailable" fallback (routed tier → standard → light)
// is preserved so a retired/unknown local model tag doesn't hard-fail a turn
// when a smaller sibling model is still loaded.

import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { isModelUnavailableError, type ModelTier, type ResolvedModel } from "./modelRouter";
import {
  getLocalLlmClient,
  hasLocalLlm,
  logLocalLlmClientInitOnce,
  summarizeLocalLlmBaseUrl,
} from "./openaiClient";
import { resolveModelSpec } from "@workspace/llm";

/** Only one chat provider exists: the self-hosted Anima LLM. */
export type LlmProviderId = "local";

/** Brand for the self-hosted Anima LLM. */
export type LlmBrand = "anima";

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
    backend: string;
    model: string;
  };
  note: string;
}

/** Secret-free live probe result for the local Anima LLM (for /api/healthz/llm?probe=1). */
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
  brand: LlmBrand;
  model: string;
  tier: ModelTier;
  /** Always false — kept for API compatibility with existing callers. */
  failedOver: false;
}

export interface ChatCompletionRequest {
  tier: ModelTier;
  model?: string;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
}

export interface ChatCompletionResult {
  content: string;
  provider: LlmProviderId;
  brand: LlmBrand;
  model: string;
  tier: ModelTier;
  /** Always false — kept for API compatibility with existing callers. */
  failedOver: false;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null;
}

/** Every user chat turn starts fresh — kept as a no-op for API compatibility. */
export function beginChatProviderTurn(): void {
  // No sticky failover state exists anymore; nothing to reset.
}

/** Always true — chat only ever runs on the self-hosted Anima LLM. */
export function isAnimaCustomMode(): true {
  return true;
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

function summarizeError(err: unknown): string {
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

/** True when the local server rejected auth (unlikely, but worth a clear message). */
export function isProviderAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; type?: string; message?: string };
  const code = (e.code || e.type || "").toLowerCase();
  const msg = (e.message || "").toLowerCase();
  if (code.includes("invalid_api_key") || code.includes("authentication_error") || code.includes("invalid_auth")) {
    return true;
  }
  if (
    msg.includes("incorrect api key") ||
    msg.includes("invalid api key") ||
    msg.includes("authentication") ||
    msg.includes("status code (no body)") ||
    msg.includes("401 status code")
  ) {
    return true;
  }
  return e.status === 401;
}

/** True when the local server said the requested model isn't loaded / known. */
function isLocalModelUnavailable(err: unknown): boolean {
  return isModelUnavailableError(err);
}

function rescueModelsForLocal(preferred: ResolvedModel): ResolvedModel[] {
  const seen = new Set<string>();
  const out: ResolvedModel[] = [];
  const push = (model: string) => {
    const id = model.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ ...preferred, model: id });
  };
  push(preferred.model);
  push(resolveLocalModel("standard").model);
  push(resolveLocalModel("light").model);
  return out;
}

async function withModelFallback<T>(
  preferred: ResolvedModel,
  run: (resolved: ResolvedModel) => Promise<T>,
): Promise<{ value: T; resolved: ResolvedModel }> {
  const candidates = rescueModelsForLocal(preferred);
  let lastErr: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    try {
      return { value: await run(candidate), resolved: candidate };
    } catch (err) {
      lastErr = err;
      const hasNext = i < candidates.length - 1;
      if (!hasNext || !isLocalModelUnavailable(err)) {
        throw err;
      }
      // Retired / unknown model tag → try the next candidate on the local server.
    }
  }

  throw lastErr;
}

function requireLocalClient(): OpenAI {
  const client = getLocalLlmClient();
  if (client) return client;
  throw new Error(
    "Anima custom LLM is not configured: ANIMA_LOCAL_LLM_BASE_URL is unset (or the endpoint is unreachable). " +
      "Host Ollama/vLLM with a public HTTPS OpenAI-compatible URL, set ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1 " +
      "and ANIMA_OLLAMA_MODEL_STANDARD=anima-chat (or your vLLM model id), then redeploy. See docs/custom-llm.md and docs/llm-deploy.md.",
  );
}

function enrichError(err: unknown): Error {
  if (isProviderAuthError(err)) {
    return new Error(
      `Anima LLM authentication failed: ${summarizeError(err)}. Check ANIMA_LOCAL_LLM_API_KEY on the local server config, then redeploy.`,
    );
  }
  const base = err instanceof Error ? err : new Error(String(err));
  return base;
}

/** Secret-free routing diagnostic for operators and the chat UI. */
export function getLlmRoutingStatus(tier: ModelTier = "standard"): LlmRoutingStatus {
  const localSummary = summarizeLocalLlmBaseUrl();
  const backend = (process.env.ANIMA_LOCAL_LLM_BACKEND || "").trim().toLowerCase() || "ollama";
  const localModel =
    process.env.ANIMA_OLLAMA_MODEL_STANDARD?.trim() ||
    process.env.ANIMA_VLLM_MODEL?.trim() ||
    resolveLocalModel(tier).model;

  // Emit a one-time init line so Vercel logs show host/model without secrets.
  logLocalLlmClientInitOnce();

  const noteParts: string[] = [];
  if (!localSummary.configured) {
    noteParts.push(
      "ANIMA_LOCAL_LLM_BASE_URL is not set (or the endpoint is unreachable). Host Ollama/vLLM with a public HTTPS OpenAI-compatible URL, set ANIMA_LOCAL_LLM_BASE_URL=https://<host>/v1 and ANIMA_OLLAMA_MODEL_STANDARD=anima-chat (or your vLLM model id), then redeploy. See docs/custom-llm.md.",
    );
  } else {
    noteParts.push(
      `Chat uses the self-hosted Anima LLM only (vLLM/Ollama/llama.cpp) at host=${localSummary.host ?? "?"} model=${localModel}. There is no cloud flagship fallback.`,
    );
    if (localSummary.isLocalhost && (process.env.VERCEL || process.env.VERCEL_ENV)) {
      noteParts.push(
        "WARNING: local endpoint is localhost on Vercel — serverless cannot reach it. Use a public HTTPS tunnel URL.",
      );
    } else if (!localSummary.isHttps && (process.env.VERCEL || process.env.VERCEL_ENV)) {
      noteParts.push("WARNING: local endpoint is not HTTPS — Vercel egress often requires https://…/v1.");
    } else if (!localSummary.hasV1Path) {
      noteParts.push("WARNING: base URL should end with /v1 for OpenAI-compatible chat/completions.");
    }
  }

  return {
    status: hasLocalLlm() ? "ok" : "error",
    preferred: hasLocalLlm() ? "local" : null,
    brand: "anima",
    localEndpoint: {
      configured: localSummary.configured,
      host: localSummary.host,
      hasV1Path: localSummary.hasV1Path,
      isHttps: localSummary.isHttps,
      isLocalhost: localSummary.isLocalhost,
      backend,
      model: localModel,
    },
    note: noteParts.join(" "),
  };
}

/** Live-probe the local Anima LLM with a tiny completion. Secret-free. */
export async function probeLlmProviders(tier: ModelTier = "standard"): Promise<LlmProviderProbeResult[]> {
  if (!hasLocalLlm()) {
    return [{ provider: "local", configured: false, ok: false }];
  }

  const resolved = resolveLocalModel(tier);
  const started = Date.now();
  try {
    const client = requireLocalClient();
    const { resolved: used } = await withModelFallback(
      { ...resolved, maxTokens: Math.min(resolved.maxTokens, 16) },
      (m) =>
        client.chat.completions.create({
          model: m.model,
          max_tokens: m.maxTokens,
          messages: [{ role: "user", content: "Reply with the single word: ok" }],
          temperature: 0,
        }),
    );
    return [
      {
        provider: "local",
        configured: true,
        ok: true,
        model: used.model,
        latencyMs: Date.now() - started,
      },
    ];
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: unknown }).status)
        : undefined;
    return [
      {
        provider: "local",
        configured: true,
        ok: false,
        status: Number.isFinite(status) ? status : undefined,
        errorKind: isProviderAuthError(err) ? "auth" : "other",
        message: summarizeError(err),
        model: resolved.model,
        latencyMs: Date.now() - started,
      },
    ];
  }
}

/** Open a streaming chat completion against the self-hosted Anima LLM. */
export async function createChatStreamWithFailover(req: ChatStreamRequest): Promise<ChatStreamResult> {
  beginChatProviderTurn();
  const client = requireLocalClient();
  const preferred = resolveLocalModel(req.tier);

  try {
    const { value: stream, resolved } = await withModelFallback(preferred, (m) =>
      client.chat.completions.create({
        model: m.model,
        max_tokens: m.maxTokens,
        messages: req.messages,
        stream: true,
      }),
    );
    return {
      stream,
      provider: "local",
      brand: "anima",
      model: resolved.model,
      tier: resolved.tier,
      failedOver: false,
    };
  } catch (err) {
    throw enrichError(err);
  }
}

/**
 * Non-streaming chat completion against the self-hosted Anima LLM.
 * Used by companion generation, evolution, and other one-shot LLM helpers.
 */
export async function createChatCompletionWithFailover(
  req: ChatCompletionRequest,
): Promise<ChatCompletionResult> {
  beginChatProviderTurn();
  const client = requireLocalClient();
  const preferred = resolveLocalModel(req.tier);

  try {
    const { value: completion, resolved } = await withModelFallback(preferred, (m) =>
      client.chat.completions.create({
        model: m.model,
        max_tokens: m.maxTokens,
        messages: req.messages,
        ...(typeof req.temperature === "number" ? { temperature: req.temperature } : {}),
        ...(req.tools && req.tools.length
          ? { tools: req.tools, tool_choice: req.toolChoice ?? "auto" }
          : {}),
      }),
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
  } catch (err) {
    throw enrichError(err);
  }
}

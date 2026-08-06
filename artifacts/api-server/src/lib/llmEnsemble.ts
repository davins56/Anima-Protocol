// Parallel "minds" ensemble for the Anima custom LLM.
//
// Core stack: Gemini + Groq + ChatGPT (OpenAI) draft in parallel; the app
// synthesizes those drafts into one in-character companion reply and streams
// it to the client. Sticky failover blocks from llmFailover are honored.
//
// Enabled when ANIMA_LLM_PROVIDER is anima | custom | ensemble (see
// isAnimaCustomMode), or when ANIMA_LLM_ENSEMBLE=true under other modes.

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createGeminiChatCompletion } from "./geminiNative";
import {
  getGroqClient,
  getOpenAIClient,
  hasGeminiKey,
  hasGroqKey,
  hasOpenAIKey,
} from "./openaiClient";
import {
  beginChatProviderTurn,
  getAnimaTierProviderOrder,
  isAnimaCustomMode,
  isGeminiStickySkipped,
  isGroqStickySkipped,
  isOpenAIStickySkipped,
  isProviderUnusableError,
  recordProviderFailure,
  resolveGeminiModel,
  resolveGroqModel,
  reviveStickySkippedProvidersIfNeeded,
  type LlmBrand,
  type LlmProviderId,
} from "./llmFailover";
import { resolveModel, type ModelTier } from "./modelRouter";

/** Providers that may participate in ensemble drafts (Anima core trio). */
type EnsembleMindId = Extract<LlmProviderId, "gemini" | "groq" | "openai">;

export interface MindDraft {
  provider: EnsembleMindId;
  model: string;
  content: string;
  latencyMs: number;
}

export interface EnsembleProgressEvent {
  status: "ensemble";
  phase: "gathering" | "combining" | "streaming";
  minds: EnsembleMindId[];
  drafts?: number;
  synthesizer?: EnsembleMindId;
}

export interface EnsembleChatRequest {
  tier: ModelTier;
  model: string;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
  /** Optional SSE writer for progress before content tokens. */
  onProgress?: (event: EnsembleProgressEvent) => void;
}

export interface EnsembleChatResult {
  content: string;
  provider: EnsembleMindId;
  brand: LlmBrand;
  model: string;
  tier: ModelTier;
  minds: EnsembleMindId[];
  drafts: MindDraft[];
  synthesizer: EnsembleMindId;
  combined: boolean;
}

function envFlagEnabled(name: string): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function mindTimeoutMs(): number {
  const raw = Number(process.env.ANIMA_ENSEMBLE_MIND_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 2000 ? raw : 14_000;
}

function maxMinds(): number {
  const raw = Number(process.env.ANIMA_ENSEMBLE_MAX_MINDS);
  return Number.isFinite(raw) && raw >= 1 ? Math.min(3, Math.floor(raw)) : 3;
}

/** True when chat should gather parallel minds + combine (not sequential failover). */
export function isEnsembleMode(): boolean {
  if (envFlagEnabled("ANIMA_LLM_ENSEMBLE")) return true;
  return isAnimaCustomMode();
}

/**
 * Backends that can draft a mind reply right now.
 * Honors sticky unusable skips + ANIMA_DISABLE_* flags.
 * Core Anima minds: Gemini, Groq, ChatGPT.
 */
export function getEnsembleMinds(tier: ModelTier = "standard"): EnsembleMindId[] {
  reviveStickySkippedProvidersIfNeeded();

  const disableOpenAI = envFlagEnabled("ANIMA_DISABLE_OPENAI");
  const disableGroq = envFlagEnabled("ANIMA_DISABLE_GROQ");
  const minds: EnsembleMindId[] = [];

  for (const id of getAnimaTierProviderOrder(tier)) {
    if (
      id === "gemini" &&
      hasGeminiKey() &&
      !isGeminiStickySkipped()
    ) {
      minds.push("gemini");
      continue;
    }
    if (
      id === "groq" &&
      hasGroqKey() &&
      !disableGroq &&
      !isGroqStickySkipped()
    ) {
      minds.push("groq");
      continue;
    }
    if (
      id === "openai" &&
      hasOpenAIKey() &&
      !disableOpenAI &&
      !isOpenAIStickySkipped()
    ) {
      minds.push("openai");
    }
  }

  return minds.slice(0, maxMinds());
}

function providerLabel(id: EnsembleMindId): string {
  if (id === "gemini") return "Gemini";
  if (id === "groq") return "Groq";
  return "ChatGPT";
}

function resolveMindModel(provider: EnsembleMindId, tier: ModelTier) {
  if (provider === "gemini") return resolveGeminiModel(tier);
  if (provider === "groq") return resolveGroqModel(tier);
  return resolveModel(tier);
}

/**
 * Run an async provider call with a hard timeout that aborts the underlying
 * HTTP request via AbortSignal (so timed-out minds don't keep burning tokens).
 */
export async function withAbortTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${ms}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function draftFromMind(
  provider: EnsembleMindId,
  tier: ModelTier,
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
  signal: AbortSignal,
): Promise<MindDraft> {
  const started = Date.now();
  // Keep mind drafts shorter so parallel fan-out stays inside the Vercel budget.
  const draftMax = Math.min(maxTokens, 1200);
  const resolved = resolveMindModel(provider, tier);

  let content = "";
  if (provider === "gemini") {
    const completion = await createGeminiChatCompletion({
      model: resolved.model,
      maxTokens: draftMax,
      messages,
      temperature: 0.8,
      signal,
    });
    content = String(completion.choices[0]?.message?.content ?? "").trim();
  } else {
    const client =
      provider === "groq" ? getGroqClient() : getOpenAIClient();
    if (!client) {
      throw new Error(`${providerLabel(provider)} client is not configured.`);
    }
    const completion = await client.chat.completions.create(
      {
        model: resolved.model,
        max_tokens: draftMax,
        messages,
        temperature: 0.8,
      },
      { signal },
    );
    content = String(completion.choices[0]?.message?.content ?? "").trim();
  }

  if (!content) {
    throw new Error(`${providerLabel(provider)} returned an empty draft.`);
  }

  return {
    provider,
    model: resolved.model,
    content,
    latencyMs: Date.now() - started,
  };
}

function pickSynthesizer(drafts: MindDraft[]): EnsembleMindId {
  const order: EnsembleMindId[] = ["gemini", "groq", "openai"];
  for (const id of order) {
    if (drafts.some((d) => d.provider === id)) return id;
  }
  return drafts[0]!.provider;
}

function buildSynthesisMessages(
  originalMessages: ChatCompletionMessageParam[],
  drafts: MindDraft[],
): ChatCompletionMessageParam[] {
  const system = originalMessages.find((m) => m.role === "system");
  const systemText =
    typeof system?.content === "string"
      ? system.content
      : "You are an in-character AI companion.";

  const draftBlock = drafts
    .map(
      (d, i) =>
        `--- Mind ${i + 1}: ${providerLabel(d.provider)} (${d.model}) ---\n${d.content}`,
    )
    .join("\n\n");

  const userTurns = originalMessages.filter((m) => m.role !== "system");

  return [
    {
      role: "system",
      content:
        `${systemText}\n\n` +
        `MULTI-MIND SYNTHESIS MODE:\n` +
        `Several AI minds drafted candidate replies below. Produce ONE final in-character ` +
        `companion reply that blends the strongest emotional truth, voice, and specificity ` +
        `from those drafts. Do not mention the minds, drafts, Gemini, Groq, ChatGPT, ` +
        `or that you are combining answers. Stay fully in character. Output only the final reply.`,
    },
    ...userTurns,
    {
      role: "user",
      content:
        `Here are the mind drafts to synthesize into your single reply:\n\n${draftBlock}\n\n` +
        `Write the final in-character reply now.`,
    },
  ];
}

async function synthesizeDrafts(
  synthesizer: EnsembleMindId,
  tier: ModelTier,
  originalMessages: ChatCompletionMessageParam[],
  drafts: MindDraft[],
  maxTokens: number,
  signal: AbortSignal,
): Promise<{ content: string; model: string }> {
  const resolved = resolveMindModel(synthesizer, tier);
  const messages = buildSynthesisMessages(originalMessages, drafts);

  if (synthesizer === "gemini") {
    const completion = await createGeminiChatCompletion({
      model: resolved.model,
      maxTokens,
      messages,
      temperature: 0.7,
      signal,
    });
    return {
      content: String(completion.choices[0]?.message?.content ?? "").trim(),
      model: resolved.model,
    };
  }

  const client =
    synthesizer === "groq" ? getGroqClient() : getOpenAIClient();
  if (!client) {
    throw new Error(`${providerLabel(synthesizer)} client is not configured.`);
  }
  const completion = await client.chat.completions.create(
    {
      model: resolved.model,
      max_tokens: maxTokens,
      messages,
      temperature: 0.7,
    },
    { signal },
  );
  return {
    content: String(completion.choices[0]?.message?.content ?? "").trim(),
    model: resolved.model,
  };
}

function fastestDraft(drafts: MindDraft[]): MindDraft {
  return [...drafts].sort((a, b) => a.latencyMs - b.latencyMs)[0]!;
}

function draftFallbackResult(
  req: EnsembleChatRequest,
  drafts: MindDraft[],
  best: MindDraft,
): EnsembleChatResult {
  req.onProgress?.({
    status: "ensemble",
    phase: "streaming",
    minds: drafts.map((d) => d.provider),
    drafts: drafts.length,
    synthesizer: best.provider,
  });
  return {
    content: best.content,
    provider: best.provider,
    brand: "anima",
    model: best.model,
    tier: req.tier,
    minds: drafts.map((d) => d.provider),
    drafts,
    synthesizer: best.provider,
    combined: false,
  };
}

/** Chunk text so the client can still stream the combined reply. */
export async function* chunkTextAsStream(
  text: string,
  chunkSize = 24,
): AsyncGenerator<{ choices: [{ delta: { content: string } }] }> {
  for (let i = 0; i < text.length; i += chunkSize) {
    yield { choices: [{ delta: { content: text.slice(i, i + chunkSize) } }] };
  }
}

/**
 * Gather parallel mind drafts, synthesize when 2+ succeed, and return the
 * combined companion reply plus metadata for the chat SSE done event.
 */
export async function createEnsembleChatReply(
  req: EnsembleChatRequest,
): Promise<EnsembleChatResult> {
  beginChatProviderTurn();
  const minds = getEnsembleMinds(req.tier);
  if (minds.length === 0) {
    throw new Error(
      "No LLM minds configured for ensemble. Set GEMINI_API_KEY, GROQ_API_KEY, and/or OPENAI_API_KEY.",
    );
  }

  req.onProgress?.({
    status: "ensemble",
    phase: "gathering",
    minds,
  });

  const timeout = mindTimeoutMs();
  const settled = await Promise.allSettled(
    minds.map((provider) =>
      withAbortTimeout(
        (signal) =>
          draftFromMind(provider, req.tier, req.messages, req.maxTokens, signal),
        timeout,
        providerLabel(provider),
      ),
    ),
  );

  const drafts: MindDraft[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    const provider = minds[i]!;
    if (result.status === "fulfilled") {
      drafts.push(result.value);
      continue;
    }
    const reason = result.reason;
    // Persist sticky skips so the next turn doesn't re-hit a broken backend.
    if (isProviderUnusableError(reason)) {
      recordProviderFailure(provider, reason);
    }
  }

  if (drafts.length === 0) {
    const reasons = settled
      .map((r, i) =>
        r.status === "rejected"
          ? `${providerLabel(minds[i]!)}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
          : null,
      )
      .filter(Boolean);
    throw new Error(
      `All ensemble minds failed. ${reasons.join(" | ") || "No drafts returned."}`,
    );
  }

  // Single successful mind — use it directly (no synthesis tax).
  if (drafts.length === 1) {
    const only = drafts[0]!;
    req.onProgress?.({
      status: "ensemble",
      phase: "streaming",
      minds: [only.provider],
      drafts: 1,
      synthesizer: only.provider,
    });
    return {
      content: only.content,
      provider: only.provider,
      brand: "anima",
      model: only.model,
      tier: req.tier,
      minds: [only.provider],
      drafts,
      synthesizer: only.provider,
      combined: false,
    };
  }

  const synthesizer = pickSynthesizer(drafts);
  req.onProgress?.({
    status: "ensemble",
    phase: "combining",
    minds: drafts.map((d) => d.provider),
    drafts: drafts.length,
    synthesizer,
  });

  try {
    const synthesized = await withAbortTimeout(
      (signal) =>
        synthesizeDrafts(
          synthesizer,
          req.tier,
          req.messages,
          drafts,
          req.maxTokens,
          signal,
        ),
      mindTimeoutMs() + 4000,
      `${providerLabel(synthesizer)} synthesis`,
    );

    if (!synthesized.content) {
      // Empty synthesis → report draft fallback metadata, not a fake combine.
      return draftFallbackResult(req, drafts, fastestDraft(drafts));
    }

    req.onProgress?.({
      status: "ensemble",
      phase: "streaming",
      minds: drafts.map((d) => d.provider),
      drafts: drafts.length,
      synthesizer,
    });

    return {
      content: synthesized.content,
      provider: synthesizer,
      brand: "anima",
      model: synthesized.model,
      tier: req.tier,
      minds: drafts.map((d) => d.provider),
      drafts,
      synthesizer,
      combined: true,
    };
  } catch (err) {
    if (isProviderUnusableError(err)) {
      recordProviderFailure(synthesizer, err);
    }
    return draftFallbackResult(req, drafts, fastestDraft(drafts));
  }
}

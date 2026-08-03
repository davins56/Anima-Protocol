// Parallel "minds" ensemble for the Anima custom LLM.
//
// Instead of sequential failover (try Kimi → if that fails, Gemini), every
// available backend drafts a reply in parallel. The app then synthesizes those
// drafts into one in-character companion reply and streams that to the client.
//
// Enabled when ANIMA_LLM_PROVIDER is anima | custom | ensemble (see
// isAnimaCustomMode), or when ANIMA_LLM_ENSEMBLE=true under other modes.

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  createGeminiChatCompletion,
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
import {
  getAnimaTierProviderOrder,
  isAnimaCustomMode,
  resolveGeminiModel,
  resolveKimiModel,
  resolveXaiModel,
  type LlmBrand,
  type LlmProviderId,
} from "./llmFailover";
import { resolveModel, type ModelTier } from "./modelRouter";

export interface MindDraft {
  provider: LlmProviderId;
  model: string;
  content: string;
  latencyMs: number;
}

export interface EnsembleProgressEvent {
  status: "ensemble";
  phase: "gathering" | "combining" | "streaming";
  minds: LlmProviderId[];
  drafts?: number;
  synthesizer?: LlmProviderId;
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
  provider: LlmProviderId;
  brand: LlmBrand;
  model: string;
  tier: ModelTier;
  minds: LlmProviderId[];
  drafts: MindDraft[];
  synthesizer: LlmProviderId;
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
  return Number.isFinite(raw) && raw >= 1 ? Math.min(4, Math.floor(raw)) : 4;
}

/** True when chat should gather parallel minds + combine (not sequential failover). */
export function isEnsembleMode(): boolean {
  if (envFlagEnabled("ANIMA_LLM_ENSEMBLE")) return true;
  return isAnimaCustomMode();
}

/** Backends that can draft a mind reply right now (ignores single-provider locks). */
export function getEnsembleMinds(tier: ModelTier = "standard"): LlmProviderId[] {
  const disableOpenAI = envFlagEnabled("ANIMA_DISABLE_OPENAI");
  const disableXai = envFlagEnabled("ANIMA_DISABLE_XAI");
  const minds: LlmProviderId[] = [];

  for (const id of getAnimaTierProviderOrder(tier)) {
    if (id === "kimi" && hasKimiKey()) minds.push(id);
    else if (id === "gemini" && hasGeminiKey()) minds.push(id);
    else if (id === "xai" && hasXaiKey() && !disableXai) minds.push(id);
    else if (id === "openai" && hasOpenAIKey() && !disableOpenAI) minds.push(id);
  }

  return minds.slice(0, maxMinds());
}

function providerLabel(id: LlmProviderId): string {
  if (id === "kimi") return "Kimi";
  if (id === "gemini") return "Gemini";
  if (id === "xai") return "Grok";
  return "ChatGPT";
}

function resolveMindModel(provider: LlmProviderId, tier: ModelTier) {
  if (provider === "kimi") return resolveKimiModel(tier);
  if (provider === "gemini") return resolveGeminiModel(tier);
  if (provider === "xai") return resolveXaiModel(tier);
  return resolveModel(tier);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function draftFromMind(
  provider: LlmProviderId,
  tier: ModelTier,
  messages: ChatCompletionMessageParam[],
  maxTokens: number,
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
    });
    content = completion.choices[0]?.message?.content ?? "";
  } else {
    const client =
      provider === "kimi"
        ? getKimiClient()
        : provider === "xai"
          ? getXaiClient()
          : getOpenAIClient();
    if (!client) {
      throw new Error(`${providerLabel(provider)} client is not configured.`);
    }
    const completion = await client.chat.completions.create({
      model: resolved.model,
      max_tokens: draftMax,
      messages,
      temperature: 0.8,
    });
    content = completion.choices[0]?.message?.content ?? "";
  }

  const trimmed = String(content).trim();
  if (!trimmed) {
    throw new Error(`${providerLabel(provider)} returned an empty draft.`);
  }

  return {
    provider,
    model: resolved.model,
    content: trimmed,
    latencyMs: Date.now() - started,
  };
}

function pickSynthesizer(drafts: MindDraft[]): LlmProviderId {
  const order: LlmProviderId[] = ["kimi", "gemini", "xai", "openai"];
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
        `from those drafts. Do not mention the minds, drafts, Gemini, Kimi, Grok, ChatGPT, ` +
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
  synthesizer: LlmProviderId,
  tier: ModelTier,
  originalMessages: ChatCompletionMessageParam[],
  drafts: MindDraft[],
  maxTokens: number,
): Promise<{ content: string; model: string }> {
  const resolved = resolveMindModel(synthesizer, tier);
  const messages = buildSynthesisMessages(originalMessages, drafts);

  if (synthesizer === "gemini") {
    const completion = await createGeminiChatCompletion({
      model: resolved.model,
      maxTokens,
      messages,
      temperature: 0.7,
    });
    return {
      content: String(completion.choices[0]?.message?.content ?? "").trim(),
      model: resolved.model,
    };
  }

  const client =
    synthesizer === "kimi"
      ? getKimiClient()
      : synthesizer === "xai"
        ? getXaiClient()
        : getOpenAIClient();
  if (!client) {
    throw new Error(`${providerLabel(synthesizer)} client is not configured.`);
  }
  const completion = await client.chat.completions.create({
    model: resolved.model,
    max_tokens: maxTokens,
    messages,
    temperature: 0.7,
  });
  return {
    content: String(completion.choices[0]?.message?.content ?? "").trim(),
    model: resolved.model,
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
  const minds = getEnsembleMinds(req.tier);
  if (minds.length === 0) {
    throw new Error(
      "No LLM minds configured for ensemble. Set KIMI_API_KEY, GEMINI_API_KEY, XAI_API_KEY, and/or OPENAI_API_KEY.",
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
      withTimeout(
        draftFromMind(provider, req.tier, req.messages, req.maxTokens),
        timeout,
        providerLabel(provider),
      ),
    ),
  );

  const drafts: MindDraft[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") drafts.push(result.value);
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

  let content: string;
  let model: string;
  try {
    const synthesized = await withTimeout(
      synthesizeDrafts(
        synthesizer,
        req.tier,
        req.messages,
        drafts,
        req.maxTokens,
      ),
      mindTimeoutMs() + 4000,
      `${providerLabel(synthesizer)} synthesis`,
    );
    content = synthesized.content;
    model = synthesized.model;
  } catch {
    // If synthesis fails, fall back to the fastest successful draft.
    const best = [...drafts].sort((a, b) => a.latencyMs - b.latencyMs)[0]!;
    content = best.content;
    model = best.model;
    req.onProgress?.({
      status: "ensemble",
      phase: "streaming",
      minds: drafts.map((d) => d.provider),
      drafts: drafts.length,
      synthesizer: best.provider,
    });
    return {
      content,
      provider: best.provider,
      brand: "anima",
      model,
      tier: req.tier,
      minds: drafts.map((d) => d.provider),
      drafts,
      synthesizer: best.provider,
      combined: false,
    };
  }

  if (!content) {
    const best = drafts[0]!;
    content = best.content;
    model = best.model;
  }

  req.onProgress?.({
    status: "ensemble",
    phase: "streaming",
    minds: drafts.map((d) => d.provider),
    drafts: drafts.length,
    synthesizer,
  });

  return {
    content,
    provider: synthesizer,
    brand: "anima",
    model,
    tier: req.tier,
    minds: drafts.map((d) => d.provider),
    drafts,
    synthesizer,
    combined: true,
  };
}

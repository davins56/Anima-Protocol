// Optional "parallel minds" mode for the self-hosted Anima LLM.
//
// This is NOT the old cloud ensemble (Kimi/Gemini/Grok/ChatGPT) — that whole
// cross-provider chain was removed. Every draft here, and the combined
// reply, comes from the same self-hosted model via llmFailover.ts. Chat
// still never depends on a flagship cloud provider; this just samples the
// one local model N times at different temperatures and synthesizes the
// results into a single in-character reply, instead of using just one
// sample. Off by default — opt in with ANIMA_LOCAL_LLM_ENSEMBLE=true.

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  createChatCompletionWithFailover,
  createChatStreamWithFailover,
  type ChatStreamResult,
} from "./llmFailover";
import type { ModelTier } from "./modelRouter";

export interface LocalMindDraft {
  label: string;
  content: string;
  model: string;
}

interface LocalMindSpec {
  label: string;
  temperature: number;
}

const DEFAULT_MINDS: LocalMindSpec[] = [
  { label: "Steady", temperature: 0.6 },
  { label: "Vivid", temperature: 0.95 },
  { label: "Playful", temperature: 1.15 },
];

const DEFAULT_MIND_TIMEOUT_MS = 20000;
const DEFAULT_MAX_MINDS = 4;

export function isLocalEnsembleEnabled(): boolean {
  return /^(1|true|yes)$/i.test((process.env.ANIMA_LOCAL_LLM_ENSEMBLE || "").trim());
}

function maxMinds(): number {
  const raw = Number(process.env.ANIMA_ENSEMBLE_MAX_MINDS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_MINDS;
}

/** Mind labels + sampling temperatures. Override labels via ANIMA_ENSEMBLE_MINDS (comma-separated). */
function mindSpecs(): LocalMindSpec[] {
  const cap = maxMinds();
  const raw = (process.env.ANIMA_ENSEMBLE_MINDS || "").trim();
  if (!raw) return DEFAULT_MINDS.slice(0, cap);
  const labels = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, cap);
  if (!labels.length) return DEFAULT_MINDS.slice(0, cap);
  return labels.map((label, i) => ({
    label,
    temperature: DEFAULT_MINDS[i % DEFAULT_MINDS.length]!.temperature,
  }));
}

function mindTimeoutMs(): number {
  const raw = Number(process.env.ANIMA_ENSEMBLE_MIND_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIND_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`mind "${label}" timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface DraftLocalMindsRequest {
  tier: ModelTier;
  maxTokens: number;
  messages: ChatCompletionMessageParam[];
}

/**
 * Draft N independent replies from the self-hosted Anima LLM in parallel,
 * each at a different sampling temperature. Drafts that error or time out
 * are dropped rather than failing the whole turn — callers should treat an
 * empty result as "ensemble produced nothing usable" and fail the turn.
 */
export async function draftLocalMinds(req: DraftLocalMindsRequest): Promise<LocalMindDraft[]> {
  const specs = mindSpecs();
  const timeoutMs = mindTimeoutMs();

  const settled = await Promise.allSettled(
    specs.map((spec) =>
      withTimeout(
        createChatCompletionWithFailover({
          tier: req.tier,
          maxTokens: req.maxTokens,
          messages: req.messages,
          temperature: spec.temperature,
        }),
        timeoutMs,
        spec.label,
      ),
    ),
  );

  const drafts: LocalMindDraft[] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled" && result.value.content.trim()) {
      drafts.push({ label: specs[i]!.label, content: result.value.content.trim(), model: result.value.model });
    }
  });
  return drafts;
}

const COMBINE_INSTRUCTIONS =
  "You are combining multiple draft replies from the same companion into ONE final in-character reply. " +
  "The drafts below are different attempts at the same turn, not a conversation with each other. Write a " +
  "single reply that keeps the character's voice, blends the strongest ideas, and does not repeat itself " +
  "or reference the drafts. Output ONLY the final reply text — no labels, no explanation, no meta-commentary.";

function systemContentOf(messages: ChatCompletionMessageParam[]): string {
  const system = messages.find((m) => m.role === "system");
  return system && typeof system.content === "string" ? system.content : "";
}

/** Stream a single combined reply synthesized from multiple local mind drafts. */
export async function combineLocalDrafts(
  drafts: LocalMindDraft[],
  originalMessages: ChatCompletionMessageParam[],
  opts: { tier: ModelTier; maxTokens: number },
): Promise<ChatStreamResult> {
  const draftsBlock = drafts.map((d, i) => `Draft ${i + 1} (${d.label}):\n${d.content}`).join("\n\n");
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: [systemContentOf(originalMessages), COMBINE_INSTRUCTIONS].filter(Boolean).join("\n\n") },
    { role: "user", content: draftsBlock },
  ];

  return createChatStreamWithFailover({
    tier: opts.tier,
    model: "",
    maxTokens: opts.maxTokens,
    messages,
  });
}

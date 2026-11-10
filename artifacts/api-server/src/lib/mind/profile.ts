/**
 * Chat mind profile: how much context a turn may carry and how to sample,
 * chosen per model instead of the old one-size budget that was sized for a
 * 0.5B model on a single-vCPU droplet (1,240 prompt tokens, 2–6 exchanges,
 * 4 memories, 400 chars per replayed message).
 *
 * Hosted models (Workers AI, OpenRouter) get the mind profile. The local
 * Ollama path keeps its prefix-cache-friendly legacy budget untouched.
 */

export type ModelFamily = "llama" | "deepseek-r1" | "mistral" | "qwen" | "gemma" | "generic";

export type SamplingParams = {
  temperature: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
};

export type MindProfile = {
  family: ModelFamily;
  /** Prompt token budget the trim loop packs against. */
  promptTokens: number;
  /** Most user/companion exchanges replayed verbatim. */
  historyExchanges: number;
  /** Exchanges that always survive trimming. */
  minHistoryExchanges: number;
  /** Per-message character cap for replayed history. */
  historyMessageChars: number;
  /** companion_memories facts retrieved per turn. */
  memoryTopK: number;
  /** memory_events recalled per turn (before packing). */
  recallLimit: number;
  /** Token budget for the "what you know" block (facts + summary + moments). */
  knowledgeTokens: number;
  /** Durable user facts loaded per turn. */
  factLimit: number;
  sampling: SamplingParams;
  /** True when one system message must lead and roles must alternate. */
  strictAlternation: boolean;
};

const DEFAULT_PROMPT_TOKENS = 6_000;

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = Number(env[name]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

export function modelFamily(model: string | null | undefined): ModelFamily {
  const m = String(model || "").toLowerCase();
  if (/deepseek-r1|deepseek\/deepseek-r1|r1-distill/.test(m)) return "deepseek-r1";
  if (/llama/.test(m)) return "llama";
  if (/mistral|mixtral|dolphin|venice/.test(m)) return "mistral";
  if (/qwen/.test(m)) return "qwen";
  if (/gemma/.test(m)) return "gemma";
  return "generic";
}

/**
 * Sampling tuned for companion chat. Slightly warm for natural voice, with
 * mild repetition / frequency penalties so a long chat does not loop on the
 * same openers. Reasoning models keep their recommended low temperature.
 */
export function samplingFor(family: ModelFamily, env: NodeJS.ProcessEnv = process.env): SamplingParams {
  const base: SamplingParams = (() => {
    switch (family) {
      case "llama":
        return { temperature: 0.8, top_p: 0.9, repetition_penalty: 1.05, frequency_penalty: 0.15, presence_penalty: 0.1 };
      case "deepseek-r1":
        return { temperature: 0.6, top_p: 0.95 };
      case "mistral":
        return { temperature: 0.75, top_p: 0.92, repetition_penalty: 1.05, frequency_penalty: 0.2 };
      case "qwen":
        return { temperature: 0.75, top_p: 0.9, repetition_penalty: 1.05 };
      case "gemma":
        return { temperature: 0.8, top_p: 0.95 };
      default:
        return { temperature: 0.75, top_p: 0.9 };
    }
  })();
  const t = Number(env.ANIMA_MIND_TEMPERATURE);
  if (Number.isFinite(t) && t >= 0 && t <= 2) base.temperature = t;
  return base;
}

/** `ANIMA_CHAT_MIND=off` returns chat to the legacy budget everywhere. */
export function isChatMindEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.ANIMA_CHAT_MIND || "on").trim().toLowerCase();
  return !(raw === "0" || raw === "off" || raw === "false" || raw === "no");
}

/**
 * Mind profile for the provider that will answer, or null for the local
 * Ollama host (legacy budget) / when the mind is switched off.
 */
export function mindProfileFor(
  provider: string | null | undefined,
  model: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MindProfile | null {
  if (!isChatMindEnabled(env)) return null;
  if (!provider || provider === "local" || provider === "own") return null;
  const family = modelFamily(model);
  const promptTokens = envInt(env, "ANIMA_MIND_PROMPT_TOKENS", DEFAULT_PROMPT_TOKENS, 1_500, 20_000);
  return {
    family,
    promptTokens,
    historyExchanges: envInt(env, "ANIMA_MIND_HISTORY_EXCHANGES", 16, 4, 40),
    minHistoryExchanges: 4,
    historyMessageChars: 1_600,
    memoryTopK: 8,
    recallLimit: 16,
    knowledgeTokens: Math.max(400, Math.floor(promptTokens * 0.22)),
    factLimit: 24,
    sampling: samplingFor(family, env),
    strictAlternation: family === "mistral" || family === "gemma",
  };
}

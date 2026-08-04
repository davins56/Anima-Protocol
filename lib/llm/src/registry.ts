/**
 * Anima Model Registry
 *
 * Single source of truth for "which model runs Anima", organized by
 * provider × tier:
 *
 *   Provider (runtime)   openai | groq | ollama | mock
 *   Tier (cost/quality)  light  | standard | heavy
 *
 * The registry is pure — no I/O, no network — so it can be unit-tested and
 * shared between the api-server and the build/fine-tuning tooling.
 *
 * The api-server keeps OpenAI as the default provider, so existing behavior is
 * unchanged unless `ANIMA_LLM_PROVIDER` is set. Setting it to `ollama` runs the
 * same Anima app against a local, self-hosted model on your own infrastructure
 * ("built into the scaffolding").
 *
 * Environment overrides (all optional):
 *   ANIMA_LLM_PROVIDER           provider to use: openai | groq | ollama | mock
 *   ANIMA_MODEL_LIGHT            global model override for the light tier
 *   ANIMA_MODEL_STANDARD         global model override for the standard tier
 *   ANIMA_MODEL_HEAVY            global model override for the heavy tier
 *   ANIMA_<PROVIDER>_MODEL_<T>   per-provider override, e.g. ANIMA_OLLAMA_MODEL_STANDARD
 *
 * The global `ANIMA_MODEL_<TIER>` override keys intentionally mirror the
 * api-server's existing modelRouter convention so tuning the lineup stays a
 * one-line env change.
 */

export type ProviderName = "openai" | "groq" | "ollama" | "mock";
export type ModelTier = "light" | "standard" | "heavy";

export const PROVIDER_NAMES: ProviderName[] = ["openai", "groq", "ollama", "mock"];
export const MODEL_TIERS: ModelTier[] = ["light", "standard", "heavy"];
export const DEFAULT_PROVIDER: ProviderName = "openai";

/** Sampling / decoding parameters applied to a model call. */
export interface SamplingPreset {
  temperature: number;
  /** OpenAI/Groq: top_p — nucleus sampling. */
  topP?: number;
  /** OpenAI/Groq: frequency_penalty. */
  frequencyPenalty?: number;
  /** OpenAI/Groq: presence_penalty. */
  presencePenalty?: number;
  /** Ollama/llama.cpp: repeat_penalty. */
  repeatPenalty?: number;
  /** Ollama: context window size (num_ctx). */
  numCtx?: number;
}

export interface ModelSpec {
  id: string;
  provider: ProviderName;
  tier: ModelTier;
  model: string;
  /** Friendly Anima name (e.g. the Ollama "anima-base" preset). */
  alias?: string;
  maxTokens: number;
  sampling: SamplingPreset;
  /** Model spec id to retry when the routed model is unavailable. */
  fallback?: string;
  description: string;
}

interface TierDefaults {
  model: string;
  maxTokens: number;
  alias?: string;
  description: string;
}

// --- OpenAI managed lineup (default) ----------------------------------------
const OPENAI_DEFAULTS: Record<ModelTier, TierDefaults> = {
  light: { model: "gpt-4.1-mini", maxTokens: 4096, description: "Cheap tier for greetings and small talk" },
  standard: { model: "gpt-4o", maxTokens: 8192, description: "Routine conversational turns" },
  heavy: { model: "gpt-4.1", maxTokens: 8192, description: "High-stakes and deep-context turns" },
};

const OPENAI_SAMPLING: Record<ModelTier, SamplingPreset> = {
  light: { temperature: 0.8 },
  standard: { temperature: 0.9, topP: 0.95 },
  heavy: { temperature: 1.0, topP: 0.95 },
};

// --- Groq managed lineup (fast, cheap hosted alternative) --------------------
const GROQ_DEFAULTS: Record<ModelTier, TierDefaults> = {
  light: { model: "llama-3.1-8b-instant", maxTokens: 4096, description: "Fast cheap tier on Groq" },
  standard: { model: "llama-3.3-70b-versatile", maxTokens: 8192, description: "Routine conversational turns on Groq" },
  heavy: { model: "llama-3.3-70b-versatile", maxTokens: 8192, description: "High-stakes turns on Groq" },
};

const GROQ_SAMPLING: Record<ModelTier, SamplingPreset> = {
  light: { temperature: 0.8 },
  standard: { temperature: 0.9, topP: 0.95 },
  heavy: { temperature: 1.0, topP: 0.95 },
};

// --- Ollama self-hosted lineup (the "run your own Anima" path) ---------------
// Quantized GGUF models served locally. The aliases are the Anima-branded
// presets; `model` is the Ollama tag to `ollama pull`.
const OLLAMA_DEFAULTS: Record<ModelTier, TierDefaults> = {
  light: { model: "qwen2.5:3b", alias: "anima-mini", maxTokens: 4096, description: "Self-hosted mini model (~2 GB)" },
  standard: { model: "llama3.1:8b", alias: "anima-base", maxTokens: 8192, description: "Default self-hosted Anima model (~4.7 GB)" },
  heavy: { model: "qwen2.5:14b", alias: "anima-pro", maxTokens: 8192, description: "Largest self-hosted preset (~9 GB)" },
};

const OLLAMA_SAMPLING: Record<ModelTier, SamplingPreset> = {
  light: { temperature: 0.7, topP: 0.9, repeatPenalty: 1.1, numCtx: 8192 },
  standard: { temperature: 0.8, topP: 0.9, repeatPenalty: 1.1, numCtx: 16384 },
  heavy: { temperature: 0.9, topP: 0.92, repeatPenalty: 1.15, numCtx: 32768 },
};

// --- Mock (deterministic offline, for tests / demos) -------------------------
const MOCK_DEFAULTS: Record<ModelTier, TierDefaults> = {
  light: { model: "mock-local", maxTokens: 1024, description: "Deterministic offline mock" },
  standard: { model: "mock-local", maxTokens: 1024, description: "Deterministic offline mock" },
  heavy: { model: "mock-local", maxTokens: 1024, description: "Deterministic offline mock" },
};

const MOCK_SAMPLING: Record<ModelTier, SamplingPreset> = {
  light: { temperature: 0.7 },
  standard: { temperature: 0.7 },
  heavy: { temperature: 0.7 },
};

const LINEUPS: Record<ProviderName, Record<ModelTier, TierDefaults>> = {
  openai: OPENAI_DEFAULTS,
  groq: GROQ_DEFAULTS,
  ollama: OLLAMA_DEFAULTS,
  mock: MOCK_DEFAULTS,
};

const SAMPLINGS: Record<ProviderName, Record<ModelTier, SamplingPreset>> = {
  openai: OPENAI_SAMPLING,
  groq: GROQ_SAMPLING,
  ollama: OLLAMA_SAMPLING,
  mock: MOCK_SAMPLING,
};

/**
 * Resolve the active provider from an explicit value or `ANIMA_LLM_PROVIDER`.
 * Anything unrecognized falls back to OpenAI so a typo never silently disables
 * the runtime.
 */
export function resolveProvider(envValue?: string | null): ProviderName {
  const raw = (envValue ?? process.env.ANIMA_LLM_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (raw === "groq" || raw === "ollama" || raw === "mock") return raw;
  return "openai";
}

/** The env key for a per-provider model override (ANIMA_<P>_MODEL_<T>). */
export function envKey(provider: ProviderName, tier: ModelTier): string {
  return `ANIMA_${provider.toUpperCase()}_MODEL_${tier.toUpperCase()}`;
}

/** The full model lineup for a provider (unaffected by env overrides). */
export function listModels(provider?: ProviderName | string): ModelSpec[] {
  const target = resolveProvider(provider);
  const lineup = LINEUPS[target];
  const sampling = SAMPLINGS[target];
  return MODEL_TIERS.map((tier) => ({
    id: `${target}:${tier}`,
    provider: target,
    tier,
    model: lineup[tier].model,
    alias: lineup[tier].alias,
    maxTokens: lineup[tier].maxTokens,
    sampling: sampling[tier],
    fallback: tier === "heavy" ? `${target}:standard` : undefined,
    description: lineup[tier].description,
  }));
}

export function getSpecFor(provider: ProviderName, tier: ModelTier): ModelSpec {
  const spec = listModels(provider).find((m) => m.tier === tier);
  if (!spec) throw new Error(`No model spec for ${provider}:${tier}`);
  return spec;
}

/**
 * Resolve the concrete model for a tier + provider, honoring env overrides:
 * per-provider key first, then the global ANIMA_MODEL_<TIER> key, then the
 * built-in default. The token budget and sampling preset stay tied to the spec.
 */
export function resolveModelSpec(
  tier: ModelTier,
  provider?: ProviderName | string,
): ModelSpec {
  const target = resolveProvider(provider);
  const spec = getSpecFor(target, tier);
  const providerOverride = (process.env[envKey(target, tier)] ?? "").trim();
  const globalOverride = (process.env[`ANIMA_MODEL_${tier.toUpperCase()}`] ?? "").trim();
  const model = providerOverride || globalOverride || spec.model;
  return { ...spec, model };
}

/** Plain sampling map (camelCase keys), useful for introspection/diagnostics. */
export function samplingFor(spec: ModelSpec): Record<string, number> {
  const out: Record<string, number> = {};
  if (spec.sampling.temperature !== undefined) out.temperature = spec.sampling.temperature;
  if (spec.sampling.topP !== undefined) out.topP = spec.sampling.topP;
  if (spec.sampling.frequencyPenalty !== undefined) out.frequencyPenalty = spec.sampling.frequencyPenalty;
  if (spec.sampling.presencePenalty !== undefined) out.presencePenalty = spec.sampling.presencePenalty;
  if (spec.sampling.repeatPenalty !== undefined) out.repeatPenalty = spec.sampling.repeatPenalty;
  if (spec.sampling.numCtx !== undefined) out.numCtx = spec.sampling.numCtx;
  return out;
}

/** OpenAI/Groq chat.completions sampling params (snake_case). */
export function samplingForOpenAI(spec: ModelSpec): Record<string, number> {
  const out: Record<string, number> = { temperature: spec.sampling.temperature };
  if (spec.sampling.topP !== undefined) out.top_p = spec.sampling.topP;
  if (spec.sampling.frequencyPenalty !== undefined) out.frequency_penalty = spec.sampling.frequencyPenalty;
  if (spec.sampling.presencePenalty !== undefined) out.presence_penalty = spec.sampling.presencePenalty;
  return out;
}

/** Ollama /api/generate options (num_predict, num_ctx, etc.). */
export function samplingForOllama(spec: ModelSpec): Record<string, number> {
  const out: Record<string, number> = { temperature: spec.sampling.temperature };
  if (spec.sampling.topP !== undefined) out.top_p = spec.sampling.topP;
  if (spec.sampling.repeatPenalty !== undefined) out.repeat_penalty = spec.sampling.repeatPenalty;
  if (spec.sampling.numCtx !== undefined) out.num_ctx = spec.sampling.numCtx;
  return out;
}

/** Human-readable one-line description of a spec (CLI / docs). */
export function describeModel(spec: ModelSpec): string {
  const alias = spec.alias ? ` (${spec.alias})` : "";
  return `[${spec.id}] ${spec.model}${alias} — ${spec.description}`;
}


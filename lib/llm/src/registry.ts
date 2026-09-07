/**
 * Anima Model Registry
 *
 * Single source of truth for "which model runs Anima", organized by
 * provider × tier:
 *
 *   Provider (runtime)   openai | groq | ollama | vllm | mock
 *   Tier (cost/quality)  light  | standard | heavy
 *
 * The registry is pure — no I/O, no network — so it can be unit-tested and
 * shared between the api-server and the build/fine-tuning tooling.
 *
 * Primary product path: a **self-hosted Anima LLM** built from public open
 * weights (not ChatGPT / Gemini / Groq — those stacks are closed).
 *
 *   Bootstrap (CPU / laptop): `anima-chat` ← Qwen2.5 3B via Ollama
 *   GPU upgrade: fine-tuned Ministral 3 8B via vLLM / Ollama GGUF
 *
 * Chat (artifacts/api-server/src/lib/llmFailover.ts) always resolves through
 * `ollama` or `vllm` explicitly — it never reads ANIMA_LLM_PROVIDER, and there
 * is no cloud BYOK chat path in the codebase. The `openai` / `groq` provider
 * entries below exist only for registry introspection (`pnpm llm:list-models`)
 * and are not reachable from live chat.
 *
 * Environment overrides (all optional):
 *   ANIMA_LLM_PROVIDER           dev-tooling only (CLI list-models/serve-hint);
 *                                 not read by the chat request path
 *   ANIMA_LOCAL_LLM_BACKEND      ollama | vllm  (how chat resolves its model)
 *   ANIMA_MODEL_LIGHT            global model override for the light tier
 *   ANIMA_MODEL_STANDARD         global model override for the standard tier
 *   ANIMA_MODEL_HEAVY            global model override for the heavy tier
 *   ANIMA_<PROVIDER>_MODEL_<T>   per-provider override, e.g. ANIMA_OLLAMA_MODEL_STANDARD
 */

export type ProviderName = "openai" | "groq" | "ollama" | "vllm" | "mock";
export type ModelTier = "light" | "standard" | "heavy";
export type OpenWeightModelFamily = "llama" | "qwen" | "mistral" | "gemma" | "deepseek" | "minimax" | "google";

export const PROVIDER_NAMES: ProviderName[] = [
  "openai",
  "groq",
  "ollama",
  "vllm",
  "mock",
];
export const MODEL_TIERS: ModelTier[] = ["light", "standard", "heavy"];
export const OPEN_WEIGHT_MODEL_FAMILIES: OpenWeightModelFamily[] = [
  "llama",
  "qwen",
  "mistral",
  "gemma",
  "deepseek",
  "minimax",
  "google",
];
/**
 * Matches the api-server's actual default (llmFailover.ts `defaultProviderMode()`
 * returns "local" when ANIMA_LLM_PROVIDER is unset, which resolves to ollama here).
 * Anima chat must never default to a cloud flagship provider.
 */
export const DEFAULT_PROVIDER: ProviderName = "ollama";

/**
 * Canonical GPU serve target for Anima companions (Ministral 3 8B Instruct).
 * After LoRA merge, point ANIMA_VLLM_MODEL_* at your checkpoint instead.
 */
export const ANIMA_PRIMARY_MODEL = "mistralai/Ministral-3-8B-Instruct-2512";
/**
 * Recommended base weights for LoRA/QLoRA SFT (BF16 Base, not FP8 Instruct).
 * Unsloth / LLaMA-Factory scripts default here.
 */
export const ANIMA_FINETUNE_BASE_MODEL = "mistralai/Ministral-3-8B-Base-2512";
/** Memory summarization / compression specialist (Ministral 3 3B). */
export const ANIMA_MEMORY_SPECIALIST_MODEL =
  "mistralai/Ministral-3-3B-Instruct-2512";
/**
 * Public open weights used for the CPU/laptop bootstrap chat model.
 * (Qwen2.5 Instruct — Apache-2.0; not ChatGPT/Gemini/Groq.)
 */
export const ANIMA_BOOTSTRAP_BASE_MODEL = "qwen2.5:3b";
/** Ollama tag after `ollama create` from Modelfile.anima-chat (bootstrap). */
export const ANIMA_OLLAMA_CHAT_TAG = "anima-chat";
/** Ollama tag after fine-tune GGUF + Modelfile.anima-ministral8b (GPU upgrade). */
export const ANIMA_OLLAMA_TAG = "anima-ministral8b";

export interface OpenWeightChatModel {
  family: OpenWeightModelFamily;
  label: string;
  aliases: string[];
  ollamaModel: string;
  vllmModel: string;
  openRouterModel: string;
  maxTokens: number;
  notes: string;
}

const OPEN_WEIGHT_CHAT_MODELS: Record<OpenWeightModelFamily, OpenWeightChatModel> = {
  llama: {
    family: "llama",
    label: "Llama",
    aliases: ["llama", "meta-llama"],
    ollamaModel: "llama3.1:8b",
    vllmModel: "meta-llama/Llama-3.1-8B-Instruct",
    openRouterModel: "meta-llama/llama-3.3-70b-instruct:free",
    maxTokens: 8192,
    notes: "Strong general-purpose open-weight chat baseline.",
  },
  qwen: {
    family: "qwen",
    label: "Qwen",
    aliases: ["qwen", "qwen2", "qwen3"],
    ollamaModel: ANIMA_BOOTSTRAP_BASE_MODEL,
    vllmModel: "Qwen/Qwen2.5-7B-Instruct",
    openRouterModel: "qwen/qwen-2.5-7b-instruct:free",
    maxTokens: 8192,
    notes: "Current CPU bootstrap path for Anima via Ollama.",
  },
  mistral: {
    family: "mistral",
    label: "Mistral",
    aliases: ["mistral", "ministral"],
    ollamaModel: "mistral:7b",
    vllmModel: ANIMA_PRIMARY_MODEL,
    openRouterModel: "mistralai/mistral-small-3.2-24b-instruct:free",
    maxTokens: 8192,
    notes: "Recommended GPU upgrade family for Anima fine-tuning.",
  },
  gemma: {
    family: "gemma",
    label: "Gemma",
    aliases: ["gemma", "google/gemma"],
    ollamaModel: "gemma3:4b",
    vllmModel: "google/gemma-3-4b-it",
    openRouterModel: "google/gemma-3-12b-it:free",
    maxTokens: 8192,
    notes: "Compact open model family for lightweight companion deployments.",
  },
  deepseek: {
    family: "deepseek",
    label: "DeepSeek",
    aliases: ["deepseek", "deepseek-r1"],
    ollamaModel: "deepseek-r1:7b",
    vllmModel: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    openRouterModel: "deepseek/deepseek-r1:free",
    maxTokens: 8192,
    notes: "Reasoning-oriented open-weight family for analytical turns.",
  },
  minimax: {
    family: "minimax",
    label: "MiniMax Free",
    aliases: ["minimax", "minimax-free", "minimax-01"],
    ollamaModel: "minimax:free",
    vllmModel: "minimax/minimax-01",
    openRouterModel: "minimax/minimax-01:free",
    maxTokens: 8192,
    notes: "MiniMax free tier provider model.",
  },
  google: {
    family: "google",
    label: "Google Jules",
    aliases: ["google", "jules", "google-jules", "gemma-jules"],
    ollamaModel: "google-jules:latest",
    vllmModel: "google/jules",
    openRouterModel: "google/gemma-3-12b-it:free",
    maxTokens: 8192,
    notes: "Google Jules open weight family.",
  },
};

const ADDITIONAL_KNOWN_CHAT_ALIASES = ["phi", "hermes", "olmo"];

/** Sampling / decoding parameters applied to a model call. */
export interface SamplingPreset {
  temperature: number;
  /** OpenAI/Groq/vLLM: top_p — nucleus sampling. */
  topP?: number;
  /** OpenAI/Groq/vLLM: frequency_penalty. */
  frequencyPenalty?: number;
  /** OpenAI/Groq/vLLM: presence_penalty. */
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

/** Recommended open-weight chat families operators can plug into Anima. */
export function listOpenWeightChatModels(): OpenWeightChatModel[] {
  return OPEN_WEIGHT_MODEL_FAMILIES.map((family) => ({ ...OPEN_WEIGHT_CHAT_MODELS[family] }));
}

/** Resolve a known open-weight family name or alias. */
export function getOpenWeightChatModel(
  family: string | null | undefined,
): OpenWeightChatModel | null {
  const raw = (family || "").trim().toLowerCase();
  if (!raw) return null;
  return (
    listOpenWeightChatModels().find(
      (model) => model.family === raw || model.aliases.some((alias) => alias === raw),
    ) ?? null
  );
}

/** True when an arbitrary served model id belongs to a supported chat family. */
export function isKnownOpenWeightChatModel(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  if (!id) return false;
  return (
    listOpenWeightChatModels().some((model) =>
      model.aliases.some((alias) => id.includes(alias)),
    ) || ADDITIONAL_KNOWN_CHAT_ALIASES.some((alias) => id.includes(alias))
  );
}

interface TierDefaults {
  model: string;
  maxTokens: number;
  alias?: string;
  description: string;
}

// --- OpenAI managed lineup (default cloud) ----------------------------------
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

// --- Groq managed lineup (fast hosted alternative) --------------------------
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

// --- Ollama self-hosted lineup ----------------------------------------------
// Default = bootstrap `anima-chat` (public Qwen2.5 3B) so chat works on CPU
// without a GPU fine-tune. Override ANIMA_OLLAMA_MODEL_* to anima-ministral8b
// after you convert a LoRA merge to GGUF.
const OLLAMA_DEFAULTS: Record<ModelTier, TierDefaults> = {
  light: {
    model: ANIMA_OLLAMA_CHAT_TAG,
    alias: "anima-mini",
    maxTokens: 4096,
    description: "Anima bootstrap chat (Qwen2.5 3B open weights, ~2 GB)",
  },
  standard: {
    model: ANIMA_OLLAMA_CHAT_TAG,
    alias: "anima-base",
    maxTokens: 8192,
    description: "Anima open chat LLM — replaces cloud ChatGPT/Gemini/Groq for companions",
  },
  heavy: {
    model: ANIMA_OLLAMA_CHAT_TAG,
    alias: "anima-pro",
    maxTokens: 8192,
    description: "Same bootstrap model; point at anima-ministral8b after GPU fine-tune",
  },
};

const OLLAMA_SAMPLING: Record<ModelTier, SamplingPreset> = {
  light: { temperature: 0.7, topP: 0.9, repeatPenalty: 1.1, numCtx: 8192 },
  standard: { temperature: 0.8, topP: 0.9, repeatPenalty: 1.1, numCtx: 16384 },
  heavy: { temperature: 0.9, topP: 0.92, repeatPenalty: 1.15, numCtx: 32768 },
};

// --- vLLM OpenAI-compatible local serve -------------------------------------
// Best throughput for a single-GPU / multi-GPU box. Expose at
// ANIMA_LOCAL_LLM_BASE_URL (default http://localhost:8000/v1).
const VLLM_DEFAULTS: Record<ModelTier, TierDefaults> = {
  light: {
    model: ANIMA_MEMORY_SPECIALIST_MODEL,
    alias: "anima-memory",
    maxTokens: 4096,
    description: "Optional Ministral 3 3B specialist for memory summarization",
  },
  standard: {
    model: ANIMA_PRIMARY_MODEL,
    alias: "anima-base",
    maxTokens: 8192,
    description: "Primary fine-tuned Ministral 3 8B conversational model",
  },
  heavy: {
    model: ANIMA_PRIMARY_MODEL,
    alias: "anima-pro",
    maxTokens: 8192,
    description: "Primary Ministral 8B with richer sampling for deep turns",
  },
};

const VLLM_SAMPLING: Record<ModelTier, SamplingPreset> = {
  light: { temperature: 0.7, topP: 0.9 },
  standard: { temperature: 0.85, topP: 0.92, presencePenalty: 0.1 },
  heavy: { temperature: 0.95, topP: 0.95, presencePenalty: 0.15 },
};

// --- Mock (deterministic offline, for tests / demos) ------------------------
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
  vllm: VLLM_DEFAULTS,
  mock: MOCK_DEFAULTS,
};

const SAMPLINGS: Record<ProviderName, Record<ModelTier, SamplingPreset>> = {
  openai: OPENAI_SAMPLING,
  groq: GROQ_SAMPLING,
  ollama: OLLAMA_SAMPLING,
  vllm: VLLM_SAMPLING,
  mock: MOCK_SAMPLING,
};

/**
 * Resolve the active provider from an explicit value or `ANIMA_LLM_PROVIDER`.
 * Unset or unrecognized (e.g. a typo, or an API key pasted into the wrong
 * field) both fall back to the self-hosted `ollama` default — matching
 * llmFailover.ts's `defaultProviderMode()` — so a stray env var can never
 * silently switch chat onto a cloud flagship provider.
 */
export function resolveProvider(envValue?: string | null): ProviderName {
  const raw = (envValue ?? process.env.ANIMA_LLM_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (raw === "groq" || raw === "ollama" || raw === "vllm" || raw === "mock") {
    return raw;
  }
  if (raw === "openai") return "openai";
  // custom / anima / local / local-first → honor ANIMA_LOCAL_LLM_BACKEND.
  // Default ollama (bootstrap anima-chat); set backend=vllm for GPU Ministral.
  if (
    raw === "custom" ||
    raw === "anima" ||
    raw === "local" ||
    raw === "local-first"
  ) {
    const backend = (process.env.ANIMA_LOCAL_LLM_BACKEND || "")
      .trim()
      .toLowerCase();
    if (backend === "vllm") return "vllm";
    return "ollama";
  }
  // Unset or unrecognized (typo, stray API key, …) → safe self-hosted default.
  return DEFAULT_PROVIDER;
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

/** OpenAI/Groq/vLLM chat.completions sampling params (snake_case). */
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

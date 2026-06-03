// Routes a chat message to an appropriately-sized OpenAI model based purely on
// the textual content of the latest user message. Simple/small-talk messages go
// to a fast, cheap model; complex/analytical asks go to a heavier model; the
// rest use the standard conversational model.
//
// All three tiers stay within the gpt-4o / gpt-4.1 family so they share the same
// chat.completions params (max_tokens, temperature, streaming) and behave
// consistently. Each tier's model is overridable via env vars so the lineup can
// be tuned without a code change, and the route falls back to the standard model
// if a routed model is not accessible.

export type ModelTier = "light" | "standard" | "heavy";

export interface ResolvedModel {
  tier: ModelTier;
  model: string;
  maxTokens: number;
}

const DEFAULT_MODELS: Record<ModelTier, string> = {
  light: "gpt-4o-mini",
  standard: "gpt-4o",
  heavy: "gpt-4.1",
};

const MAX_TOKENS: Record<ModelTier, number> = {
  light: 4096,
  standard: 8192,
  heavy: 8192,
};

const ENV_KEYS: Record<ModelTier, string> = {
  light: "ANIMA_MODEL_LIGHT",
  standard: "ANIMA_MODEL_STANDARD",
  heavy: "ANIMA_MODEL_HEAVY",
};

// Resolve the concrete model + token budget for a tier, honoring env overrides.
export function resolveModel(tier: ModelTier): ResolvedModel {
  const override = process.env[ENV_KEYS[tier]]?.trim();
  return {
    tier,
    model: override || DEFAULT_MODELS[tier],
    maxTokens: MAX_TOKENS[tier],
  };
}

// Short greetings / acknowledgements that never need a capable model.
const GREETING_RE =
  /^(hi+|hey+|hello+|yo|sup|hiya|howdy|good\s?(morning|afternoon|evening|night)|gm|gn|thanks(\s?you)?|thank\s?you|thx|ty|ok(ay)?|k|cool|nice|great|awesome|lol|lmao|haha+|yes|no|yep|nope|yeah|nah|sure|got\s?it|np|wow|aww?)[\s!.,?❤️🙂😊]*$/i;

// Keywords that signal an analytical / multi-step / generative ask.
const HEAVY_PATTERNS: RegExp[] = [
  /\bexplain\b/i,
  /\banaly[sz]e\b/i,
  /\bcompare\b/i,
  /\bcontrast\b/i,
  /\bwhy\b/i,
  /\bhow (do|does|did|can|could|would|should|might)\b/i,
  /\bstep[\s-]by[\s-]step\b/i,
  /\breason(ing|ed)?\b/i,
  /\bprove\b/i,
  /\bdebug\b/i,
  /\brefactor\b/i,
  /\bcode\b/i,
  /\bfunction\b/i,
  /\balgorithm\b/i,
  /\bwrite (me )?(a|an|the|some)\b/i,
  /\bdraft\b/i,
  /\boutline\b/i,
  /\bplan\b/i,
  /\bstrateg(y|ies|ize)\b/i,
  /\bsummari[sz]e\b/i,
  /\btranslate\b/i,
  /\bcalculate\b/i,
  /\bsolve\b/i,
  /\bpros and cons\b/i,
  /\bin detail\b/i,
  /\bcomprehensive\b/i,
  /\bbreak (it|this|that|them)? ?down\b/i,
  /\bimplications?\b/i,
  /\bphilosoph/i,
  /\bdilemma\b/i,
  /\btrade[\s-]?offs?\b/i,
  /\bweigh\b/i,
  /\bbrainstorm\b/i,
];

// Classify a single user message into a model tier based on its text alone.
export function classifyComplexity(content: string): ModelTier {
  const text = (content || "").trim();
  if (!text) return "standard";

  const charCount = text.length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const questionMarks = (text.match(/\?/g) || []).length;
  const hasCodeFence = /```|\bfunction\b|=>|{[\s\S]*}/.test(text);
  const hasHeavyKeyword = HEAVY_PATTERNS.some((re) => re.test(text));

  // Light: a bare greeting/acknowledgement, or a very short message with no
  // question and no analytical signal.
  if (GREETING_RE.test(text)) return "light";
  if (charCount < 25 && questionMarks === 0 && !hasHeavyKeyword) return "light";

  // Heavy: explicit analytical keywords (with enough substance), long messages,
  // several questions at once, or anything that looks like code.
  if (
    (hasHeavyKeyword && wordCount >= 4) ||
    wordCount > 120 ||
    charCount > 600 ||
    questionMarks >= 3 ||
    hasCodeFence
  ) {
    return "heavy";
  }

  return "standard";
}

// Convenience: classify then resolve in one call.
export function routeModel(content: string): ResolvedModel {
  return resolveModel(classifyComplexity(content));
}

// True only when an error means the requested model itself is unavailable to
// this account (unknown model, no access). Such errors are worth retrying on the
// standard model; quota / rate-limit / transient errors are not and should
// surface to the caller as-is.
export function isModelUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; type?: string; message?: string };
  const code = (e.code || e.type || "").toLowerCase();
  if (code.includes("model_not_found") || code.includes("model_not_available")) return true;
  const msg = (e.message || "").toLowerCase();
  if (msg.includes("does not exist") || msg.includes("do not have access")) return true;
  // 404 = unknown model. 403 only counts when the message points at the model,
  // not at billing/region/permission unrelated to model access.
  if (e.status === 404) return true;
  return false;
}

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

// `heavy` is the high-capability tier almost all real conversation is routed to
// (see classifyComplexity). `light` stays cheap for bare greetings. `standard`
// is intentionally a different, broadly-available model so it can act as the
// reliable fallback when a routed model is unavailable to the account.
const DEFAULT_MODELS: Record<ModelTier, string> = {
  light: "gpt-4.1-mini",
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

// Bare greetings / acknowledgements that never need a capable model.
const GREETING_RE =
  /^(hi+|hey+|hello+|yo|sup|hiya|howdy|good\s?(morning|afternoon|evening|night)|gm|gn|thanks(\s?you)?|thank\s?you|thx|ty|ok(ay)?|k|cool|nice|great|awesome|lol|lmao|haha+|yes|no|yep|nope|yeah|nah|sure|got\s?it|np|wow|aww?)[\s!.,?❤️🙂😊]*$/i;

// Trivial sign-offs / small talk — also safe to keep on the cheap tier. This is
// an explicit allowlist (not a length heuristic) so that short *substantive*
// messages like "I feel awful today" or "don't leave me" are NOT misclassified
// as trivial and still reach the high-capability tier.
const SMALL_TALK_RE =
  /^(bye+|goodbye|see\s?(you|ya|u)(\s?(soon|later|around|tomorrow))?|cya|talk\s?(to\s?you\s?)?(later|soon)|later|ttyl|take\s?care|sweet\s?dreams|night+|brb|g2g|gtg)[\s!.,?❤️🙂😊]*$/i;

// Classify a single user message into a model tier based on its text alone.
export function classifyComplexity(content: string): ModelTier {
  const text = (content || "").trim();
  if (!text) return "standard";

  // Only bare greetings and trivial sign-offs / small talk stay on the cheap
  // tier. Everything else — any genuine conversational turn, however short — is
  // routed to the high-capability tier so companions reason with full depth and
  // insight. The mid `standard` tier is reserved for the empty-input case and
  // the model-unavailable fallback, not for ordinary chat.
  if (GREETING_RE.test(text) || SMALL_TALK_RE.test(text)) return "light";
  return "heavy";
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

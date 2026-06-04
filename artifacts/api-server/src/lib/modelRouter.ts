// Routes a chat message to an appropriately-sized OpenAI model. The tier is
// driven by two clear, testable signals so companions stay sharp on the moments
// that matter without paying the top-tier price on routine chit-chat:
//
//   1. Message stakes — does the *content* of the latest user message carry an
//      emotional, analytical, question, code, or long-form signal? These are the
//      "moments that matter" and go to the high-capability `heavy` tier.
//   2. Conversation context — an explicit per-user/per-conversation "deep mode"
//      toggle, or a sustained (deep) conversation, escalates otherwise-routine
//      turns up to `heavy`.
//
// Cost / quality tradeoff:
//   - `light`    bare greetings & sign-offs            — cheapest, no reasoning lost.
//   - `standard` routine, low-stakes substantive turns — mid cost; the savings
//                tier. Still a fully capable conversational model, so perceived
//                intelligence on small talk is preserved while cost drops.
//   - `heavy`    high-stakes / deep-context turns       — most capable & costly.
//
// Previously *every* substantive turn was forced to `heavy`; routine small talk
// now resolves to `standard`, which is the cost win. Anything carrying a stakes
// signal, or any turn inside a deep / deep-mode conversation, still reaches
// `heavy`, so substantive moments keep their full depth.
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

// Per-conversation / per-user signals that can escalate an otherwise-routine
// turn up to the high-capability tier. All optional — when absent, routing is
// driven purely by the message content.
export interface RouteContext {
  // Explicit "deep mode" toggle (per user or per conversation). When on, every
  // substantive turn is treated as a moment that matters.
  deepMode?: boolean;
  // How many messages already exist in this conversation (recent message
  // depth). Sustained conversations are moments that matter, so once a thread is
  // deep enough even routine turns escalate to `heavy`.
  conversationDepth?: number;
}

// `heavy` is the high-capability tier for stakes-carrying or deep-context turns.
// `light` stays cheap for bare greetings. `standard` is the routine-conversation
// tier (the cost-saving default for low-stakes substantive turns) and also acts
// as the reliable fallback when a routed model is unavailable to the account.
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

// Once a conversation reaches this many messages it is "deep" — the relationship
// is established and even routine turns are worth the top tier. Overridable so
// the cost/quality balance can be tuned without a code change.
const DEEP_CONVERSATION_DEPTH = (() => {
  const raw = Number(process.env.ANIMA_DEEP_CONVERSATION_DEPTH);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
})();

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

// Emotional / vulnerable content — these are the moments that matter most for a
// companion, so they always reach the top tier regardless of length.
const EMOTIONAL_RE =
  /\b(love|hate|miss|lonely|alone|scared|afraid|fear|anxious|anxiety|depress\w*|sad|cry|crying|hurt\w*|pain|painful|awful|terrible|horrible|worst|rough|stress\w*|overwhelm\w*|breakup|broke up|grief|grieving|heartbroken|need you|need someone|leave me|hopeless|worthless|panic|trauma|abuse|suicid\w*|kill myself)\b/i;

// Analytical / creative / complex asks that genuinely benefit from the most
// capable model.
const ANALYTICAL_RE =
  /\b(explain|compare|contrast|analy[sz]e|debug|fix|code|coding|program|programming|summari[sz]e|translate|calculate|solve|prove|derive|plan|strateg\w*|write|compose|draft|essay|poem|story|argue|evaluate|elaborate|brainstorm|how\s+(do|does|can|to)|why\s+(do|does|is|are)|step.by.step|pros and cons)\b/i;

// Code-like content (snippets, syntax) always warrants the heavy tier. Matched
// on structural syntax only — bare keywords like `let`/`return`/`class` appear
// far too often in natural language ("let's chat", "return home") to be safe.
const CODE_RE = /(=>|[{}]|`|console\.|;\s|\b(function|const|let|var|def|class)\s+[\w$]+\s*[=(])/;

// A turn "matters" — and so should reach the heavy tier — when its content
// carries any high-stakes signal. This is deliberately a set of explicit
// content signals, not a single length threshold.
function isHighStakesMessage(text: string): boolean {
  // Direct questions seek a genuine answer.
  if (text.includes("?")) return true;
  if (EMOTIONAL_RE.test(text)) return true;
  if (ANALYTICAL_RE.test(text)) return true;
  if (CODE_RE.test(text)) return true;
  // Long, sustained messages carry more for the model to reason about. Length is
  // one signal among several — never the only one.
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= 30 || text.length >= 200) return true;
  return false;
}

// Classify a single user message into a model tier from its text plus optional
// per-conversation context.
export function classifyComplexity(content: string, ctx: RouteContext = {}): ModelTier {
  const text = (content || "").trim();
  // Empty input has nothing to route on; standard is the safe middle.
  if (!text) return "standard";

  // Bare greetings and trivial sign-offs / small talk stay on the cheap tier.
  if (GREETING_RE.test(text) || SMALL_TALK_RE.test(text)) return "light";

  // Stakes-carrying turns are the moments that matter — always heavy.
  if (isHighStakesMessage(text)) return "heavy";

  // Routine, low-stakes substantive turn. Escalate to heavy only when the
  // conversation context says this moment matters; otherwise the mid `standard`
  // tier keeps perceived intelligence while saving cost.
  if (ctx.deepMode) return "heavy";
  if ((ctx.conversationDepth ?? 0) >= DEEP_CONVERSATION_DEPTH) return "heavy";

  return "standard";
}

// Convenience: classify then resolve in one call.
export function routeModel(content: string, ctx: RouteContext = {}): ResolvedModel {
  return resolveModel(classifyComplexity(content, ctx));
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

/**
 * Display labels for the chat LLM backend returned by the API.
 * Primary: self-hosted Anima LLM. Optional: OpenRouter (Venice Uncensored /
 * free open-weight models). Flagship BYOK (Gemini/Groq/ChatGPT/…) is not used.
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "anima" || provider === "local") return "Anima";
  if (provider === "openrouter") return "Venice";
  return null;
}

/**
 * Chip label once a reply has been served.
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} brand
 */
export function llmDisplayLabel(provider, brand) {
  if (brand === "anima") return "Anima";
  if (brand === "openrouter" || provider === "openrouter") return "Venice";
  return llmProviderShortLabel(provider);
}

/** @param {string | null | undefined} provider */
export function llmProviderTitle(provider) {
  if (provider === "anima" || provider === "local") {
    return "Last reply from Anima LLM (self-hosted)";
  }
  if (provider === "openrouter") {
    return "Last reply from Venice Uncensored via OpenRouter";
  }
  return "Last reply LLM";
}

/**
 * Tooltip for the chat header chip.
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} brand
 */
export function llmDisplayTitle(provider, brand) {
  if (brand === "anima") {
    return "Anima LLM — open weights, self-hosted (never switches to a flagship provider)";
  }
  if (brand === "openrouter" || provider === "openrouter") {
    return "Venice Uncensored (Dolphin Mistral 24B) via OpenRouter — open-weight uncensored chat";
  }
  return llmProviderTitle(provider);
}

/** Badge styles for the chat header provider chip. */
export function llmProviderBadgeClass(provider) {
  if (provider === "anima" || provider === "local") {
    return "border-rose-400/50 text-rose-200/90 bg-rose-400/10";
  }
  if (provider === "openrouter") {
    return "border-amber-400/50 text-amber-200/90 bg-amber-400/10";
  }
  return "border-primary/30 text-primary/50";
}

/**
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} brand
 */
export function llmDisplayBadgeClass(provider, brand) {
  if (brand === "anima") return llmProviderBadgeClass("anima");
  if (brand === "openrouter") return llmProviderBadgeClass("openrouter");
  return llmProviderBadgeClass(provider);
}

/** Chat backends shown in Settings. */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "local",
    label: "Anima LLM",
    env: "ANIMA_LOCAL_LLM_BASE_URL",
    note: "Self-hosted open weights (Ollama/vLLM) — preferred when configured",
  },
  {
    id: "openrouter",
    label: "Venice Uncensored",
    env: "OPENROUTER_API_KEY",
    note: "OpenRouter key (free signup). Venice Uncensored when the account has credits; otherwise auto-falls back to openai/gpt-oss-20b:free",
  },
];

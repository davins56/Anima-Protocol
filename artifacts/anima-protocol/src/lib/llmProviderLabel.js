/**
 * Display labels for the chat LLM backend returned by the API.
 * Primary: self-hosted Anima LLM, then MiniMax. OpenRouter remains optional.
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "anima" || provider === "local") return "Anima";
  if (provider === "minimax") return "MiniMax";
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
  if (brand === "minimax" || provider === "minimax") return "MiniMax";
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
  if (provider === "minimax") {
    return "Last reply from MiniMax";
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
  if (brand === "minimax" || provider === "minimax") {
    return "MiniMax cloud chat";
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
  if (provider === "minimax") {
    return "border-cyan-400/50 text-cyan-200/90 bg-cyan-400/10";
  }
  return "border-primary/30 text-primary/50";
}

/**
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} brand
 */
export function llmDisplayBadgeClass(provider, brand) {
  if (brand === "anima") return llmProviderBadgeClass("anima");
  if (brand === "minimax") return llmProviderBadgeClass("minimax");
  if (brand === "openrouter") return llmProviderBadgeClass("openrouter");
  return llmProviderBadgeClass(provider);
}

/** Chat backends shown in Settings. */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "minimax",
    label: "MiniMax",
    env: "MINIMAX_API_KEY",
    note: "Preferred cloud chat provider when configured. Defaults to MiniMax-M2.5 via the MiniMax Global OpenAI-compatible API.",
  },
  {
    id: "local",
    label: "Anima LLM",
    env: "ANIMA_LOCAL_LLM_BASE_URL",
    note: "Self-hosted open weights (Ollama/vLLM) — used for chat when ANIMA_LOCAL_LLM_BASE_URL is set. Set ANIMA_LLM_PROVIDER=custom to keep OpenRouter from taking over.",
  },
  {
    id: "openrouter",
    label: "Venice Uncensored",
    env: "OPENROUTER_API_KEY",
    note: "Used only when the custom LLM URL is unset, or after a connection failure if ANIMA_OPENROUTER_FALLBACK=true. Free-tier daily caps cannot replace a configured custom LLM.",
  },
];

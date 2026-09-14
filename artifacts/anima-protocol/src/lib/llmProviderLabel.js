/**
 * Display labels for the chat LLM backend returned by the API.
 * A usable self-hosted Anima LLM is fail-closed (customOnly); MiniMax is
 * not a chat fallback. OpenRouter hops only after Workers AI when no
 * custom host is configured.
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "anima" || provider === "local") return "Anima";
  if (provider === "minimax") return "MiniMax";
  if (provider === "deepshi") return "Deepshi";
  if (provider === "openrouter") return "Venice";
  if (provider === "workersai") return "DeepSeek";
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
  if (brand === "deepshi" || provider === "deepshi") return "Deepshi";
  if (brand === "openrouter" || provider === "openrouter") return "Venice";
  if (brand === "workersai" || provider === "workersai") return "DeepSeek";
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
  if (provider === "deepshi") {
    return "Last reply from Deepshi";
  }
  if (provider === "workersai") {
    return "Last reply from DeepSeek via Cloudflare Workers AI";
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
  if (brand === "deepshi" || provider === "deepshi") {
    return "Deepshi cloud chat (api.deepshi.ai)";
  }
  if (brand === "openrouter" || provider === "openrouter") {
    return "Venice Uncensored (Dolphin Mistral 24B) via OpenRouter — open-weight uncensored chat";
  }
  if (brand === "workersai" || provider === "workersai") {
    return "DeepSeek R1 distill via Cloudflare Workers AI (AI Gateway)";
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
  if (provider === "deepshi") {
    return "border-violet-400/50 text-violet-200/90 bg-violet-400/10";
  }
  if (provider === "workersai") {
    return "border-emerald-400/50 text-emerald-200/90 bg-emerald-400/10";
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
  if (brand === "deepshi") return llmProviderBadgeClass("deepshi");
  if (brand === "openrouter") return llmProviderBadgeClass("openrouter");
  if (brand === "workersai") return llmProviderBadgeClass("workersai");
  return llmProviderBadgeClass(provider);
}

/** Chat backends shown in Settings. */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "workersai",
    label: "DeepSeek (Workers AI)",
    env: "AI",
    note: "Used only when no usable ANIMA_LOCAL_LLM_BASE_URL is set. Cloudflare Workers AI DeepSeek R1 distill via AI Gateway deepseek-gateway.",
  },
  {
    id: "minimax",
    label: "MiniMax",
    env: "MINIMAX_API_KEY",
    note: "Not used for companion chat while a custom/local LLM is preferred. MiniMax stays out of the failover chain.",
  },
  {
    id: "deepshi",
    label: "Deepshi",
    env: "DEEPSHI_API_KEY",
    note: "Not used for companion chat. MiniMax and Deepshi never fill a down custom host.",
  },
  {
    id: "local",
    label: "Anima LLM",
    env: "ANIMA_LOCAL_LLM_BASE_URL",
    note: "Self-hosted open weights (Ollama/vLLM) — used for chat when ANIMA_LOCAL_LLM_BASE_URL is set. customOnly is fail-closed: OpenRouter does not hop after this host, even if ANIMA_OPENROUTER_FALLBACK=true.",
  },
  {
    id: "openrouter",
    label: "Venice Uncensored",
    env: "OPENROUTER_API_KEY",
    note: "Used only when the custom LLM URL is unset (Workers AI hop via ANIMA_OPENROUTER_FALLBACK). A usable custom host never hops to OpenRouter. Free-tier daily caps cannot replace a configured custom LLM.",
  },
];

/**
 * Display labels for chat LLM backends returned by the API as
 * provider: "openai" | "xai" | "gemini" | "kimi"
 * and optional brand: "anima" (custom multi-model stack).
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "anima") return "Anima";
  if (provider === "gemini") return "Gemini";
  if (provider === "kimi") return "Kimi";
  if (provider === "xai") return "Grok";
  if (provider === "openai") return "OpenAI";
  return null;
}

/**
 * Chip label — when brand is anima, show Anima; otherwise the backend provider.
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} brand
 */
export function llmDisplayLabel(provider, brand) {
  if (brand === "anima") return "Anima";
  return llmProviderShortLabel(provider);
}

/** @param {string | null | undefined} provider */
export function llmProviderTitle(provider) {
  if (provider === "anima") {
    return "Anima custom LLM (Kimi · Gemini · Grok · ChatGPT)";
  }
  if (provider === "gemini") {
    return "Last reply from Gemini (Google AI)";
  }
  if (provider === "kimi") {
    return "Last reply from Kimi (Moonshot)";
  }
  if (provider === "xai") {
    return "Last reply from Grok (xAI)";
  }
  if (provider === "openai") {
    return "Last reply from OpenAI";
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
    const backend = llmProviderShortLabel(provider);
    return backend
      ? `Anima custom LLM · served by ${backend}`
      : "Anima custom LLM (Kimi · Gemini · Grok · ChatGPT)";
  }
  return llmProviderTitle(provider);
}

/** Badge styles for the chat header provider chip. */
export function llmProviderBadgeClass(provider) {
  if (provider === "anima") {
    return "border-rose-400/50 text-rose-200/90 bg-rose-400/10";
  }
  if (provider === "gemini") {
    return "border-sky-400/50 text-sky-300/90 bg-sky-400/10";
  }
  if (provider === "kimi") {
    return "border-emerald-400/50 text-emerald-300/90 bg-emerald-400/10";
  }
  if (provider === "xai") {
    return "border-amber-400/50 text-amber-300/90 bg-amber-400/10";
  }
  return "border-primary/30 text-primary/50";
}

/**
 * @param {string | null | undefined} provider
 * @param {string | null | undefined} brand
 */
export function llmDisplayBadgeClass(provider, brand) {
  if (brand === "anima") return llmProviderBadgeClass("anima");
  return llmProviderBadgeClass(provider);
}

/** Providers the custom Anima LLM can draw from (order = product narrative). */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "anima",
    label: "Anima",
    env: "ANIMA_LLM_PROVIDER=anima",
    note: "Custom multi-model LLM — minds draft in parallel, then Anima streams one combined reply",
  },
  {
    id: "kimi",
    label: "Kimi",
    env: "KIMI_API_KEY",
    note: "Moonshot — lead backend under Anima mode (and default when set alone)",
  },
  {
    id: "gemini",
    label: "Gemini",
    env: "GEMINI_API_KEY",
    note: "Google AI Studio — first failover after Kimi under Anima mode",
  },
  {
    id: "xai",
    label: "Grok",
    env: "XAI_API_KEY",
    note: "xAI — heavy-tier lead under Anima mode",
  },
  {
    id: "openai",
    label: "ChatGPT",
    env: "OPENAI_API_KEY",
    note: "OpenAI — heavy-tier backup + image generate/edit",
  },
];

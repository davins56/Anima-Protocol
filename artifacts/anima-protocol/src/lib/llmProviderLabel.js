/**
 * Display labels for chat LLM backends returned by the API as
 * provider: "openai" | "xai" | "kimi" (legacy "gemini" may still appear
 * briefly from older deploys) and optional brand: "anima".
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "anima") return "Anima";
  if (provider === "kimi") return "Kimi";
  if (provider === "xai") return "Grok";
  if (provider === "openai") return "OpenAI";
  // Legacy label for responses from older deploys that still returned gemini.
  if (provider === "gemini") return "Gemini";
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
    return "Anima chat powered by Kimi";
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
  if (provider === "gemini") {
    return "Last reply from Gemini (retired for chat)";
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
      ? `Anima · served by ${backend}`
      : "Anima chat powered by Kimi";
  }
  return llmProviderTitle(provider);
}

/** Badge styles for the chat header provider chip. */
export function llmProviderBadgeClass(provider) {
  if (provider === "anima") {
    return "border-rose-400/50 text-rose-200/90 bg-rose-400/10";
  }
  if (provider === "kimi") {
    return "border-emerald-400/50 text-emerald-300/90 bg-emerald-400/10";
  }
  if (provider === "xai") {
    return "border-amber-400/50 text-amber-300/90 bg-amber-400/10";
  }
  if (provider === "gemini") {
    return "border-sky-400/50 text-sky-300/90 bg-sky-400/10";
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

/** Providers shown in Settings — Kimi preferred, Grok/OpenAI as backup. */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "kimi",
    label: "Kimi",
    env: "KIMI_API_KEY",
    note: "Moonshot — preferred chat LLM (fails over to Grok/OpenAI)",
  },
  {
    id: "xai",
    label: "Grok",
    env: "XAI_API_KEY",
    note: "xAI — backup when Kimi is exhausted",
  },
  {
    id: "openai",
    label: "ChatGPT",
    env: "OPENAI_API_KEY",
    note: "OpenAI — backup + image generation",
  },
];

/**
 * Display labels for chat LLM backends returned by the API as
 * provider: "local" | "openai" | "xai" | "kimi" | "gemini" | "gateway" | "groq"
 * and optional brand: "anima" (self-hosted Anima LLM).
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "anima" || provider === "local") return "Anima";
  if (provider === "kimi") return "Kimi";
  if (provider === "xai") return "Grok";
  if (provider === "openai") return "OpenAI";
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  if (provider === "gateway") return "Gateway";
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
  if (provider === "anima" || provider === "local") {
    return "Last reply from Anima LLM (self-hosted)";
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
    return "Last reply from Gemini";
  }
  if (provider === "groq") {
    return "Last reply from Groq";
  }
  if (provider === "gateway") {
    return "Last reply from Vercel AI Gateway";
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
    if (provider === "local" || provider === "anima" || !provider) {
      return "Anima LLM — open weights, self-hosted (not ChatGPT/Gemini/Groq)";
    }
    const backend = llmProviderShortLabel(provider);
    return backend
      ? `Anima · served by ${backend}`
      : "Anima LLM — open weights, self-hosted";
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
  if (provider === "gateway") {
    return "border-violet-400/50 text-violet-200/90 bg-violet-400/10";
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

/** Providers shown in Settings — Anima self-hosted first, then optional cloud BYOK. */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "local",
    label: "Anima LLM",
    env: "ANIMA_LOCAL_LLM_BASE_URL",
    note: "Self-hosted open weights (Ollama/vLLM) — set ANIMA_LLM_PROVIDER=custom",
  },
  {
    id: "gemini",
    label: "Gemini",
    env: "GEMINI_API_KEY",
    note: "Optional cloud BYOK under ANIMA_LLM_PROVIDER=auto",
  },
  {
    id: "kimi",
    label: "Kimi",
    env: "KIMI_API_KEY",
    note: "Optional Moonshot backup under auto",
  },
  {
    id: "xai",
    label: "Grok",
    env: "XAI_API_KEY",
    note: "Optional xAI backup under auto",
  },
  {
    id: "openai",
    label: "ChatGPT",
    env: "OPENAI_API_KEY",
    note: "Optional OpenAI backup under auto + image generation",
  },
  {
    id: "gateway",
    label: "AI Gateway",
    env: "AI_GATEWAY_API_KEY",
    note: "Optional Vercel AI Gateway last resort under auto",
  },
];

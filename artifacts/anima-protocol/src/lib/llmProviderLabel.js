/**
 * Display labels for chat LLM backends returned by the API as
 * provider: "openai" | "xai" | "gemini" | "kimi".
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "gemini") return "Gemini";
  if (provider === "kimi") return "Kimi";
  if (provider === "xai") return "Grok";
  if (provider === "openai") return "OpenAI";
  return null;
}

/** @param {string | null | undefined} provider */
export function llmProviderTitle(provider) {
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

/** Badge styles for the chat header provider chip. */
export function llmProviderBadgeClass(provider) {
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

/** Providers the deployment is designed to use (order = preference). */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "kimi",
    label: "Kimi",
    env: "KIMI_API_KEY",
    note: "Moonshot Open Platform — set ANIMA_LLM_PROVIDER=kimi to force",
  },
  {
    id: "gemini",
    label: "Gemini",
    env: "GEMINI_API_KEY",
    note: "Default chat model when set (Google AI Studio)",
  },
  {
    id: "xai",
    label: "Grok",
    env: "XAI_API_KEY",
    note: "Backup under ANIMA_LLM_PROVIDER=auto",
  },
  {
    id: "openai",
    label: "OpenAI",
    env: "OPENAI_API_KEY",
    note: "Last-resort chat + image generate/edit",
  },
];

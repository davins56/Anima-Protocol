/**
 * Display labels for the chat LLM backend returned by the API.
 * Chat always runs on the self-hosted Anima LLM: provider "local", brand
 * "anima". There is no cloud flagship fallback to label.
 */

/** @param {string | null | undefined} provider */
export function llmProviderShortLabel(provider) {
  if (provider === "anima" || provider === "local") return "Anima";
  return null;
}

/**
 * Chip label — always Anima once a reply has been served.
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
  return llmProviderTitle(provider);
}

/** Badge styles for the chat header provider chip. */
export function llmProviderBadgeClass(provider) {
  if (provider === "anima" || provider === "local") {
    return "border-rose-400/50 text-rose-200/90 bg-rose-400/10";
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

/** The single chat backend, shown in Settings. */
export const CONFIGURED_LLM_PROVIDERS = [
  {
    id: "local",
    label: "Anima LLM",
    env: "ANIMA_LOCAL_LLM_BASE_URL",
    note: "Self-hosted open weights (Ollama/vLLM) — the only chat backend, no cloud fallback",
  },
];

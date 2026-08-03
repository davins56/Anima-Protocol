import OpenAI from "openai";

let openaiClient: OpenAI | null = null;
let openaiClientKey: string | null = null;

let xaiClient: OpenAI | null = null;
let xaiClientKey: string | null = null;

let geminiClient: OpenAI | null = null;
let geminiClientKey: string | null = null;

let kimiClient: OpenAI | null = null;
let kimiClientKey: string | null = null;

/** Normalize env keys that were pasted with surrounding quotes or whitespace. */
export function normalizeApiKey(raw: string | undefined): string | null {
  if (!raw) return null;
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key || null;
}

export function hasOpenAIKey(): boolean {
  return Boolean(normalizeApiKey(process.env.OPENAI_API_KEY));
}

export function hasXaiKey(): boolean {
  return Boolean(normalizeApiKey(process.env.XAI_API_KEY));
}

export function hasGeminiKey(): boolean {
  return Boolean(
    normalizeApiKey(process.env.GEMINI_API_KEY) ||
      normalizeApiKey(process.env.GOOGLE_API_KEY),
  );
}

/** Moonshot / Kimi Open Platform key (`KIMI_API_KEY` or `MOONSHOT_API_KEY`). */
export function hasKimiKey(): boolean {
  return Boolean(
    normalizeApiKey(process.env.KIMI_API_KEY) ||
      normalizeApiKey(process.env.MOONSHOT_API_KEY),
  );
}

export function getOpenAIClient(): OpenAI {
  const apiKey = normalizeApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be set.");
  }
  if (!openaiClient || openaiClientKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    openaiClientKey = apiKey;
  }
  return openaiClient;
}

/** OpenAI-compatible xAI (Grok) client. Returns null when XAI_API_KEY is unset. */
export function getXaiClient(): OpenAI | null {
  const apiKey = normalizeApiKey(process.env.XAI_API_KEY);
  if (!apiKey) return null;
  if (!xaiClient || xaiClientKey !== apiKey) {
    xaiClient = new OpenAI({
      apiKey,
      baseURL: process.env.XAI_BASE_URL?.trim() || "https://api.x.ai/v1",
    });
    xaiClientKey = apiKey;
  }
  return xaiClient;
}

/**
 * @deprecated Chat uses the native Generative Language API in `geminiNative.ts`
 * so AQ.* AI Studio auth keys work. Kept only for any legacy callers/tests.
 */
export function getGeminiClient(): OpenAI | null {
  const apiKey =
    normalizeApiKey(process.env.GEMINI_API_KEY) ||
    normalizeApiKey(process.env.GOOGLE_API_KEY);
  if (!apiKey) return null;
  if (!geminiClient || geminiClientKey !== apiKey) {
    geminiClient = new OpenAI({
      apiKey,
      baseURL:
        process.env.GEMINI_BASE_URL?.trim() ||
        "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    geminiClientKey = apiKey;
  }
  return geminiClient;
}

/**
 * OpenAI-compatible Moonshot / Kimi client.
 * Accepts KIMI_API_KEY or MOONSHOT_API_KEY. Returns null when neither is set.
 */
export function getKimiClient(): OpenAI | null {
  const apiKey =
    normalizeApiKey(process.env.KIMI_API_KEY) ||
    normalizeApiKey(process.env.MOONSHOT_API_KEY);
  if (!apiKey) return null;
  if (!kimiClient || kimiClientKey !== apiKey) {
    kimiClient = new OpenAI({
      apiKey,
      baseURL:
        process.env.KIMI_BASE_URL?.trim() ||
        process.env.MOONSHOT_BASE_URL?.trim() ||
        "https://api.moonshot.ai/v1",
      // Moonshot Tier-0 accounts can burn RPM on SDK auto-retries after 429.
      maxRetries: 0,
    });
    kimiClientKey = apiKey;
  }
  return kimiClient;
}

/** Test helper — clears cached SDK clients between cases. */
export function resetLlmClientsForTests(): void {
  openaiClient = null;
  openaiClientKey = null;
  xaiClient = null;
  xaiClientKey = null;
  geminiClient = null;
  geminiClientKey = null;
  kimiClient = null;
  kimiClientKey = null;
}

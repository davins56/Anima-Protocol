import OpenAI from "openai";

let openaiClient: OpenAI | null = null;
let openaiClientKey: string | null = null;

let xaiClient: OpenAI | null = null;
let xaiClientKey: string | null = null;

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

/** Test helper — clears cached SDK clients between cases. */
export function resetLlmClientsForTests(): void {
  openaiClient = null;
  openaiClientKey = null;
  xaiClient = null;
  xaiClientKey = null;
}

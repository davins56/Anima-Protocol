import OpenAI from "openai";

let client: OpenAI | null = null;
let clientKey: string | null = null;

/** Normalize env keys that were pasted with surrounding quotes or whitespace. */
function normalizeApiKey(raw: string | undefined): string | null {
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

export function getOpenAIClient(): OpenAI {
  const apiKey = normalizeApiKey(process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY must be set.");
  }
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({ apiKey });
    clientKey = apiKey;
  }
  return client;
}

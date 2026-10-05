const numberFromEnv = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: numberFromEnv("PORT", 8082, 1, 65_535),
  llmBaseUrl: (process.env.LLM_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/+$/, ""),
  llmApiKey: process.env.LLM_API_KEY || "ollama",
  llmModel: process.env.LLM_MODEL || "anima-chat",
  requestTimeoutMs: numberFromEnv("LLM_REQUEST_TIMEOUT_MS", 45_000, 2_000, 120_000),
  maxContextMessages: numberFromEnv("MAX_CONTEXT_MESSAGES", 20, 2, 100),
  maxMessageChars: numberFromEnv("MAX_MESSAGE_CHARS", 8_000, 200, 50_000),
  maxOutputTokens: numberFromEnv("MAX_OUTPUT_TOKENS", 384, 32, 2_048),
  apiKey: process.env.CHAT_API_KEY || "",
};

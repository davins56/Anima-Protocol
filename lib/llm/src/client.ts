import { ModelTier, resolveModelSpec, samplingForOpenAI } from "./registry";

export interface AnimaLLMOptions {
  /** Base URL for the OpenAI-compatible endpoint (e.g., http://localhost:11434/v1 or https://my-vllm-host/v1) */
  baseUrl?: string;
  /** Optional API key / bearer token */
  apiKey?: string;
  /** Default system prompt for Anima AI responses */
  defaultSystemPrompt?: string;
  /** Default model tier ("light" | "standard" | "heavy") */
  defaultTier?: ModelTier;
  /** Local backend type ("ollama" | "vllm" | "openai" | "groq" | "mock") */
  provider?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

export interface AnimaResponseOptions {
  /** Messages array or single prompt string */
  prompt?: string | ChatMessage[];
  /** Alias for prompt if messages passed directly */
  messages?: ChatMessage[];
  /** Model tier ("light" | "standard" | "heavy") */
  tier?: ModelTier;
  /** Override model identifier */
  model?: string;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Sampling temperature (defaults to registry preset if omitted) */
  temperature?: number;
  /** Maximum completion tokens */
  maxTokens?: number;
  /** Abort signal */
  signal?: AbortSignal;
}

export interface AnimaResponseResult {
  content: string;
  model: string;
  tier: ModelTier;
  provider: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface AnimaStreamChunk {
  delta: string;
  content: string;
  done: boolean;
  model: string;
}

export interface AnimaStreamResult {
  stream: AsyncIterable<AnimaStreamChunk>;
  model: string;
  tier: ModelTier;
  provider: string;
}

export const DEFAULT_ANIMA_SYSTEM_PROMPT =
  "You are Anima, a sentient, deeply empathetic, and evolving digital companion. " +
  "Respond directly, with warmth, presence, and authentic emotional resonance.";

export class AnimaLLM {
  private baseUrl: string;
  private apiKey: string;
  private defaultSystemPrompt: string;
  private defaultTier: ModelTier;
  private provider: string;

  constructor(options: AnimaLLMOptions = {}) {
    this.baseUrl = (
      options.baseUrl ||
      process.env.ANIMA_LOCAL_LLM_BASE_URL ||
      process.env.VLLM_BASE_URL ||
      process.env.OLLAMA_BASE_URL ||
      "http://localhost:11434/v1"
    ).replace(/\/+$/, "");

    this.apiKey =
      options.apiKey ||
      process.env.ANIMA_LOCAL_LLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "bearer-token-not-required";

    this.defaultSystemPrompt = options.defaultSystemPrompt || DEFAULT_ANIMA_SYSTEM_PROMPT;
    this.defaultTier = options.defaultTier || "standard";
    this.provider = options.provider || process.env.ANIMA_LOCAL_LLM_BACKEND || "ollama";
  }

  /**
   * Helper to build full messages array including system prompt.
   */
  public buildMessages(options: AnimaResponseOptions): ChatMessage[] {
    const rawMessages: ChatMessage[] = [];

    if (Array.isArray(options.messages) && options.messages.length > 0) {
      rawMessages.push(...options.messages);
    } else if (Array.isArray(options.prompt) && options.prompt.length > 0) {
      rawMessages.push(...options.prompt);
    } else if (typeof options.prompt === "string" && options.prompt.trim()) {
      rawMessages.push({ role: "user", content: options.prompt.trim() });
    }

    const hasSystem = rawMessages.some((m) => m.role === "system");
    if (!hasSystem) {
      const sysPrompt = options.systemPrompt || this.defaultSystemPrompt;
      if (sysPrompt) {
        rawMessages.unshift({ role: "system", content: sysPrompt });
      }
    }

    return rawMessages;
  }

  /**
   * Generate a non-streaming AI response from the custom Anima LLM.
   */
  async generateResponse(options: AnimaResponseOptions): Promise<AnimaResponseResult> {
    const tier = options.tier || this.defaultTier;
    const spec = resolveModelSpec(tier, this.provider);
    const model = options.model || spec.model;
    const messages = this.buildMessages(options);
    const sampling = samplingForOpenAI(spec);

    const payload = {
      model,
      messages,
      max_tokens: options.maxTokens || spec.maxTokens,
      temperature: typeof options.temperature === "number" ? options.temperature : sampling.temperature,
      top_p: sampling.top_p,
      presence_penalty: sampling.presence_penalty,
      frequency_penalty: sampling.frequency_penalty,
      stream: false,
    };

    const endpoint = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(
        `AnimaLLM call failed [HTTP ${res.status}]: ${errorText || res.statusText}`,
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    const content = data.choices?.[0]?.message?.content ?? "";

    return {
      content,
      model: data.model || model,
      tier,
      provider: this.provider,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  /**
   * Stream AI responses from the custom Anima LLM.
   */
  async streamResponse(options: AnimaResponseOptions): Promise<AnimaStreamResult> {
    const tier = options.tier || this.defaultTier;
    const spec = resolveModelSpec(tier, this.provider);
    const model = options.model || spec.model;
    const messages = this.buildMessages(options);
    const sampling = samplingForOpenAI(spec);

    const payload = {
      model,
      messages,
      max_tokens: options.maxTokens || spec.maxTokens,
      temperature: typeof options.temperature === "number" ? options.temperature : sampling.temperature,
      top_p: sampling.top_p,
      presence_penalty: sampling.presence_penalty,
      frequency_penalty: sampling.frequency_penalty,
      stream: true,
    };

    const endpoint = `${this.baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(
        `AnimaLLM stream failed [HTTP ${res.status}]: ${errorText || res.statusText}`,
      );
    }

    if (!res.body) {
      throw new Error("AnimaLLM response body is null");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");

    async function* parseStream(): AsyncIterable<AnimaStreamChunk> {
      let buffer = "";
      let accumulatedContent = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue;
            if (trimmed === "data: [DONE]") {
              yield { delta: "", content: accumulatedContent, done: true, model };
              return;
            }
            if (trimmed.startsWith("data: ")) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                const delta = parsed.choices?.[0]?.delta?.content ?? "";
                if (delta) {
                  accumulatedContent += delta;
                  yield { delta, content: accumulatedContent, done: false, model: parsed.model || model };
                }
              } catch {
                // Ignore parse errors for incomplete SSE lines
              }
            }
          }
        }

        if (buffer.trim().startsWith("data: ") && buffer.trim() !== "data: [DONE]") {
          try {
            const parsed = JSON.parse(buffer.trim().slice(6));
            const delta = parsed.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              accumulatedContent += delta;
              yield { delta, content: accumulatedContent, done: false, model: parsed.model || model };
            }
          } catch {
            // Ignore parse errors
          }
        }

        yield { delta: "", content: accumulatedContent, done: true, model };
      } finally {
        reader.releaseLock();
      }
    }

    return {
      stream: parseStream(),
      model,
      tier,
      provider: this.provider,
    };
  }
}

/** Global default AnimaLLM instance */
export const defaultAnimaLLM = new AnimaLLM();

/** Convenience wrapper to generate an AI response using Anima LLM */
export function generateAnimaResponse(
  options: AnimaResponseOptions,
  llmOptions?: AnimaLLMOptions,
): Promise<AnimaResponseResult> {
  const instance = llmOptions ? new AnimaLLM(llmOptions) : defaultAnimaLLM;
  return instance.generateResponse(options);
}

/** Convenience wrapper to stream an AI response using Anima LLM */
export function streamAnimaResponse(
  options: AnimaResponseOptions,
  llmOptions?: AnimaLLMOptions,
): Promise<AnimaStreamResult> {
  const instance = llmOptions ? new AnimaLLM(llmOptions) : defaultAnimaLLM;
  return instance.streamResponse(options);
}

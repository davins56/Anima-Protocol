import { getOpenAIClient } from "./openaiClient";

export type ProviderName = "groq" | "openai" | "ollama" | "vllm" | "mock";

export interface ModelRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  model?: string;
  stream?: boolean;
}

export interface ModelResponse {
  text: string;
  provider: ProviderName;
  model: string;
}

export interface ModelProvider {
  name: ProviderName;
  generate(request: ModelRequest): Promise<ModelResponse>;
  generateStream(request: ModelRequest): AsyncIterable<string>;
}

export interface ProviderFallbackChain {
  providers: ProviderName[];
}

function createMockProvider(): ModelProvider {
  return {
    name: "mock",
    async generate({ prompt, systemPrompt }) {
      return {
        text: `Mock reply to: ${prompt}${systemPrompt ? `\n[system:${systemPrompt}]` : ""}`,
        provider: "mock",
        model: "mock-local",
      };
    },
    async *generateStream({ prompt, systemPrompt }) {
      const text = `Mock reply to: ${prompt}${systemPrompt ? `\n[system:${systemPrompt}]` : ""}`;
      for (const part of text.split(/(\s+)/)) {
        if (part) {
          yield part;
        }
      }
    },
  };
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider request failed (${response.status}): ${text}`);
  }
  return response.json();
}

function createGroqProvider(): ModelProvider {
  return {
    name: "groq",
    async generate(request) {
      const chunks: string[] = [];
      for await (const chunk of this.generateStream(request)) {
        chunks.push(chunk);
      }
      return {
        text: chunks.join(""),
        provider: "groq",
        model: request.model ?? "llama-3.1-8b-instant",
      };
    },
    async *generateStream({ prompt, systemPrompt, maxTokens, model }) {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error("GROQ_API_KEY must be set.");
      }

      const payload = {
        model: model ?? "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt ?? "" },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens ?? 1024,
        stream: false,
      };

      const data = await fetchJson("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const text = data?.choices?.[0]?.message?.content ?? "";
      if (typeof text === "string" && text) {
        for (const chunk of text.split(/(\s+)/)) {
          if (chunk) {
            yield chunk;
          }
        }
      }
    },
  };
}

function createOllamaProvider(): ModelProvider {
  return {
    name: "ollama",
    async generate(request) {
      const chunks: string[] = [];
      for await (const chunk of this.generateStream(request)) {
        chunks.push(chunk);
      }
      return {
        text: chunks.join(""),
        provider: "ollama",
        model: request.model ?? "anima-ministral8b",
      };
    },
    async *generateStream({ prompt, systemPrompt, maxTokens, model }) {
      const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
      const payload = {
        model: model ?? "anima-ministral8b",
        prompt: `${systemPrompt ? `${systemPrompt}\n\n` : ""}${prompt}`,
        stream: false,
        options: {
          num_predict: maxTokens ?? 1024,
        },
      };

      const data = await fetchJson(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const text = data?.response ?? "";
      if (typeof text === "string" && text) {
        for (const chunk of text.split(/(\s+)/)) {
          if (chunk) {
            yield chunk;
          }
        }
      }
    },
  };
}

/** OpenAI-compatible vLLM (or any /v1 chat.completions server). */
function createVllmProvider(): ModelProvider {
  return {
    name: "vllm",
    async generate(request) {
      const chunks: string[] = [];
      for await (const chunk of this.generateStream(request)) {
        chunks.push(chunk);
      }
      return {
        text: chunks.join(""),
        provider: "vllm",
        model: request.model ?? "mistralai/Ministral-3-8B-Instruct-2512",
      };
    },
    async *generateStream({ prompt, systemPrompt, maxTokens, model }) {
      const baseUrl = (
        process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() ||
        process.env.VLLM_BASE_URL?.trim() ||
        "http://localhost:8000/v1"
      ).replace(/\/$/, "");
      const apiKey =
        process.env.ANIMA_LOCAL_LLM_API_KEY?.trim() ||
        process.env.VLLM_API_KEY?.trim() ||
        "local";

      const payload = {
        model: model ?? "mistralai/Ministral-3-8B-Instruct-2512",
        messages: [
          { role: "system", content: systemPrompt ?? "" },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens ?? 1024,
        stream: false,
      };

      const data = await fetchJson(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const text = data?.choices?.[0]?.message?.content ?? "";
      if (typeof text === "string" && text) {
        for (const chunk of text.split(/(\s+)/)) {
          if (chunk) {
            yield chunk;
          }
        }
      }
    },
  };
}

function createOpenAIProvider(): ModelProvider {
  return {
    name: "openai",
    async generate(request) {
      const chunks: string[] = [];
      for await (const chunk of this.generateStream(request)) {
        chunks.push(chunk);
      }
      return {
        text: chunks.join(""),
        provider: "openai",
        model: request.model ?? "gpt-4o",
      };
    },
    async *generateStream({ prompt, systemPrompt, maxTokens, model }) {
      const client = getOpenAIClient();
      const stream = await client.chat.completions.create({
        model: model ?? "gpt-4o",
        max_tokens: maxTokens ?? 1024,
        messages: [
          { role: "system", content: systemPrompt ?? "" },
          { role: "user", content: prompt },
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      }
    },
  };
}

export function getConfiguredProviderName(): ProviderName {
  const value = process.env.ANIMA_LLM_PROVIDER?.trim().toLowerCase();
  if (value === "groq" || value === "openai" || value === "ollama" || value === "vllm" || value === "mock") {
    return value;
  }
  if (value === "local" || value === "local-first") return "vllm";
  return "mock";
}

export function getProviderFallbackChain(): ProviderFallbackChain {
  const raw = process.env.ANIMA_LLM_FALLBACKS?.trim();
  const primary = getConfiguredProviderName();
  const seen = new Set<ProviderName>();
  const providers: ProviderName[] = [];

  const addProvider = (name: ProviderName) => {
    if (!seen.has(name)) {
      seen.add(name);
      providers.push(name);
    }
  };

  if (raw) {
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(
        (item): item is ProviderName =>
          item === "groq" ||
          item === "openai" ||
          item === "ollama" ||
          item === "vllm" ||
          item === "mock",
      )
      .forEach(addProvider);
  }

  addProvider(primary);
  addProvider("mock");

  return { providers };
}

export function createModelProvider(name: ProviderName = getConfiguredProviderName()): ModelProvider {
  switch (name) {
    case "groq":
      return createGroqProvider();
    case "openai":
      return createOpenAIProvider();
    case "ollama":
      return createOllamaProvider();
    case "vllm":
      return createVllmProvider();
    case "mock":
    default:
      return createMockProvider();
  }
}

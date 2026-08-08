import { describe, expect, it } from "vitest";
import {
  isCloudFlagshipLlmHost,
  summarizeLocalLlmBaseUrl,
} from "../src/lib/openaiClient";

describe("isCloudFlagshipLlmHost", () => {
  it("flags OpenAI / Groq / Gemini / Anthropic hosts", () => {
    expect(isCloudFlagshipLlmHost("api.openai.com")).toBe(true);
    expect(isCloudFlagshipLlmHost("API.OpenAI.com")).toBe(true);
    expect(isCloudFlagshipLlmHost("eastus.api.openai.com")).toBe(true);
    expect(isCloudFlagshipLlmHost("api.groq.com")).toBe(true);
    expect(isCloudFlagshipLlmHost("generativelanguage.googleapis.com")).toBe(true);
    expect(isCloudFlagshipLlmHost("api.anthropic.com")).toBe(true);
  });

  it("allows self-hosted / tunnel hosts", () => {
    expect(isCloudFlagshipLlmHost("localhost")).toBe(false);
    expect(isCloudFlagshipLlmHost("127.0.0.1")).toBe(false);
    expect(isCloudFlagshipLlmHost("anima-llm.onrender.com")).toBe(false);
    expect(isCloudFlagshipLlmHost("anima-chat-llm.fly.dev")).toBe(false);
    expect(isCloudFlagshipLlmHost("random-words.trycloudflare.com")).toBe(false);
    expect(isCloudFlagshipLlmHost(null)).toBe(false);
  });
});

describe("summarizeLocalLlmBaseUrl cloud detection", () => {
  const SAVED = { ...process.env };

  it("marks api.openai.com as isCloudFlagship", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://api.openai.com/v1";
    const summary = summarizeLocalLlmBaseUrl();
    expect(summary.configured).toBe(true);
    expect(summary.host).toBe("api.openai.com");
    expect(summary.isCloudFlagship).toBe(true);
    process.env = { ...SAVED };
  });

  it("does not flag a Render Ollama host", () => {
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-llm.onrender.com/v1";
    const summary = summarizeLocalLlmBaseUrl();
    expect(summary.isCloudFlagship).toBe(false);
    process.env = { ...SAVED };
  });
});

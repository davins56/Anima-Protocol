import { afterEach, describe, expect, it } from "vitest";
import { getLlmRoutingStatus, getProviderChain } from "../src/lib/llmFailover";
import { resetLlmClientsForTests } from "../src/lib/openaiClient";

const SAVED = { ...process.env };

function clearLlmEnv() {
  delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
  delete process.env.VLLM_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.ANIMA_RUNTIME;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.CF_PAGES;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ANIMA_OPENROUTER_API_KEY;
  delete process.env.OPEN_ROUTER_API_KEY;
  delete process.env.ANIMA_LLM_PROVIDER;
  delete process.env.ANIMA_OPENROUTER_FALLBACK;
}

afterEach(() => {
  process.env = { ...SAVED };
  resetLlmClientsForTests();
});

describe("getLlmRoutingStatus on serverless / Worker", () => {
  it("reports localEndpoint.configured=false and tells the operator to set a public HTTPS URL", () => {
    clearLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    const status = getLlmRoutingStatus();
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.localEndpoint.isLocalhost).toBe(false);
    expect(status.localEndpoint.isLoopbackMisconfigured).toBe(false);
    expect(status.chain).toEqual([]);
    expect(status.status).toBe("error");
    expect(status.note).toMatch(/ANIMA_LOCAL_LLM_BASE_URL is unset/i);
    expect(status.note).toMatch(/public HTTPS/i);
    expect(status.note).toMatch(/deploy\/ollama-fly/i);
    expect(status.note).not.toMatch(/Self-hosted Anima LLM at host=localhost/i);
  });

  it("uses OpenRouter when a key exists and local is unset on the Worker", () => {
    clearLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-zzzz";
    const status = getLlmRoutingStatus();
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.status).toBe("ok");
    expect(status.preferred).toBe("openrouter");
    expect(status.chain).toEqual(["openrouter"]);
    expect(status.openrouter.configured).toBe(true);
    expect(getProviderChain()).toEqual(["openrouter"]);
    expect(status.chain).not.toContain("local");
  });

  it("keeps localhost default on plain Node so local-dev Ollama still works", () => {
    clearLlmEnv();
    const status = getLlmRoutingStatus();
    expect(status.localEndpoint.configured).toBe(true);
    expect(status.localEndpoint.host).toBe("localhost");
    expect(status.chain).toEqual(["local"]);
  });

  it("surfaces explicit localhost on the Worker as misconfigured and keeps it out of the chain", () => {
    clearLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-zzzz";
    const status = getLlmRoutingStatus();
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.localEndpoint.isLocalhost).toBe(true);
    expect(status.localEndpoint.isLoopbackMisconfigured).toBe(true);
    expect(status.localEndpoint.host).toBe("localhost");
    expect(status.chain).toEqual(["openrouter"]);
    expect(status.note).toMatch(/loopback/i);
    expect(status.note).toMatch(/1003/i);
    expect(status.note).toMatch(/anima-chat-llm\.fly\.dev/i);
  });
});

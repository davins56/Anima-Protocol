import { afterEach, describe, expect, it } from "vitest";
import { getLlmRoutingStatus, getProviderChain } from "../src/lib/llmFailover";
import { resetLlmClientsForTests } from "../src/lib/openaiClient";
import { resetAiBindingForTests } from "../src/lib/aiBinding";

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
  delete process.env.ANIMA_OPENROUTER_FREE;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.ANIMA_MINIMAX_API_KEY;
  delete process.env.DEEPSHI_API_KEY;
  delete process.env.ANIMA_DEEPSHI_API_KEY;
}

afterEach(() => {
  process.env = { ...SAVED };
  resetLlmClientsForTests();
  resetAiBindingForTests();
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
    expect(status.customOnly).toBe(true);
    expect(status.note).toMatch(/ANIMA_LOCAL_LLM_BASE_URL/i);
    expect(status.note).toMatch(/public HTTPS/i);
    expect(status.note).not.toMatch(/MINIMAX_API_KEY|Set OPENROUTER_API_KEY/i);
    expect(status.note).not.toMatch(/Self-hosted Anima LLM at host=localhost/i);
  });

  it("does not use OpenRouter when a key exists and local is unset on the Worker", () => {
    clearLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-zzzz";
    const status = getLlmRoutingStatus();
    expect(status.localEndpoint.configured).toBe(false);
    expect(status.status).toBe("error");
    expect(status.preferred).toBeNull();
    expect(status.customOnly).toBe(true);
    expect(status.chain).toEqual([]);
    expect(status.openrouter.configured).toBe(true);
    expect(getProviderChain()).toEqual([]);
    expect(status.note).toMatch(/OpenRouter will not be used/i);
  });

  it("does not add MiniMax or OpenRouter when cloud keys and free-tier are set", () => {
    clearLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-zzzz";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.chain).toEqual([]);
    expect(status.minimax.configured).toBe(true);
    expect(getProviderChain()).toEqual([]);
  });

  it("ignores ANIMA_LLM_PROVIDER=minimax and stays fail-closed without a local URL", () => {
    clearLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    process.env.OPENROUTER_API_KEY = "sk-or-test-key-zzzz";
    process.env.MINIMAX_API_KEY = "minimax-test";
    process.env.ANIMA_OPENROUTER_FREE = "true";
    process.env.ANIMA_LLM_PROVIDER = "minimax";
    const status = getLlmRoutingStatus();
    expect(status.status).toBe("error");
    expect(status.preferred).toBeNull();
    expect(status.chain).toEqual([]);
    expect(getProviderChain()).toEqual([]);
  });

  it("keeps localhost default on plain Node so local-dev Ollama still works", () => {
    clearLlmEnv();
    const status = getLlmRoutingStatus();
    expect(status.localEndpoint.configured).toBe(true);
    expect(status.localEndpoint.host).toBe("localhost");
    expect(status.chain).toEqual(["local"]);
    expect(status.customOnly).toBe(true);
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
    expect(status.chain).toEqual([]);
    expect(status.note).toMatch(/loopback/i);
    expect(status.note).toMatch(/1003/i);
  });
});

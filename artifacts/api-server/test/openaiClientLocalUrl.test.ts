import { afterEach, describe, expect, it } from "vitest";
import { isCloudflareWorkerRuntime as dbIsCloudflareWorkerRuntime } from "@workspace/db";
import {
  hasLocalLlm,
  isCloudflareWorkerRuntime,
  isLoopbackLlmHost,
  isLoopbackUnreachableRuntime,
  localLlmBaseUrl,
  readExplicitLocalLlmBaseUrl,
  resetLlmClientsForTests,
  summarizeLocalLlmBaseUrl,
} from "../src/lib/openaiClient";

const SAVED = { ...process.env };

function clearLocalLlmEnv() {
  delete process.env.ANIMA_LOCAL_LLM_BASE_URL;
  delete process.env.VLLM_BASE_URL;
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.ANIMA_RUNTIME;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.CF_PAGES;
}

afterEach(() => {
  process.env = { ...SAVED };
  resetLlmClientsForTests();
});

const workerGlobal = {
  navigator: { userAgent: "Cloudflare-Workers" },
} as typeof globalThis;

describe("isLoopbackUnreachableRuntime", () => {
  it("reuses @workspace/db isCloudflareWorkerRuntime (one Worker signal)", () => {
    expect(isCloudflareWorkerRuntime).toBe(dbIsCloudflareWorkerRuntime);
  });

  it("is false on plain Node (no Vercel / Worker signals)", () => {
    clearLocalLlmEnv();
    expect(isLoopbackUnreachableRuntime(process.env, globalThis)).toBe(false);
    expect(isCloudflareWorkerRuntime(globalThis)).toBe(false);
  });

  it("is true for the Cloudflare Workers userAgent", () => {
    clearLocalLlmEnv();
    expect(isCloudflareWorkerRuntime(workerGlobal)).toBe(true);
    expect(isLoopbackUnreachableRuntime(process.env, workerGlobal)).toBe(true);
  });

  it("is true for VERCEL / CF_PAGES / ANIMA_RUNTIME=worker", () => {
    clearLocalLlmEnv();
    expect(isLoopbackUnreachableRuntime({ VERCEL: "1" })).toBe(true);
    expect(isLoopbackUnreachableRuntime({ VERCEL_ENV: "production" })).toBe(true);
    expect(isLoopbackUnreachableRuntime({ CF_PAGES: "1" })).toBe(true);
    expect(isLoopbackUnreachableRuntime({ ANIMA_RUNTIME: "worker" })).toBe(true);
    expect(isLoopbackUnreachableRuntime({ ANIMA_RUNTIME: "cloudflare" })).toBe(true);
    expect(isLoopbackUnreachableRuntime({ ANIMA_RUNTIME: "serverless" })).toBe(true);
  });

  it("ANIMA_RUNTIME=node keeps loopback even if VERCEL is set", () => {
    expect(
      isLoopbackUnreachableRuntime({ ANIMA_RUNTIME: "node", VERCEL: "1" }),
    ).toBe(false);
  });
});

describe("isLoopbackLlmHost", () => {
  it("flags localhost / 127.0.0.1 / ::1 / 0.0.0.0", () => {
    expect(isLoopbackLlmHost("localhost")).toBe(true);
    expect(isLoopbackLlmHost("127.0.0.1")).toBe(true);
    expect(isLoopbackLlmHost("::1")).toBe(true);
    expect(isLoopbackLlmHost("[::1]")).toBe(true);
    expect(isLoopbackLlmHost("0.0.0.0")).toBe(true);
    expect(isLoopbackLlmHost("anima-chat-llm.fly.dev")).toBe(false);
  });
});

describe("localLlmBaseUrl runtime matrix", () => {
  it("Worker runtime + unset URL → null (does not invent localhost)", () => {
    clearLocalLlmEnv();
    expect(localLlmBaseUrl(process.env, workerGlobal)).toBeNull();
    expect(hasLocalLlm(process.env, workerGlobal)).toBe(false);
    const summary = summarizeLocalLlmBaseUrl(process.env, workerGlobal);
    expect(summary.configured).toBe(false);
    expect(summary.host).toBeNull();
    expect(summary.isLocalhost).toBe(false);
    expect(summary.isLoopbackMisconfigured).toBe(false);
  });

  it("ANIMA_RUNTIME=worker + unset URL → null", () => {
    clearLocalLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    expect(localLlmBaseUrl()).toBeNull();
    expect(hasLocalLlm()).toBe(false);
    expect(summarizeLocalLlmBaseUrl().configured).toBe(false);
  });

  it("Worker runtime + explicit localhost → misconfigured (not attempted)", () => {
    clearLocalLlmEnv();
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
    expect(localLlmBaseUrl(process.env, workerGlobal)).toBeNull();
    expect(hasLocalLlm(process.env, workerGlobal)).toBe(false);
    const summary = summarizeLocalLlmBaseUrl(process.env, workerGlobal);
    expect(summary.configured).toBe(false);
    expect(summary.isLocalhost).toBe(true);
    expect(summary.host).toBe("localhost");
    expect(summary.isLoopbackMisconfigured).toBe(true);
    expect(summary.hasV1Path).toBe(true);
  });

  it("Worker runtime + explicit 127.0.0.1 → misconfigured", () => {
    clearLocalLlmEnv();
    process.env.ANIMA_RUNTIME = "worker";
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://127.0.0.1:11434/v1";
    expect(localLlmBaseUrl()).toBeNull();
    expect(summarizeLocalLlmBaseUrl().isLoopbackMisconfigured).toBe(true);
    expect(summarizeLocalLlmBaseUrl().configured).toBe(false);
  });

  it("plain Node + unset → localhost default", () => {
    clearLocalLlmEnv();
    expect(localLlmBaseUrl()).toBe("http://localhost:11434/v1");
    expect(hasLocalLlm()).toBe(true);
    const summary = summarizeLocalLlmBaseUrl();
    expect(summary.configured).toBe(true);
    expect(summary.host).toBe("localhost");
    expect(summary.isLocalhost).toBe(true);
    expect(summary.isLoopbackMisconfigured).toBe(false);
    expect(summary.hasV1Path).toBe(true);
  });

  it("explicit public HTTPS URL is used as-is on every runtime", () => {
    const publicUrl = "https://anima-chat-llm.fly.dev/v1";
    clearLocalLlmEnv();
    process.env.ANIMA_LOCAL_LLM_BASE_URL = publicUrl;

    expect(localLlmBaseUrl()).toBe(publicUrl);
    expect(localLlmBaseUrl(process.env, workerGlobal)).toBe(publicUrl);
    process.env.ANIMA_RUNTIME = "worker";
    expect(localLlmBaseUrl()).toBe(publicUrl);
    process.env.VERCEL = "1";
    expect(localLlmBaseUrl()).toBe(publicUrl);

    const summary = summarizeLocalLlmBaseUrl(process.env, workerGlobal);
    expect(summary.configured).toBe(true);
    expect(summary.host).toBe("anima-chat-llm.fly.dev");
    expect(summary.isHttps).toBe(true);
    expect(summary.hasV1Path).toBe(true);
    expect(summary.isLocalhost).toBe(false);
    expect(summary.isLoopbackMisconfigured).toBe(false);
  });

  it("readExplicitLocalLlmBaseUrl does not invent localhost", () => {
    clearLocalLlmEnv();
    expect(readExplicitLocalLlmBaseUrl()).toBeNull();
    process.env.OLLAMA_BASE_URL = "http://127.0.0.1:11434";
    expect(readExplicitLocalLlmBaseUrl()).toBe("http://127.0.0.1:11434/v1");
  });
});

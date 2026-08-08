import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANIMA_BOOTSTRAP_BASE_MODEL,
  ANIMA_OLLAMA_CHAT_TAG,
  ANIMA_PRIMARY_MODEL,
  describeModel,
  listModels,
  resolveModelSpec,
  resolveProvider,
  samplingForOpenAI,
} from "../src/registry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("registry", () => {
  it("defaults unset/unrecognized providers to the self-hosted ollama default", () => {
    // Must match llmFailover.ts's defaultProviderMode() — chat should never
    // silently default to a cloud flagship provider from a typo or unset env.
    expect(resolveProvider("nope")).toBe("ollama");
    expect(resolveProvider(null)).toBe("ollama");
  });

  it("still honors an explicit openai selection", () => {
    expect(resolveProvider("openai")).toBe("openai");
  });

  it("maps custom / anima / local / local-first to ollama by default", () => {
    expect(resolveProvider("custom")).toBe("ollama");
    expect(resolveProvider("anima")).toBe("ollama");
    expect(resolveProvider("local")).toBe("ollama");
    expect(resolveProvider("local-first")).toBe("ollama");
  });

  it("maps custom to vllm when ANIMA_LOCAL_LLM_BACKEND=vllm", () => {
    vi.stubEnv("ANIMA_LOCAL_LLM_BACKEND", "vllm");
    expect(resolveProvider("custom")).toBe("vllm");
    expect(resolveProvider("anima")).toBe("vllm");
  });

  it("lists ollama bootstrap lineup as anima-chat", () => {
    const models = listModels("ollama");
    expect(models).toHaveLength(3);
    expect(ANIMA_BOOTSTRAP_BASE_MODEL).toContain("qwen");
    expect(models.find((m) => m.tier === "standard")?.model).toBe(
      ANIMA_OLLAMA_CHAT_TAG,
    );
  });

  it("lists vllm lineup with Ministral 3 8B as standard/heavy", () => {
    const models = listModels("vllm");
    expect(models).toHaveLength(3);
    expect(ANIMA_PRIMARY_MODEL).toContain("Ministral");
    expect(models.find((m) => m.tier === "standard")?.model).toBe(ANIMA_PRIMARY_MODEL);
    expect(models.find((m) => m.tier === "heavy")?.model).toBe(ANIMA_PRIMARY_MODEL);
  });

  it("honors per-provider env overrides", () => {
    vi.stubEnv("ANIMA_VLLM_MODEL_STANDARD", "my-lora-checkpoint");
    const spec = resolveModelSpec("standard", "vllm");
    expect(spec.model).toBe("my-lora-checkpoint");
    expect(samplingForOpenAI(spec).temperature).toBeGreaterThan(0);
  });

  it("describeModel includes alias", () => {
    const spec = resolveModelSpec("standard", "ollama");
    expect(describeModel(spec)).toContain("anima-base");
  });
});

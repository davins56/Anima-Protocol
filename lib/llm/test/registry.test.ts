import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
  it("defaults unrecognized providers to openai", () => {
    expect(resolveProvider("nope")).toBe("openai");
    expect(resolveProvider(null)).toBe("openai");
  });

  it("maps custom / anima / local / local-first to vllm", () => {
    expect(resolveProvider("custom")).toBe("vllm");
    expect(resolveProvider("anima")).toBe("vllm");
    expect(resolveProvider("local")).toBe("vllm");
    expect(resolveProvider("local-first")).toBe("vllm");
  });

  it("lists vllm lineup with Qwen3.6-27B as standard/heavy", () => {
    const models = listModels("vllm");
    expect(models).toHaveLength(3);
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
    const spec = resolveModelSpec("standard", "vllm");
    expect(describeModel(spec)).toContain("anima-base");
  });
});

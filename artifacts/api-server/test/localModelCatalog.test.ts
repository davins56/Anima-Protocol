import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const modelsListMock = vi.fn();

vi.mock("../src/lib/openaiClient", () => ({
  localLlmBaseUrl: () => process.env.ANIMA_LOCAL_LLM_BASE_URL?.trim() || null,
}));

import {
  chooseLocalModel,
  describeModelMismatch,
  getRememberedModel,
  listLocalModels,
  rememberModelSubstitution,
  resetLocalModelCatalogForTests,
} from "../src/lib/localModelCatalog";

type FakeClient = Parameters<typeof listLocalModels>[0];
const fakeClient = { models: { list: (...a: unknown[]) => modelsListMock(...a) } } as unknown as FakeClient;

describe("chooseLocalModel", () => {
  it("prefers an exact match", () => {
    expect(chooseLocalModel("anima-chat", ["qwen2.5:3b", "anima-chat"])).toBe("anima-chat");
  });

  it("treats Ollama's :latest suffix as the same model", () => {
    // The most common cause of the 404: the tag exists as `anima-chat:latest`
    // but the gateway in front of Ollama does not resolve the bare name.
    expect(chooseLocalModel("anima-chat", ["qwen2.5:3b", "anima-chat:latest"])).toBe("anima-chat:latest");
  });

  it("prefers an anima-branded model over an unrelated base model", () => {
    expect(chooseLocalModel("anima-chat", ["llama3.2:1b", "anima-ministral8b"])).toBe("anima-ministral8b");
  });

  it("falls back to a known open-weight chat family", () => {
    expect(chooseLocalModel("anima-chat", ["some-unknown-thing", "qwen2.5:3b"])).toBe("qwen2.5:3b");
  });

  it("recognizes the supported open-weight chat families", () => {
    expect(chooseLocalModel("anima-chat", ["google/gemma-3-4b-it"])).toBe("google/gemma-3-4b-it");
    expect(chooseLocalModel("anima-chat", ["deepseek-r1:7b"])).toBe("deepseek-r1:7b");
    expect(chooseLocalModel("anima-chat", ["meta-llama/Llama-3.1-8B-Instruct"])).toBe(
      "meta-llama/Llama-3.1-8B-Instruct",
    );
  });

  it("never picks an embedding / image / audio model", () => {
    expect(chooseLocalModel("anima-chat", ["nomic-embed-text:latest", "bge-large", "whisper"])).toBeNull();
  });

  it("returns null when the endpoint serves nothing", () => {
    expect(chooseLocalModel("anima-chat", [])).toBeNull();
  });

  it("is stable — the same lineup always resolves to the same model", () => {
    const lineup = ["qwen2.5:3b", "llama3.2:1b", "mistral:7b"];
    const first = chooseLocalModel("anima-chat", lineup);
    expect(chooseLocalModel("anima-chat", lineup)).toBe(first);
    expect(chooseLocalModel("anima-chat", lineup)).toBe(first);
  });
});

describe("listLocalModels", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
    modelsListMock.mockReset();
    resetLocalModelCatalogForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLocalModelCatalogForTests();
  });

  it("reads ids from an OpenAI-style page", async () => {
    modelsListMock.mockResolvedValueOnce({ data: [{ id: "qwen2.5:3b" }, { id: "anima-chat" }] });
    const catalog = await listLocalModels(fakeClient);
    expect(catalog.ok).toBe(true);
    expect(catalog.models).toEqual(["qwen2.5:3b", "anima-chat"]);
  });

  it("accepts a bare array from a non-conforming server", async () => {
    modelsListMock.mockResolvedValueOnce([{ id: "qwen2.5:3b" }]);
    expect((await listLocalModels(fakeClient)).models).toEqual(["qwen2.5:3b"]);
  });

  it("caches within the TTL so chat turns do not re-list every message", async () => {
    modelsListMock.mockResolvedValueOnce({ data: [{ id: "qwen2.5:3b" }] });
    await listLocalModels(fakeClient);
    const second = await listLocalModels(fakeClient);
    expect(second.cached).toBe(true);
    expect(second.models).toEqual(["qwen2.5:3b"]);
    expect(modelsListMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when the server has no /v1/models route", async () => {
    modelsListMock.mockRejectedValueOnce(new Error("404 page not found"));
    const catalog = await listLocalModels(fakeClient);
    expect(catalog.ok).toBe(false);
    expect(catalog.models).toEqual([]);
    expect(catalog.error).toMatch(/404/);
  });
});

describe("model substitution memory", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";
    resetLocalModelCatalogForTests();
  });

  afterEach(() => {
    process.env = { ...SAVED };
    resetLocalModelCatalogForTests();
  });

  it("remembers what worked, keyed by endpoint", () => {
    rememberModelSubstitution("anima-chat", "qwen2.5:3b");
    expect(getRememberedModel("anima-chat")).toBe("qwen2.5:3b");

    process.env.ANIMA_LOCAL_LLM_BASE_URL = "http://other-host:11434/v1";
    expect(getRememberedModel("anima-chat")).toBeNull();
  });

  it("does not record a no-op substitution", () => {
    rememberModelSubstitution("anima-chat", "anima-chat:latest");
    expect(getRememberedModel("anima-chat")).toBeNull();
  });
});

describe("describeModelMismatch", () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    process.env = { ...SAVED };
    process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://anima-llm.example.com/v1";
  });

  afterEach(() => {
    process.env = { ...SAVED };
  });

  it("names the host, what it serves, and the command that fixes it", () => {
    const msg = describeModelMismatch("anima-chat", ["qwen2.5:3b", "nomic-embed-text"]);
    expect(msg).toContain("anima-llm.example.com");
    expect(msg).toContain("qwen2.5:3b");
    expect(msg).toContain("ollama create anima-chat");
    expect(msg).toContain("ANIMA_OLLAMA_MODEL_LIGHT/_STANDARD/_HEAVY");
  });

  it("points at the host being empty when it lists nothing", () => {
    expect(describeModelMismatch("anima-chat", [])).toMatch(/reported no models at all/i);
  });
});

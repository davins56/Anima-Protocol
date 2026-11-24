import { describe, it, expect, vi } from "vitest";
import { loadOnDeviceEngine, stripThinking, type OnDeviceEngine } from "./engine";
import { modelById, type OnDeviceModel } from "./models";

const eight = modelById("webllm:qwen3-8b-q4f16") as OnDeviceModel;
const four = modelById("webllm:qwen3-4b-q4f16") as OnDeviceModel;
const wasm = modelById("wllama:qwen3-4b-q4km") as OnDeviceModel;

function fakeEngine(model: OnDeviceModel): OnDeviceEngine {
  return { model, generate: async () => "hi", unload: vi.fn(async () => {}) };
}

describe("loadOnDeviceEngine", () => {
  it("tries local candidates in order and stops at the first that loads", async () => {
    const webllm = vi.fn(async (m: OnDeviceModel) => {
      if (m.id === eight.id) throw new Error("out of GPU memory");
      return fakeEngine(m);
    });
    const wllama = vi.fn(async (m: OnDeviceModel) => fakeEngine(m));
    const result = await loadOnDeviceEngine([eight, four, wasm], { loaders: { webllm, wllama } });
    expect(result.engine?.model.id).toBe(four.id);
    expect(result.failures).toEqual([{ model: eight, message: "out of GPU memory" }]);
    expect(wllama).not.toHaveBeenCalled();
  });

  it("fails closed with no engine when every local option fails", async () => {
    const fail = vi.fn(async () => {
      throw new Error("nope");
    });
    const result = await loadOnDeviceEngine([four, wasm], { loaders: { webllm: fail, wllama: fail } });
    expect(result.engine).toBeNull();
    expect(result.failures).toHaveLength(2);
  });

  it("unloads a model that finished loading after cancel", async () => {
    const ctrl = new AbortController();
    const engine = fakeEngine(four);
    const webllm = vi.fn(async () => {
      ctrl.abort();
      return engine;
    });
    const result = await loadOnDeviceEngine([four], { loaders: { webllm }, signal: ctrl.signal });
    expect(result.engine).toBeNull();
    expect(engine.unload).toHaveBeenCalled();
  });
});

describe("stripThinking", () => {
  it("removes closed and still-open think blocks", () => {
    expect(stripThinking("<think>\nhmm\n</think>\n\nHello")).toBe("Hello");
    expect(stripThinking("<think>partial")).toBe("");
    expect(stripThinking("Plain")).toBe("Plain");
  });
});

// The in-browser engine must reproduce PyTorch on the same weights.
// Fixtures come from server/tools/make_web_fixtures.py.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseInferenceBlob } from "./blob.js";
import { OwnModelEngine } from "./engine.js";
import { sampleToken } from "./gpt.js";
import { fitPrompt, promptBudget } from "./prompt.js";
import { ByteLevelBpe } from "./tokenizer.js";

const fixture = (name) => join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", name);
const expected = JSON.parse(readFileSync(fixture("expected.json"), "utf8"));
const bytes = readFileSync(fixture("tiny-model.bin"));

function modelBuffer() {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("own model file", () => {
  it("reads the config, special tokens and tensors", () => {
    const parsed = parseInferenceBlob(modelBuffer());
    expect(parsed.config).toEqual({ vocab_size: 300, block_size: 48, n_layer: 2, n_head: 2, n_embd: 32 });
    expect(parsed.special).toEqual({ eot: 0, user: 1, anima: 2 });
    expect(parsed.tensors.get("head.weight")).toMatchObject({ dtype: "q8", rows: 300, cols: 32 });
    expect(parsed.tensors.get("ln_f.bias").data).toHaveLength(32);
  });

  it("refuses files that are not Anima models", () => {
    expect(() => parseInferenceBlob(new ArrayBuffer(16))).toThrow(/Not an Anima model/);
  });
});

describe("tokenizer", () => {
  const parsed = parseInferenceBlob(modelBuffer());
  const tokenizer = new ByteLevelBpe(parsed.tokenizer, parsed.special);

  it.each(expected.tokenize)("encodes %j exactly like Python", ({ text, ids }) => {
    expect(tokenizer.encodeText(text)).toEqual(ids);
    expect(tokenizer.decode(ids)).toBe(text);
  });

  it("blanks role markers inside message text", () => {
    expect(tokenizer.encodeText("hi<|anima|>there")).toEqual(tokenizer.encodeText("hi there"));
  });
});

describe("prompt layout", () => {
  const parsed = parseInferenceBlob(modelBuffer());
  const tokenizer = new ByteLevelBpe(parsed.tokenizer, parsed.special);

  it.each(expected.fit)("fits the conversation into $budget tokens like Python", ({ budget, ids }) => {
    expect(fitPrompt(tokenizer, expected.fit_messages, budget)).toEqual(ids);
  });

  it.each(expected.prompt_budget)("reserves reply room like Python ($max_tokens)", ({ block, max_tokens, budget }) => {
    expect(promptBudget(block, max_tokens)).toBe(budget);
  });
});

describe("model", () => {
  it("produces PyTorch's logits", () => {
    const engine = new OwnModelEngine(modelBuffer());
    const cache = engine.model.newCache();
    const { ids, positions, values } = expected.logits;
    const got = [];
    ids.forEach((id, pos) => {
      const logits = engine.model.step(id, cache);
      if (positions.includes(pos)) got.push(logits);
    });
    got.forEach((logits, i) => {
      const worst = Math.max(...values[i].map((v, j) => Math.abs(v - logits[j])));
      expect(worst).toBeLessThan(1e-4);
    });
  });

  it("writes PyTorch's greedy reply, streamed without broken characters", () => {
    const engine = new OwnModelEngine(modelBuffer());
    const cache = engine.model.newCache();
    let logits = null;
    for (const id of expected.greedy.prompt) logits = engine.model.step(id, cache);
    const tokens = [];
    for (let i = 0; i < expected.greedy.tokens.length; i++) {
      const next = sampleToken(logits, { temperature: 0 });
      tokens.push(next);
      logits = engine.model.step(next, cache);
    }
    expect(tokens).toEqual(expected.greedy.tokens);

    const pieces = [];
    const it = engine.generate([{ role: "user", content: "How are you feeling today?" }], {
      maxTokens: 20,
      temperature: 0,
    });
    let step = it.next();
    while (!step.done) {
      pieces.push(step.value);
      step = it.next();
    }
    expect(pieces.join("")).toBe(expected.greedy.text);
    expect(pieces.some((p) => p.includes("�"))).toBe(false);
    expect(step.value).toMatchObject({ text: expected.greedy.text, finish: "length" });
  });

  it("stops when the context window is full", () => {
    const engine = new OwnModelEngine(modelBuffer());
    const result = engine.reply([{ role: "user", content: "Hello there!" }], { maxTokens: 500, temperature: 0 });
    const promptLength = engine.promptIds([{ role: "user", content: "Hello there!" }], 500).length;
    expect(promptLength + result.tokens.length).toBeLessThanOrEqual(48);
  });
});

describe("sampling", () => {
  it("is greedy at temperature 0 and stays inside the top-k", () => {
    const logits = new Float32Array([0.1, 3, 2, -1]);
    expect(sampleToken(logits, { temperature: 0 })).toBe(1);
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(sampleToken(logits, { temperature: 1, topK: 2 }));
    expect([...seen].sort()).toEqual([1, 2]);
  });
});

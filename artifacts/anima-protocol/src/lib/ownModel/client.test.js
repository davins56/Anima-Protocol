import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const modelApi = vi.hoisted(() => ({ config: vi.fn(), chunk: vi.fn(), autoLesson: vi.fn() }));
vi.mock("@/api/animaApi", () => ({ animaApi: { model: modelApi } }));

import { OwnModelEngine } from "./engine.js";
import {
  OwnModelRunner,
  downloadModel,
  ownModelHistory,
  resetOwnModelForTests,
} from "./client.js";
import {
  loadOwnModelConfig,
  queueOwnModelLesson,
  clearOwnModelConfig,
  writeOwnModelReply,
} from "./chat.js";

const bytes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "tiny-model.bin"));
const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const CHUNK = 16 * 1024;

function published(version = 3, overrides = {}) {
  return {
    version,
    chunk_bytes: CHUNK,
    inference: {
      bytes: bytes.length,
      chunks: Math.ceil(bytes.length / CHUNK),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    ...overrides,
  };
}

async function serveChunk(_version, idx) {
  // Out of order on purpose: the download must still assemble in order.
  await new Promise((resolve) => setTimeout(resolve, (7 - idx) % 3));
  return buffer().slice(idx * CHUNK, (idx + 1) * CHUNK);
}

beforeEach(() => {
  resetOwnModelForTests();
  clearOwnModelConfig();
  modelApi.config.mockReset();
  modelApi.chunk.mockReset().mockImplementation(serveChunk);
  modelApi.autoLesson.mockReset().mockResolvedValue({ queued: true });
});

afterEach(() => resetOwnModelForTests());

describe("history", () => {
  it("keeps plain user and assistant turns, newest last", () => {
    const history = ownModelHistory([
      { role: "user", content: " Hi " },
      { role: "assistant", content: "Hello!", character_name: "Aria" },
      { role: "assistant", type: "event", content: "calm" },
      { role: "assistant", content: "...", character_name: "__typing__" },
      { role: "assistant", content: "partial", is_streaming: true },
      { role: "system", content: "hidden" },
      { role: "user", content: "How are you?" },
    ]);
    expect(history).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ]);
    expect(ownModelHistory(Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `m${i}` })))).toHaveLength(12);
  });
});

describe("download", () => {
  it("assembles the chunks in order and checks size and checksum", async () => {
    const progress = [];
    const got = await downloadModel(published(), serveChunk, { onProgress: (p) => progress.push(p) });
    expect(Buffer.from(got).equals(bytes)).toBe(true);
    expect(progress.at(-1)).toBe(1);
  });

  it("refuses a short or corrupted download", async () => {
    await expect(downloadModel(published(3, { inference: { ...published().inference, bytes: bytes.length + 1 } }), serveChunk)).rejects.toThrow(/incomplete/);
    await expect(downloadModel(published(3, { inference: { ...published().inference, sha256: "0".repeat(64) } }), serveChunk)).rejects.toThrow(/corrupted/);
  });
});

describe("runner", () => {
  it("writes what the engine writes, streaming the reply so far", async () => {
    const runner = new OwnModelRunner({ useWorker: false });
    await runner.load(buffer(), 3);
    const seen = [];
    const messages = [{ role: "user", content: "How are you feeling today?" }];
    const result = await runner.generate(messages, { maxTokens: 20, temperature: 0, onDelta: (t) => seen.push(t) });
    const expected = new OwnModelEngine(buffer()).reply(messages, { maxTokens: 20, temperature: 0 });
    expect(result.text).toBe(expected.text);
    expect(seen.at(-1)).toBe(expected.text);
    expect(seen.every((t, i) => i === 0 || t.startsWith(seen[i - 1]))).toBe(true);
  });
});

describe("chat", () => {
  it("leaves the turn to Anima when the own model doesn't answer this account", async () => {
    modelApi.config.mockResolvedValue({ enabled: false, model: null });
    expect(await writeOwnModelReply({ messages: [{ role: "user", content: "Hi" }] })).toBeNull();
    expect(modelApi.chunk).not.toHaveBeenCalled();

    clearOwnModelConfig();
    modelApi.config.mockRejectedValue(new Error("offline"));
    expect(await loadOwnModelConfig()).toBeNull();
  });

  it("downloads the model once and writes the reply on the device", async () => {
    modelApi.config.mockResolvedValue({ enabled: true, learning: true, model: published(5) });
    const deltas = [];
    const loading = vi.fn();
    const first = await writeOwnModelReply({
      messages: [{ role: "user", content: "Hello there!" }],
      onDelta: (t) => deltas.push(t),
      onLoading: loading,
    });
    expect(first).toMatchObject({ version: 5, learning: true });
    expect(typeof first.reply).toBe("string");
    expect(deltas.at(-1) ?? "").toBe(first.reply);
    const downloads = modelApi.chunk.mock.calls.length;
    expect(downloads).toBe(published().inference.chunks);

    await writeOwnModelReply({ messages: [{ role: "user", content: "Again" }] });
    expect(modelApi.chunk.mock.calls.length).toBe(downloads);
  });

  it("looks for the newer version when the old one is gone", async () => {
    modelApi.config
      .mockResolvedValueOnce({ enabled: true, model: published(5) })
      .mockResolvedValueOnce({ enabled: true, model: published(6) });
    modelApi.chunk.mockImplementation(async (version, idx) => {
      if (version === 5) throw Object.assign(new Error("gone"), { status: 404 });
      return serveChunk(version, idx);
    });
    expect(await writeOwnModelReply({ messages: [{ role: "user", content: "Hi" }] })).toMatchObject({ version: 6 });
  });

  it("asks for an automatic lesson with the conversation it answered", () => {
    queueOwnModelLesson({ turnId: "turn_abc12345", messages: [{ role: "user", content: "Hi" }] });
    queueOwnModelLesson({ turnId: null, messages: [] });
    expect(modelApi.autoLesson).toHaveBeenCalledTimes(1);
    expect(modelApi.autoLesson).toHaveBeenCalledWith({
      turnId: "turn_abc12345",
      context: [{ role: "user", content: "Hi" }],
    });
  });
});

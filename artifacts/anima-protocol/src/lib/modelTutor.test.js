import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  UPLOAD_CHUNK_BYTES,
  parseModelBundle,
  uploadModelBundle,
  TEACH_CONTEXT_TURNS,
  buildTeachTarget,
  describeLearning,
  isOwnModelReply,
  lessonStatusLabel,
  teachableContext,
  describeTrainer,
  wordChancePercent,
} from "./modelTutor";

const messages = [
  { id: "t1:user", role: "user", content: "I had a rough day." },
  { id: "t1:event", role: "assistant", type: "event", content: "rain" },
  { id: "t1:assistant", role: "assistant", content: "The day number 1746 was kind.", llm_brand: "own" },
  { role: "assistant", content: "...", character_name: "__typing__" },
  { id: "t2:user", role: "user", content: "  Can you just listen?  " },
  { id: "t2:assistant", role: "assistant", content: "Stars stars.", llm_brand: "own", character_name: "Serenity" },
];

describe("teachableContext", () => {
  it("keeps the user/assistant turns before the reply, without events or typing", () => {
    expect(teachableContext(messages, 5)).toEqual([
      { role: "user", content: "I had a rough day." },
      { role: "assistant", content: "The day number 1746 was kind." },
      { role: "user", content: "Can you just listen?" },
    ]);
  });

  it("caps how much history a lesson carries", () => {
    const long = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      content: `turn ${i}`,
    }));
    const context = teachableContext(long, 40);
    expect(context).toHaveLength(TEACH_CONTEXT_TURNS);
    expect(context.at(-1).content).toBe("turn 39");
  });
});

describe("buildTeachTarget", () => {
  it("describes the reply being corrected", () => {
    expect(buildTeachTarget({ session: { id: "s1" }, messages, index: 5 })).toEqual({
      session_id: "s1",
      message_id: "t2:assistant",
      part: null,
      context: teachableContext(messages, 5),
      rejected: "Stars stars.",
      source_brand: "own",
      character_name: "Serenity",
    });
  });

  it("targets one speaker inside a split group reply", () => {
    const target = buildTeachTarget({
      session: { id: "s1" },
      messages,
      index: 5,
      subMessage: { role: "assistant", content: "Korra's line", character_name: "Korra" },
      part: 1,
    });
    expect(target).toMatchObject({
      message_id: "t2:assistant",
      part: 1,
      rejected: "Korra's line",
      source_brand: "own",
    });
  });

  it("never targets user messages or typing bubbles", () => {
    expect(buildTeachTarget({ messages, index: 0 })).toBeNull();
    expect(buildTeachTarget({ messages, index: 3 })).toBeNull();
  });
});

describe("labels", () => {
  it("marks own-model replies", () => {
    expect(isOwnModelReply(messages[2])).toBe(true);
    expect(isOwnModelReply({ llm_brand: "anima" })).toBe(false);
  });

  it("reads lesson status and learning in plain words", () => {
    expect(lessonStatusLabel({ status: "learned" })).toBe("Learned");
    expect(lessonStatusLabel({ status: "saved" })).toBe("Waiting to learn");
    expect(lessonStatusLabel({ status: "failed", attempts: 1 })).toBe("Retrying");
    expect(lessonStatusLabel({ status: "failed", attempts: 3 })).toBe("Didn't take");
    expect(wordChancePercent(0)).toBe(100);
    expect(wordChancePercent(Math.log(2))).toBe(50);
    expect(wordChancePercent(null)).toBeNull();
    expect(describeLearning({ loss_before: 5.25, loss_after: 0.31 })).toBe("0.52% → 73% per word");
    expect(describeLearning({ status: "saved" })).toBeNull();
  });
});

describe("trainer status", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  it("says what the trainer did last", () => {
    expect(describeTrainer({}, now)).toContain("hasn't run yet");
    expect(
      describeTrainer(
        {
          last_run: { status: "ok", at: "2026-09-28T11:50:00Z", message: "Learned 2 lesson(s)." },
          checked_at: "2026-09-28T11:58:00Z",
        },
        now,
      ),
    ).toBe("Last run 10 min ago: Learned 2 lesson(s). Checked for lessons 2 min ago.");
    expect(describeTrainer({ last_run: { status: "running", at: "2026-09-28T11:59:50Z" } }, now)).toBe(
      "Learning now (started just now).",
    );
  });
});

describe("model file upload", () => {
  const inference = new Uint8Array(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "ownModel", "__fixtures__", "tiny-model.bin")),
  );
  const master = new Uint8Array(1_200_000).map((_, i) => i & 0xff);
  const sha = (data) => createHash("sha256").update(data).digest("hex");

  function bundle({ corrupt = false } = {}) {
    const header = new TextEncoder().encode(
      JSON.stringify({
        format: "anima-model-1",
        config: { vocab_size: 300, block_size: 48, n_layer: 2, n_head: 2, n_embd: 32 },
        parts: [
          { name: "inference", bytes: inference.length, sha256: sha(inference) },
          { name: "master", bytes: master.length, sha256: corrupt ? "0".repeat(64) : sha(master) },
        ],
      }),
    );
    const out = new Uint8Array(12 + header.length + inference.length + master.length);
    out.set(new TextEncoder().encode("ANIMAMDL"));
    new DataView(out.buffer).setUint32(8, header.length, true);
    out.set(header, 12);
    out.set(inference, 12 + header.length);
    out.set(master, 12 + header.length + inference.length);
    return out.buffer;
  }

  it("reads a model file and refuses anything else", async () => {
    const parsed = await parseModelBundle(bundle());
    expect(parsed.config.block_size).toBe(48);
    expect(parsed.inference.data.byteLength).toBe(inference.length);
    expect(parsed.master.sha256).toBe(sha(master));
    await expect(parseModelBundle(new ArrayBuffer(64))).rejects.toThrow(/isn't an Anima model/);
    await expect(parseModelBundle(bundle({ corrupt: true }))).rejects.toThrow(/damaged/);
  });

  it("uploads both parts in chunks, retrying a flaky one, then publishes", async () => {
    const parsed = await parseModelBundle(bundle());
    const received = { inference: [], master: [] };
    let flaked = false;
    const api = {
      startUpload: vi.fn().mockResolvedValue({ version: 9, chunk_bytes: UPLOAD_CHUNK_BYTES }),
      uploadChunk: vi.fn(async (version, kind, idx, chunk) => {
        if (kind === "master" && idx === 1 && !flaked) {
          flaked = true;
          throw Object.assign(new Error("bad gateway"), { status: 502 });
        }
        received[kind][idx] = new Uint8Array(chunk);
        return { ok: true };
      }),
      finishUpload: vi.fn().mockResolvedValue({ version: 9 }),
      cancelUpload: vi.fn().mockResolvedValue({}),
    };
    const progress = [];
    const done = await uploadModelBundle(api, parsed, { onProgress: (p) => progress.push(p) });
    expect(done).toEqual({ version: 9 });
    expect(api.startUpload).toHaveBeenCalledWith({
      config: parsed.config,
      inference: { bytes: inference.length, sha256: sha(inference) },
      master: { bytes: master.length },
    });
    const join = (parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
    expect(join(received.inference).equals(Buffer.from(inference))).toBe(true);
    expect(join(received.master).equals(Buffer.from(master))).toBe(true);
    expect(received.master).toHaveLength(3);
    expect(progress.at(-1)).toBe(1);
    expect(api.cancelUpload).not.toHaveBeenCalled();
  });

  it("cancels the upload when a chunk is refused", async () => {
    const parsed = await parseModelBundle(bundle());
    const api = {
      startUpload: vi.fn().mockResolvedValue({ version: 9, chunk_bytes: UPLOAD_CHUNK_BYTES }),
      uploadChunk: vi.fn().mockRejectedValue(Object.assign(new Error("Bad chunk"), { status: 400 })),
      finishUpload: vi.fn(),
      cancelUpload: vi.fn().mockResolvedValue({}),
    };
    await expect(uploadModelBundle(api, parsed)).rejects.toThrow("Bad chunk");
    expect(api.uploadChunk).toHaveBeenCalledTimes(1);
    expect(api.cancelUpload).toHaveBeenCalledWith(9);
    expect(api.finishUpload).not.toHaveBeenCalled();
  });
});

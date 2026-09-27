import { describe, expect, it, vi } from "vitest";
import {
  TEACH_CONTEXT_TURNS,
  buildTeachTarget,
  describeLearning,
  isOwnModelReply,
  lessonStatusLabel,
  teachableContext,
  waitForLesson,
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
    expect(wordChancePercent(0)).toBe(100);
    expect(wordChancePercent(Math.log(2))).toBe(50);
    expect(wordChancePercent(null)).toBeNull();
    expect(describeLearning({ loss_before: 5.25, loss_after: 0.31 })).toBe("0.52% → 73% per word");
    expect(describeLearning({ status: "saved" })).toBeNull();
  });
});

describe("waitForLesson", () => {
  it("polls a learning job until the lesson settles", async () => {
    const api = {
      job: vi
        .fn()
        .mockResolvedValueOnce({ job: { status: "running" }, lesson: { id: "l1", status: "learning", job_id: "j1" } })
        .mockResolvedValueOnce({ job: { status: "done" }, lesson: { id: "l1", status: "learned", version: 5 } }),
    };
    const settled = await waitForLesson(api, { id: "l1", status: "learning", job_id: "j1" }, {
      sleep: async () => {},
    });
    expect(settled).toMatchObject({ status: "learned", version: 5 });
    expect(api.job).toHaveBeenCalledWith("j1", { lessonId: "l1" });
  });

  it("returns a failed job as a failed lesson", async () => {
    const api = { job: vi.fn().mockResolvedValue({ job: { status: "failed", error: "oom" }, lesson: null }) };
    const settled = await waitForLesson(api, { id: "l1", status: "learning", job_id: "j1" }, {
      sleep: async () => {},
    });
    expect(settled).toMatchObject({ status: "failed", error: "oom" });
  });
});

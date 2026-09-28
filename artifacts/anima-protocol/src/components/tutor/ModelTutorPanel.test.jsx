import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const statusMock = vi.fn();
vi.mock("@/api/animaApi", () => ({
  animaApi: { tutor: { status: (...args) => statusMock(...args) } },
}));

import ModelTutorPanel from "./ModelTutorPanel";
import { resetModelTutorCacheForTests } from "@/hooks/useModelTutor";
import { toast } from "sonner";

const connected = {
  isSteward: true,
  model: {
    published: true,
    base_version: 3,
    current_version: 4,
    config: { vocab_size: 4096, block_size: 256, n_layer: 6, n_head: 6, n_embd: 384 },
    versions: [
      { version: 4, kind: "learned", bytes: 40_700_000, lessons: 1 },
      { version: 3, kind: "base", bytes: 40_700_000, lessons: 0 },
    ],
  },
  settings: { answer_everyone: false, always_learning: true, learn_from_opted_in: false },
  trainer: {
    last_run: { status: "ok", at: new Date(Date.now() - 5 * 60_000).toISOString(), message: "Learned 1 lesson(s)." },
    checked_at: new Date().toISOString(),
    dispatch_configured: true,
    relearn_pending: false,
  },
  lessons: { total: 2, pending: 1, learned: 1, failed: 0, auto: 1, auto_pending: 0 },
  advice_total: 1,
  preferences: { own_model_chat: false, share_for_training: false },
};

const empty = {
  ...connected,
  model: { published: false, base_version: null, current_version: null, config: null, versions: [] },
  settings: { answer_everyone: false, always_learning: false, learn_from_opted_in: false },
  trainer: { last_run: null, checked_at: null, dispatch_configured: false, relearn_pending: false },
  lessons: { total: 0, pending: 0, learned: 0, failed: 0, auto: 0, auto_pending: 0 },
};

function makeApi(overrides = {}) {
  return {
    lessons: vi.fn().mockResolvedValue({
      lessons: [
        { id: "l1", chosen: "I'm here.", note: "Listen first.", status: "learned", source: "manual", loss_before: 5.25, loss_after: 0.31, after_reply: "I'm here for you.", created_date: "2026-09-27T10:00:00Z" },
        { id: "l2", chosen: "Hello again.", status: "failed", attempts: 3, source: "auto" },
      ],
    }),
    advice: vi.fn().mockResolvedValue({ advice: [{ id: "a1", text: "Ask a follow-up question." }] }),
    setOwnModelChat: vi.fn().mockResolvedValue({ preferences: { own_model_chat: true } }),
    setSettings: vi.fn().mockResolvedValue({ settings: {} }),
    addAdvice: vi.fn().mockResolvedValue({ advice: { id: "a2", text: "Be playful." } }),
    removeAdvice: vi.fn().mockResolvedValue({ deleted: true }),
    forget: vi.fn().mockResolvedValue({ deleted: true, relearning: true }),
    retry: vi.fn().mockResolvedValue({ lesson: {} }),
    sync: vi.fn().mockResolvedValue({ relearning: true }),
    learnNow: vi.fn().mockResolvedValue({ trainer_started: true }),
    exportLessons: vi.fn().mockResolvedValue(""),
    startUpload: vi.fn(),
    uploadChunk: vi.fn(),
    finishUpload: vi.fn(),
    cancelUpload: vi.fn(),
    ...overrides,
  };
}

async function render(api) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ModelTutorPanel api={api} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return root;
}

function byText(text) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

describe("ModelTutorPanel", () => {
  beforeEach(() => {
    resetModelTutorCacheForTests();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("tells non-stewards the tutor is not theirs", async () => {
    statusMock.mockResolvedValue({ isSteward: false });
    const api = makeApi();
    await render(api);
    expect(document.body.textContent).toContain("Only the Protocol steward can teach the model.");
    expect(api.lessons).not.toHaveBeenCalled();
  });

  it("shows the live model, the trainer, lessons and advice", async () => {
    statusMock.mockResolvedValue(connected);
    await render(makeApi());
    const text = document.body.textContent;
    expect(text).toContain("Live · version 4 (learned on top of v3) · 6 layers · 256-token memory · 40.7 MB");
    expect(text).toContain("Last run 5 min ago: Learned 1 lesson(s).");
    expect(text).toContain("1 learned · 1 waiting · 0 didn't take · 1 automatic");
    expect(text).toContain("Ask a follow-up question.");
    expect(text).toContain("Now says: I'm here for you.");
    expect(text).toContain("0.52% → 73% per word");
    expect(text).toContain("Didn't take");
    expect(text).toContain("Automatic");
  });

  it("flips the steward's own switch and the global ones", async () => {
    statusMock.mockResolvedValue(connected);
    const api = makeApi();
    await render(api);
    const toggle = (label) => document.body.querySelector(`input[aria-label="${label}"]`);
    expect(toggle("Answer my chats with my model").checked).toBe(false);
    await act(async () => toggle("Answer my chats with my model").click());
    expect(api.setOwnModelChat).toHaveBeenCalledWith(true);
    expect(toast.success).toHaveBeenCalledWith("Your chats now go to your model.");

    await act(async () => toggle("Answer everyone's chats").click());
    expect(api.setSettings).toHaveBeenCalledWith({ answer_everyone: true });
    expect(toggle("Always learning").checked).toBe(true);
    await act(async () => toggle("Also learn from people who opt in").click());
    expect(api.setSettings).toHaveBeenCalledWith({ learn_from_opted_in: true });
  });

  it("starts the trainer, relearns, retries, deletes and adds advice", async () => {
    statusMock.mockResolvedValue(connected);
    const api = makeApi();
    await render(api);
    await act(async () => byText("Learn now").click());
    expect(api.learnNow).toHaveBeenCalled();
    await act(async () => byText("Relearn everything").click());
    expect(api.sync).toHaveBeenCalled();
    await act(async () => document.body.querySelector('button[aria-label="Try this lesson again"]').click());
    expect(api.retry).toHaveBeenCalledWith("l2");
    await act(async () => document.body.querySelector('button[aria-label="Delete lesson"]').click());
    expect(api.forget).toHaveBeenCalledWith("l1");
    expect(toast.success).toHaveBeenCalledWith("Lesson deleted. Your model forgets it on its next run.");

    const input = document.body.querySelector('input[aria-label="New advice"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Be playful.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => byText("Add").click());
    expect(api.addAdvice).toHaveBeenCalledWith("Be playful.");
  });

  it("explains how to get started before a model is uploaded", async () => {
    statusMock.mockResolvedValue(empty);
    await render(makeApi({ lessons: vi.fn().mockResolvedValue({ lessons: [] }) }));
    const text = document.body.textContent;
    expect(text).toContain("No model uploaded yet.");
    expect(text).toContain("The trainer hasn't run yet.");
    expect(document.body.querySelector('input[aria-label="Answer my chats with my model"]').disabled).toBe(true);
    expect(document.body.querySelector(`input[aria-label="Answer everyone's chats"]`).disabled).toBe(true);
    expect(document.body.querySelector('input[aria-label="Also learn from people who opt in"]').disabled).toBe(true);
    expect(byText("Learn now").disabled).toBe(true);
    expect(byText("Relearn everything").disabled).toBe(true);
    expect(byText("Upload model")).toBeTruthy();
  });

  it("refuses a file that isn't a model without uploading anything", async () => {
    statusMock.mockResolvedValue(empty);
    const api = makeApi();
    await render(api);
    const input = document.body.querySelector('input[aria-label="Model file"]');
    const file = new File([new Uint8Array(64)], "notes.bin");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(64) });
    await act(async () => {
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api.startUpload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("isn't an Anima model file"));
  });
});

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
  configured: true,
  reachable: true,
  error: null,
  lessons_total: 2,
  advice_total: 1,
  needs_sync: true,
  preferences: { own_model_chat: false },
  model: {
    version: 4,
    params: 13_400_000,
    block_size: 256,
    device: "cpu",
    lessons_learned: 1,
    training: false,
    can_rollback: true,
  },
};

function makeApi(overrides = {}) {
  return {
    lessons: vi.fn().mockResolvedValue({
      lessons: [
        { id: "l1", chosen: "I'm here.", note: "Listen first.", status: "learned", loss_before: 5.25, loss_after: 0.31, created_date: "2026-09-27T10:00:00Z" },
        { id: "l2", chosen: "Hello again.", status: "saved" },
      ],
    }),
    advice: vi.fn().mockResolvedValue({ advice: [{ id: "a1", text: "Ask a follow-up question." }] }),
    setOwnModelChat: vi.fn().mockResolvedValue({ preferences: { own_model_chat: true } }),
    addAdvice: vi.fn().mockResolvedValue({ advice: { id: "a2", text: "Be playful." } }),
    removeAdvice: vi.fn().mockResolvedValue({ deleted: true }),
    forget: vi.fn().mockResolvedValue({ deleted: true, needs_sync: true }),
    sync: vi.fn().mockResolvedValue({ lessons: 2 }),
    rollback: vi.fn().mockResolvedValue({ job: { status: "done" } }),
    exportLessons: vi.fn().mockResolvedValue(""),
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

  it("shows the connected model, its lessons, advice, and what needs relearning", async () => {
    statusMock.mockResolvedValue(connected);
    await render(makeApi());
    const text = document.body.textContent;
    expect(text).toContain("Connected · version 4 · 13.4M parameters · 256-token memory · cpu");
    expect(text).toContain("1 of 2 lessons learned");
    expect(text).toContain("doesn't know 1 of your lessons yet");
    expect(text).toContain("Ask a follow-up question.");
    expect(text).toContain("I'm here.");
    expect(text).toContain("0.52% → 73% per word");
    expect(text).toContain("Waiting to learn");
  });

  it("switches the steward's chats to their model", async () => {
    statusMock.mockResolvedValue(connected);
    const api = makeApi();
    await render(api);
    const toggle = document.body.querySelector('input[role="switch"]');
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(api.setOwnModelChat).toHaveBeenCalledWith(true);
    expect(toast.success).toHaveBeenCalledWith("Your chats now go to your model.");
  });

  it("relearns, undoes, and adds advice", async () => {
    statusMock.mockResolvedValue(connected);
    const api = makeApi();
    await render(api);
    await act(async () => byText("Re-teach all lessons").click());
    expect(api.sync).toHaveBeenCalled();
    await act(async () => byText("Undo last lesson").click());
    expect(api.rollback).toHaveBeenCalled();

    const input = document.body.querySelector('input[aria-label="New advice"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "Be playful.");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => byText("Add").click());
    expect(api.addAdvice).toHaveBeenCalledWith("Be playful.");
  });

  it("explains how to connect a model that is not configured", async () => {
    statusMock.mockResolvedValue({
      ...connected,
      configured: false,
      reachable: false,
      model: null,
      needs_sync: false,
      error: "Your own model is not connected.",
    });
    await render(makeApi());
    expect(document.body.textContent).toContain("Not connected. Your own model is not connected.");
    expect(document.body.querySelector('input[role="switch"]').disabled).toBe(true);
    expect(byText("Re-teach all lessons").disabled).toBe(true);
  });
});

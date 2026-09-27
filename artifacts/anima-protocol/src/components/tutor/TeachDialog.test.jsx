import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import TeachDialog from "./TeachDialog";
import { track } from "@/lib/analytics";

const target = {
  session_id: "s1",
  message_id: "t2:assistant",
  part: null,
  context: [{ role: "user", content: "Can you just listen?" }],
  rejected: "Stars stars.",
  source_brand: "own",
  character_name: "Serenity",
};

function setValue(element, value) {
  const proto = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function byText(text) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function render(api, onClose = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TeachDialog target={target} onClose={onClose} api={api} />);
  });
  return { root, onClose };
}

describe("TeachDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("shows the reply being corrected", () => {
    render({});
    expect(document.body.textContent).toContain("Teach your model");
    expect(document.body.textContent).toContain("Stars stars.");
    expect(byText("Teach").disabled).toBe(true);
  });

  it("drafts a better reply from the note, then teaches it and shows what it learned", async () => {
    const api = {
      draft: vi.fn().mockResolvedValue({ draft: "I'm here. What happened?" }),
      teach: vi.fn().mockResolvedValue({
        lesson: {
          id: "lsn_1",
          status: "learned",
          version: 4,
          steps: 14,
          loss_before: 5.25,
          loss_after: 0.31,
          after_reply: "I'm here. What happened?",
        },
      }),
    };
    render(api);
    const note = document.body.querySelector("textarea");
    await act(async () => setValue(note, "Listen first."));
    await act(async () => byText("Draft with Anima").click());
    await flush();
    expect(api.draft).toHaveBeenCalledWith({
      context: target.context,
      rejected: "Stars stars.",
      note: "Listen first.",
    });
    const chosen = document.body.querySelector('textarea[aria-label="What it should have said"]');
    expect(chosen.value).toBe("I'm here. What happened?");

    await act(async () => byText("Teach").click());
    await flush();
    expect(api.teach).toHaveBeenCalledWith({
      session_id: "s1",
      message_id: "t2:assistant",
      part: null,
      context: target.context,
      rejected: "Stars stars.",
      chosen: "I'm here. What happened?",
      note: "Listen first.",
      source_brand: "own",
    });
    expect(track).toHaveBeenCalledWith("model_lesson_taught", {
      has_note: true,
      is_drafted: true,
      is_own_model_reply: true,
      is_learned: true,
    });
    const result = document.body.querySelector('[data-testid="teach-result"]');
    expect(result.textContent).toContain("Learned — now on version 4");
    expect(result.textContent).toContain("0.52% → 73% per word");
    expect(result.textContent).toContain("it now says");
  });

  it("explains when the lesson is saved but the model is offline", async () => {
    const api = {
      teach: vi.fn().mockResolvedValue({
        lesson: { id: "lsn_1", status: "saved", error: "Your own model isn't reachable right now." },
      }),
    };
    render(api);
    const chosen = document.body.querySelector('textarea[aria-label="What it should have said"]');
    await act(async () => setValue(chosen, "Hello."));
    await act(async () => byText("Teach").click());
    await flush();
    expect(document.body.textContent).toContain("Saved, but not learned yet");
    expect(track).toHaveBeenCalledWith("model_lesson_taught", expect.objectContaining({ is_learned: false }));
  });

  it("shows the API's reason when teaching fails", async () => {
    const err = Object.assign(new Error("Forbidden"), { payload: { error: "Only the Protocol steward can teach the model." } });
    const api = { teach: vi.fn().mockRejectedValue(err) };
    render(api);
    const chosen = document.body.querySelector('textarea[aria-label="What it should have said"]');
    await act(async () => setValue(chosen, "Hello."));
    await act(async () => byText("Teach").click());
    await flush();
    expect(document.body.textContent).toContain("Only the Protocol steward can teach the model.");
    expect(track).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from "vitest";
import { appendAmbientMessage } from "./appendAmbientMessage";

describe("appendAmbientMessage", () => {
  it("appends via messages.append and merges onto latest local messages", async () => {
    const stored = {
      id: "msg-ambient-1",
      role: "assistant",
      content: "Hello from the sidelines",
      character_name: "Serenity",
      seq: 5,
    };
    const appendMessage = vi.fn(async () => stored);
    const setActiveSession = vi.fn((updater) => {
      const next = updater({
        id: "sess-1",
        messages: [
          { id: "msg-1", content: "older" },
          { id: "msg-2", content: "newer than stale snapshot" },
        ],
      });
      expect(next.messages).toEqual([
        { id: "msg-1", content: "older" },
        { id: "msg-2", content: "newer than stale snapshot" },
        stored,
      ]);
    });

    const result = await appendAmbientMessage({
      appendMessage,
      sessionId: "sess-1",
      message: {
        role: "assistant",
        content: "Hello from the sidelines",
        character_name: "Serenity",
      },
      setActiveSession,
    });

    expect(appendMessage).toHaveBeenCalledWith("sess-1", {
      role: "assistant",
      content: "Hello from the sidelines",
      character_name: "Serenity",
    });
    expect(result).toEqual(stored);
    expect(setActiveSession).toHaveBeenCalledTimes(1);
  });

  it("does not call ChatSession.update / replace with a full messages array", async () => {
    const appendMessage = vi.fn(async (_id, message) => ({
      id: "new-id",
      ...message,
    }));
    const replaceSpy = vi.fn();
    const chatSessionUpdate = vi.fn(async (_id, data) => {
      if (data && Object.prototype.hasOwnProperty.call(data, "messages")) {
        replaceSpy(data.messages);
      }
    });

    await appendAmbientMessage({
      appendMessage,
      sessionId: "sess-2",
      message: { role: "assistant", content: "quest" },
    });

    expect(appendMessage).toHaveBeenCalledTimes(1);
    expect(chatSessionUpdate).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  it("does not append the bubble onto a different open session", async () => {
    const stored = {
      id: "msg-ambient-2",
      role: "assistant",
      content: "sideline from A",
    };
    const appendMessage = vi.fn(async () => stored);
    const other = {
      id: "sess-other",
      messages: [{ id: "keep", content: "thread B" }],
    };
    const setActiveSession = vi.fn((updater) => updater(other));

    await appendAmbientMessage({
      appendMessage,
      sessionId: "sess-1",
      message: { role: "assistant", content: "sideline from A" },
      setActiveSession,
    });

    expect(setActiveSession).toHaveBeenCalledTimes(1);
    const next = setActiveSession.mock.results[0].value;
    expect(next).toBe(other);
    expect(next.messages).toEqual([{ id: "keep", content: "thread B" }]);
  });

  it("requires sessionId and appendMessage", async () => {
    await expect(
      appendAmbientMessage({
        appendMessage: vi.fn(),
        sessionId: "",
        message: {},
      }),
    ).rejects.toThrow(/sessionId/);

    await expect(
      appendAmbientMessage({
        sessionId: "sess",
        message: {},
      }),
    ).rejects.toThrow(/appendMessage/);
  });
});

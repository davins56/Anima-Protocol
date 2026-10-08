import { beforeEach, describe, expect, it, vi } from "vitest";
import { animaApi } from "@/api/animaApi";
import { sendChatMessage } from "./chatMessageHandler";

const { reportChatClientFailure } = vi.hoisted(() => ({
  reportChatClientFailure: vi.fn(),
}));

vi.mock("@/api/animaApi", () => ({
  animaApi: {
    conversations: {
      create: vi.fn(async () => ({ id: "conv_1" })),
    },
    sendMessage: vi.fn(),
  },
}));

vi.mock("./chatClientFailure", () => ({
  reportChatClientFailure: (...args) => reportChatClientFailure(...args),
}));

function session() {
  return {
    id: "sess_same",
    mode: "story",
    messages: [],
  };
}

describe("sendChatMessage failure reports", () => {
  beforeEach(() => {
    reportChatClientFailure.mockClear();
    animaApi.conversations.create.mockClear();
    animaApi.sendMessage.mockReset();
  });

  it("reports two failed sends in one session under different attempt ids", async () => {
    animaApi.sendMessage.mockImplementation(async function* () {
      throw new TypeError("Load failed");
    });
    const setActiveSession = vi.fn((updater) => updater({ messages: [] }));

    await sendChatMessage({
      content: "Hello",
      activeSession: session(),
      characters: [],
      setActiveSession,
    });
    await sendChatMessage({
      content: "Hello again",
      activeSession: session(),
      characters: [],
      setActiveSession,
    });

    expect(reportChatClientFailure).toHaveBeenCalledTimes(2);
    const [first, second] = reportChatClientFailure.mock.calls.map((call) => call[0]);
    expect(first.sessionId).toBe("sess_same");
    expect(second.sessionId).toBe("sess_same");
    expect(first.turnId).toMatch(/^turn_/);
    expect(second.turnId).toMatch(/^turn_/);
    expect(first.turnId).not.toBe(second.turnId);
    expect(first.error).toBeInstanceOf(TypeError);
    expect(second.error).toBeInstanceOf(TypeError);
  });

  it("still hands a user cancel to the reporter, which is what drops it", async () => {
    const abort = new Error("The operation was aborted.");
    abort.name = "AbortError";
    abort.code = "chat_user_cancel";
    animaApi.sendMessage.mockImplementation(async function* () {
      throw abort;
    });

    await sendChatMessage({
      content: "Hello",
      activeSession: session(),
      characters: [],
      setActiveSession: vi.fn((updater) => updater({ messages: [] })),
    });

    expect(reportChatClientFailure).toHaveBeenCalledTimes(1);
    expect(reportChatClientFailure.mock.calls[0][0].error.code).toBe("chat_user_cancel");
    expect(reportChatClientFailure.mock.calls[0][0].turnId).toMatch(/^turn_/);
  });
});

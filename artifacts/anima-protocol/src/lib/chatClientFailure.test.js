import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatClientFailureReport,
  classifyChatClientFailure,
  deliverChatClientFailure,
  reportChatClientFailure,
  resetChatClientFailureReportsForTests,
} from "./chatClientFailure.js";

const authHeaders = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/api/authBridge", () => ({
  authHeaders: (...args) => authHeaders(...args),
}));

vi.mock("@/lib/apiOrigin", () => ({
  apiUrl: (path) => `https://example.test/api${path}`,
}));

const SECRET_REPLY = "SECRET_REPLY_she_said_the_quiet_part";
const SECRET_USER = "SECRET_USER_what_he_typed_on_the_phone";
const SECRET_MEMORY = "SECRET_MEMORY_the_thing_she_remembers";

function trace(overrides = {}) {
  return {
    startedAt: 1_000,
    firstTokenAt: null,
    sawQueueWait: false,
    leftQueue: false,
    sawFirstToken: false,
    partialKept: false,
    serverError: false,
    ...overrides,
  };
}

function withTrace(error, chatClientTrace) {
  Object.defineProperty(error, "chatClientTrace", { value: chatClientTrace });
  return error;
}

describe("classifyChatClientFailure", () => {
  it("maps queue, timeout, missing tokens, drops, network, auth, server, and save", () => {
    expect(
      classifyChatClientFailure({
        error: withTrace(new Error("still queued"), trace({ sawQueueWait: true })),
      }),
    ).toEqual({ id: "queue_waiting", phase: "queue" });

    const timedOut = withTrace(new Error("The companion took too long to reply."), trace({
      sawQueueWait: true,
    }));
    timedOut.code = "chat_stream_timeout";
    expect(classifyChatClientFailure({ error: timedOut })).toEqual({
      id: "queue_timeout",
      phase: "queue",
    });

    const prefillTimeout = new Error("The companion took too long to reply.");
    prefillTimeout.code = "chat_stream_timeout";
    expect(
      classifyChatClientFailure({
        error: withTrace(prefillTimeout, trace({ leftQueue: true })),
      }),
    ).toEqual({ id: "no_first_token", phase: "prefill" });

    expect(
      classifyChatClientFailure({
        error: withTrace(new Error("cut"), trace({
          sawFirstToken: true,
          serverError: true,
          partialKept: true,
        })),
        partialKept: true,
      }),
    ).toEqual({ id: "stream_dropped", phase: "decode" });

    const safari = new TypeError("Load failed");
    expect(classifyChatClientFailure({ error: safari })).toEqual({
      id: "network_lost",
      phase: "prefill",
    });
    expect(
      classifyChatClientFailure({
        error: withTrace(new TypeError("Load failed"), trace({
          sawFirstToken: true,
          partialKept: true,
        })),
        partialKept: true,
      }),
    ).toEqual({ id: "network_lost", phase: "decode" });
    expect(
      classifyChatClientFailure({
        error: withTrace(new TypeError("Failed to fetch"), trace({ sawQueueWait: true })),
      }),
    ).toEqual({ id: "network_lost", phase: "queue" });

    const expired = new Error("Not signed in — your session may have expired.");
    expired.status = 401;
    expect(classifyChatClientFailure({ error: expired })).toEqual({
      id: "auth_expired",
      phase: "queue",
    });

    const server = new Error("API error: 502");
    server.status = 502;
    expect(
      classifyChatClientFailure({
        error: withTrace(server, trace({ leftQueue: true, serverError: true })),
      }),
    ).toEqual({ id: "server_error", phase: "prefill" });

    const busy = new Error("She's still finishing the last reply.");
    busy.code = "conversation_busy";
    expect(classifyChatClientFailure({ error: busy })).toEqual({
      id: "queue_waiting",
      phase: "queue",
    });

    expect(
      classifyChatClientFailure({
        error: new Error("The companion returned an empty reply. Please try again."),
      }),
    ).toEqual({ id: "post", phase: "post" });

    expect(
      classifyChatClientFailure({
        error: new TypeError("Load failed"),
        saveFailed: true,
        partialKept: true,
      }),
    ).toEqual({ id: "save_failed", phase: "post" });
  });
});

describe("chat client failure report", () => {
  beforeEach(() => {
    resetChatClientFailureReportsForTests();
    authHeaders.mockReset();
    fetchMock.mockReset();
    authHeaders.mockResolvedValue({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an allowlisted body and drops reply, user, and memory text", async () => {
    const error = withTrace(new TypeError("Load failed"), trace({
      startedAt: Date.now() - 800,
      sawQueueWait: false,
      leftQueue: true,
    }));
    error.partialContent = SECRET_REPLY;
    error.payload = { memory: SECRET_MEMORY, content: SECRET_USER };

    const result = await deliverChatClientFailure({
      error,
      sessionId: "sess_1",
      turnId: "turn_019",
      partialKept: false,
      msToFailure: 812,
      msToFirstToken: null,
      appVersion: "f456e814",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      content: SECRET_USER,
      message: SECRET_USER,
      reply: SECRET_REPLY,
      memory: SECRET_MEMORY,
    });

    expect(result.sent).toBe(true);
    expect(result.report).toEqual({
      failure_type: "network_lost",
      phase: "prefill",
      session_id: "sess_1",
      turn_id: "turn_019",
      ms_to_failure: 812,
      ms_to_first_token: null,
      partial_kept: false,
      app_version: "f456e814",
      user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
    });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).not.toContain(SECRET_REPLY);
    expect(body).not.toContain(SECRET_USER);
    expect(body).not.toContain(SECRET_MEMORY);
    expect(body).not.toContain("partialContent");
    expect(body).not.toContain("Load failed");
    expect(JSON.parse(body)).toEqual(result.report);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/chat/client-failure");
    expect(fetchMock.mock.calls[0][1].keepalive).toBe(true);
  });

  it("dedupes one type per turn and still reports a different type", async () => {
    const input = {
      error: new TypeError("Load failed"),
      sessionId: "sess_1",
      turnId: "turn_1",
      msToFailure: 10,
      msToFirstToken: null,
      appVersion: "abc",
      userAgent: "ua",
    };
    expect((await deliverChatClientFailure(input)).sent).toBe(true);
    expect((await deliverChatClientFailure(input)).reason).toBe("deduped");
    expect(
      (
        await deliverChatClientFailure({
          ...input,
          saveFailed: true,
          partialKept: true,
        })
      ).sent,
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops a burst of new turn ids inside the same minute", async () => {
    for (let i = 0; i < 8; i += 1) {
      const result = await deliverChatClientFailure({
        error: new TypeError("Load failed"),
        sessionId: "sess_1",
        turnId: `turn_${i}`,
        msToFailure: 5,
        msToFirstToken: null,
        userAgent: "ua",
      });
      expect(result.sent).toBe(true);
    }
    const blocked = await deliverChatClientFailure({
      error: new TypeError("Load failed"),
      sessionId: "sess_1",
      turnId: "turn_overflow",
      msToFailure: 5,
      msToFirstToken: null,
      userAgent: "ua",
    });
    expect(blocked.reason).toBe("deduped");
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("never throws into the caller when auth or the network fails", async () => {
    authHeaders.mockRejectedValue(new Error(SECRET_USER));
    await expect(
      deliverChatClientFailure({
        error: new TypeError("Load failed"),
        sessionId: "sess_1",
        turnId: "turn_1",
        msToFailure: 1,
        msToFirstToken: null,
      }),
    ).resolves.toMatchObject({ sent: false, reason: "transport" });
    expect(fetchMock).not.toHaveBeenCalled();

    authHeaders.mockResolvedValue({
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    });
    fetchMock.mockRejectedValue(new Error("offline"));
    await expect(
      deliverChatClientFailure({
        error: new TypeError("Load failed"),
        sessionId: "sess_1",
        turnId: "turn_2",
        msToFailure: 1,
        msToFirstToken: null,
      }),
    ).resolves.toMatchObject({ sent: false, reason: "transport" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    expect(() =>
      reportChatClientFailure({
        error: new Error(SECRET_REPLY),
        sessionId: "sess_1",
        turnId: "turn_3",
        content: SECRET_USER,
        memory: SECRET_MEMORY,
      }),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const bodies = fetchMock.mock.calls.map((call) => String(call[1]?.body || ""));
    expect(bodies.some((body) => body.includes(SECRET_REPLY))).toBe(false);
    expect(bodies.some((body) => body.includes(SECRET_USER))).toBe(false);
    expect(bodies.some((body) => body.includes(SECRET_MEMORY))).toBe(false);
  });

  it("refuses a report with no session id", () => {
    expect(
      buildChatClientFailureReport({
        error: new TypeError("Load failed"),
        sessionId: "",
        content: SECRET_REPLY,
      }),
    ).toBeNull();
  });
});

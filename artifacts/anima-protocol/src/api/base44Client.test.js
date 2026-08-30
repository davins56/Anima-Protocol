import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  base44,
  clearAuthTokenGetter,
  clearStoreCache,
  setAuthTokenGetter,
  STORE_FETCH_TIMEOUT_MS,
} from "./base44Client";

describe("ChatSession store wrapper", () => {
  beforeEach(() => {
    setAuthTokenGetter(() => "test-token");
  });

  afterEach(() => {
    clearAuthTokenGetter();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it("stores initial messages via the message replacement endpoint", async () => {
    const sessionWrites = [];
    const messageWrites = [];
    const savedMessages = [
      {
        id: "msg-1",
        role: "assistant",
        content: "The scene begins.",
        seq: 1,
      },
    ];

    global.fetch = vi.fn(async (url, options = {}) => {
      const { pathname } = new URL(String(url), "http://localhost");
      const body = options.body ? JSON.parse(String(options.body)) : {};

      if (pathname === "/api/store/ChatSession") {
        sessionWrites.push(body);
        return Response.json({ id: "session-1", title: body.title });
      }

      if (pathname === "/api/store/messages/replace") {
        messageWrites.push(body);
        return Response.json(savedMessages);
      }

      return Response.json({});
    });

    const session = await base44.entities.ChatSession.create({
      title: "Init Session",
      opening_scene: "A neon room hums.",
      messages: [{ role: "assistant", content: "The scene begins." }],
    });

    expect(sessionWrites).toEqual([
      {
        title: "Init Session",
        opening_scene: "A neon room hums.",
      },
    ]);
    expect(messageWrites).toEqual([
      {
        session_id: "session-1",
        messages: [{ role: "assistant", content: "The scene begins." }],
      },
    ]);
    expect(session).toEqual({
      id: "session-1",
      title: "Init Session",
      messages: savedMessages,
    });
  });

  it("fails fast when the store fetch timeout signal aborts", async () => {
    clearStoreCache();
    const abortErr = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      controller.abort(abortErr);
      return controller.signal;
    });

    global.fetch = vi.fn(async (_url, options = {}) => {
      if (options.signal?.aborted) {
        const reason = options.signal.reason || abortErr;
        throw reason;
      }
      return Response.json([]);
    });

    await expect(base44.entities.CheckIn.list()).rejects.toMatchObject({
      code: "timeout",
    });
    expect(timeoutSpy).toHaveBeenCalledWith(STORE_FETCH_TIMEOUT_MS);
    expect(STORE_FETCH_TIMEOUT_MS).toBe(8000);
  });
});
